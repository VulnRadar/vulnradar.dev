import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isUpdaterSupported } from "@/lib/updater/environment";

/**
 * The same question as environment.test.ts, asked of the real kernel.
 *
 * That file mocks node:fs, so it proves the wiring and nothing about whether
 * the probe can tell a writable directory from one it cannot write to. This
 * is the half that matters in production: the deployment the refusal exists
 * for is our own image, where /app is root-owned and the process runs as uid
 * 1001, and the only thing standing between an admin and a half-applied
 * update is that this probe really does come back false there.
 *
 * Skipped on Windows, whose permission model does not honour a 0o555 chmod,
 * and when running as root, for whom the mode bits do not apply. In both
 * cases the directory stays writable and the test would be asserting the
 * opposite of what it set up.
 */
const canDenyWrites =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0;

describe.skipIf(!canDenyWrites)(
  "isUpdaterSupported against a real filesystem",
  () => {
    const originalCwd = process.cwd();
    let dir: string | undefined;

    afterEach(() => {
      process.chdir(originalCwd);
      if (dir) {
        chmodSync(dir, 0o755);
        rmSync(dir, { recursive: true, force: true });
        dir = undefined;
      }
    });

    it("supports a directory it can write to, and leaves nothing behind", () => {
      dir = mkdtempSync(join(tmpdir(), "vr-updater-writable-"));
      process.chdir(dir);

      expect(isUpdaterSupported()).toEqual({ supported: true });
      expect(readdirSync(dir)).toEqual([]);
    });

    it("refuses a directory it cannot create entries in", () => {
      dir = mkdtempSync(join(tmpdir(), "vr-updater-readonly-"));
      process.chdir(dir);
      chmodSync(dir, 0o555);

      const result = isUpdaterSupported();
      expect(result.supported).toBe(false);
      expect(result.reason).toMatch(/not writable/);
    });
  },
);
