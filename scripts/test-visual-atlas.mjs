import { spawn } from "node:child_process";
process.env.SEED_VISUAL_ATLAS = "1";
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
const tested = await run([
  "scripts/test-browser.mjs",
  "worker-pool-atlas.spec.ts",
  "--workers=1",
  ...process.argv.slice(2),
]);
const reported = await run(["scripts/visual-atlas.mjs"]);
// Request cards have their own content/width matrix, in addition to whole-app journeys.
const cards = await run(["scripts/test-request-cards.mjs"]);
process.exitCode = tested || reported || cards;
