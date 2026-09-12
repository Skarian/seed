import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";

const python =
  process.env.SEED_PYTHON ||
  (process.platform === "win32"
    ? ".local/worker-venv/Scripts/python.exe"
    : ".local/worker-venv/bin/python");
if (!existsSync(python) && !process.env.SEED_PYTHON) {
  throw new Error(
    "Create .local/worker-venv and install worker/requirements-test.txt, or set SEED_PYTHON. See studio/DEVELOPMENT.md.",
  );
}
mkdirSync(".local/tests", { recursive: true });
const temporary = mkdtempSync(path.resolve(".local/tests/verify-"));
const npm = process.env.npm_execpath;
for (const [command, args] of [
  [process.execPath, [npm, "run", "build"]],
  [process.execPath, [npm, "run", "typecheck"]],
  [process.execPath, [npm, "test"]],
  [
    process.execPath,
    [
      "--test",
      "tests/operations/vast.test.mjs",
      "tests/operations/runpod.test.mjs",
      "tests/operations/connection.test.mjs",
      "tests/operations/recovery.test.mjs",
      "tests/operations/tunnel.test.mjs",
      "tests/operations/preparation.test.mjs",
      "tests/operations/preparation-upload.test.mjs",
    ],
  ],
  [
    python,
    [
      "-m",
      "pytest",
      "worker",
      "-q",
      "--basetemp",
      temporary,
      "-p",
      "no:cacheprovider",
    ],
  ],
  [python, ["scripts/check_secrets.py"]],
]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
