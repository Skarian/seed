import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(`Cannot read ${path.basename(file)}.`);
  }
}
export async function saveJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function requestJson(
  url,
  { method = "GET", body, headers = {}, timeout = 10000, fetcher = fetch } = {},
) {
  let response;
  try {
    response = await fetcher(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(
      "Service request failed; inspect state before retrying a mutation.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Service returned HTTP ${response.status}; inspect state before retrying a mutation.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Service returned invalid JSON.");
  }
}

export function assertIdle(status) {
  if (
    !status?.queue ||
    !status?.outputs ||
    status.queue.active !== 0 ||
    status.queue.waiting !== 0 ||
    status.outputs.pending !== 0
  )
    throw new Error(
      "Finish or cancel local jobs and save outputs before changing the worker.",
    );
}
