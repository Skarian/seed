import {
  openSync,
  writeFileSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { StudioPaths } from "./storage.js";
/** Fence before opening a database or starting any paid-operation owner. */
export function acquireCoordinator(paths: StudioPaths) {
  const file = path.join(paths.data, "coordinator.lock"),
    token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (JSON.parse(readFileSync(file, "utf8")).token === token)
            unlinkSync(file);
        } catch {
          /* Already released. */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let raw: string, owner: { pid: number };
      try {
        raw = readFileSync(file, "utf8");
        owner = JSON.parse(raw);
      } catch {
        throw Error("Another Seed coordinator is starting for this profile.");
      }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
        throw Error("Cannot verify the owner of this profile.");
      let alive = true;
      try {
        process.kill(owner.pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw Error(
          "Seed is already running for this profile. Open the existing application.",
        );
      if (readFileSync(file, "utf8") === raw) unlinkSync(file);
    }
  }
  throw Error("Another Seed coordinator owns this profile.");
}
