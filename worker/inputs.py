"""Whole-file input retries with immutable, verified publication."""
import asyncio
import errno
import hashlib
import os
import re
import uuid
from pathlib import Path

from aiohttp import web

IDLE_SECONDS = 30

def problem(status, code, message):
    return web.json_response({'code': code, 'error': message}, status=status)


def publish(temporary, target, size, digest):
    # link is an atomic create-if-absent on the same filesystem. An overlapping
    # retry can never truncate or replace an input being read by the engine.
    try:
        os.link(temporary, target)
    except FileExistsError:
        if target.is_symlink() or not target.is_file():
            return False
        with target.open('rb') as existing:
            actual = hashlib.file_digest(existing, 'sha256').hexdigest()
        if target.stat().st_size != size or actual != digest:
            return False
    if os.name != 'nt':
        fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return True


async def save_input(request, workspace, locks):
    digest = request.headers.get('X-Seed-Input-SHA256', '')
    raw_size = request.headers.get('X-Seed-Input-Size', '')
    if not re.fullmatch('[a-f0-9]{64}', digest) or not re.fullmatch('[1-9][0-9]{0,15}', raw_size):
        return problem(400, 'invalid_input', 'Input size and SHA-256 are required.')
    size = int(raw_size)
    root = Path(workspace).resolve()
    inputs = root / '.seed/spool/inputs'
    if inputs.resolve() != inputs:
        return problem(400, 'invalid_input', 'Input directory is redirected.')
    temporary = inputs / ('.upload-' + uuid.uuid4().hex)
    try:
        inputs.mkdir(parents=True, exist_ok=True)
        fields, filename, received = {}, None, 0
        actual = hashlib.sha256()
        reader = await request.multipart()
        with temporary.open('xb') as output:
            while True:
                part = await asyncio.wait_for(reader.next(), IDLE_SECONDS)
                if part is None:
                    break
                if part.name == 'image':
                    if filename is not None or not part.filename or not re.fullmatch(r'[A-Za-z0-9_-]+\.(png|mp4|wav)', part.filename):
                        return problem(400, 'invalid_input', 'Expected one prepared input filename.')
                    filename = part.filename
                    while chunk := await asyncio.wait_for(part.read_chunk(65536), IDLE_SECONDS):
                        received += len(chunk)
                        if received > size:
                            return problem(422, 'input_integrity', 'Input exceeds its declared size.')
                        output.write(chunk)
                        actual.update(chunk)
                elif part.name in ('subfolder', 'type', 'overwrite') and part.name not in fields:
                    value = bytearray()
                    while chunk := await asyncio.wait_for(part.read_chunk(1024), IDLE_SECONDS):
                        value.extend(chunk)
                        if len(value) > 128:
                            return problem(400, 'invalid_input', 'Invalid input metadata.')
                    fields[part.name] = value.decode('utf-8')
                else:
                    return problem(400, 'invalid_input', 'Unexpected input field.')
            if not filename or received != size or actual.hexdigest() != digest:
                return problem(422, 'input_integrity', 'Input size or SHA-256 does not match.')
            output.flush()
            os.fsync(output.fileno())
        subfolder = fields.get('subfolder', '')
        job_id = subfolder.removeprefix('seed/')
        if subfolder != 'seed/' + str(uuid.UUID(job_id)) or fields.get('type') != 'input' or fields.get('overwrite') != 'true':
            return problem(400, 'invalid_input', 'Invalid input destination.')
        destination = inputs / subfolder
        if destination.resolve() != destination:
            return problem(400, 'invalid_input', 'Input destination is redirected.')
        # Share receipt's short commit fence: a late duplicate cannot resurrect
        # input files after durable output acknowledgment has cleaned the job.
        async with locks.setdefault(job_id, asyncio.Lock()):
            if (root / '.seed/spool/jobs' / job_id / 'receipt.json').exists():
                return problem(409, 'input_retired', 'This job has already been acknowledged.')
            destination.mkdir(parents=True, exist_ok=True)
            commit = asyncio.create_task(asyncio.to_thread(publish, temporary, destination / filename, size, digest))
            try:
                matched = await asyncio.shield(commit)
            except asyncio.CancelledError:
                # Do not unlink the source while an owned filesystem operation runs.
                await commit
                raise
        if not matched:
            return problem(409, 'input_conflict', 'This job input already has different content.')
        return web.json_response({'name': filename, 'subfolder': subfolder, 'type': 'input', 'size': size, 'sha256': digest})
    except TimeoutError:
        return problem(408, 'input_stalled', 'Input transfer stopped making progress.')
    except (ValueError, UnicodeError, AssertionError):
        return problem(400, 'invalid_input', 'Invalid input upload.')
    except OSError as error:
        if error.errno in (errno.ENOSPC, errno.EDQUOT):
            return problem(507, 'storage_full', 'Worker storage is full. Input was not accepted.')
        raise
    finally:
        temporary.unlink(missing_ok=True)
