"""Linux parent-death fence for one command and its process group. No retries."""
import ctypes
import os
import signal
import subprocess
import sys


def main():
    parent = int(sys.argv[1])
    stopping = False
    def stop(*_):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    # Python preexec_fn is unsafe in the threaded worker. This dedicated,
    # single-threaded launcher establishes the parent-death fence before spawn.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0 or libc.prctl(36, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'Cannot establish child ownership')
    if os.getppid() != parent or stopping:
        return 1
    process = subprocess.Popen(sys.argv[2:], start_new_session=True)
    try:
        while not stopping:
            try: return process.wait(timeout=0.25)
            except subprocess.TimeoutExpired: pass
        return 1
    finally:
        # Handles a death signal during Popen as well as a leader exiting while
        # its descendants still hold sockets/files. Never scan unrelated PIDs.
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait()
        while True:
            try: os.waitpid(-1, 0)
            except ChildProcessError: break


if __name__ == '__main__': sys.exit(main())
