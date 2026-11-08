import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SERVER_FILES,
  fixturePackageJson,
  prepareWorkdir,
} from "../../../scripts/spike/lib/fixture.mjs";
import { buildSummary } from "../../../scripts/spike/summarise.mjs";

/**
 * The spike is the gate the API move waits on, and it only ever runs when
 * someone starts it by hand. When npm start and the image moved to server.mjs
 * nothing in CI noticed that every spike target still ran `next start`, so the
 * green table described a server the product no longer used.
 */
describe("the spike runs the server the product runs", () => {
  let scratch: string | undefined;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  it("passes its own self-test against the production Dockerfile", () => {
    const run = spawnSync(process.execPath, ["scripts/spike/selftest.mjs"], {
      encoding: "utf8",
    });
    expect(run.stdout + run.stderr).toContain("self-tests passed");
    expect(run.status, run.stdout).toBe(0);
  });

  it("copies the real server files into the fixture byte for byte", () => {
    scratch = mkdtempSync(path.join(os.tmpdir(), "vulnradar-spike-server-"));
    const workdir = path.join(scratch, "server");

    prepareWorkdir({ workdir, nodeModulesFrom: null });

    expect(SERVER_FILES).toContain("server.mjs");
    for (const file of SERVER_FILES) {
      expect(
        readFileSync(path.join(workdir, file)).equals(readFileSync(file)),
      ).toBe(true);
    }
  });

  it("starts the fixture with the app's own start command", () => {
    const app = JSON.parse(readFileSync("package.json", "utf8"));
    expect(fixturePackageJson().scripts.start).toBe(app.scripts.start);
  });

  it("gives the image the production image's start command", () => {
    const startCommand = (file: string) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.startsWith("CMD ["));
    expect(startCommand("tests/spike/Dockerfile")).toEqual(
      startCommand("Dockerfile"),
    );
  });

  it("reports a missing server target as unproven rather than as a pass", () => {
    const passing = {
      next: "15.5.28",
      node: "v22",
      platform: "linux-x64",
      checks: [{ id: "2a", spike: 2, title: "x", status: "pass", detail: "" }],
      facts: {},
      error: null,
    };
    const everyTargetButTheServer = {
      dev: passing,
      start: passing,
      "start-h": passing,
      image: passing,
    };

    const { text, verdicts } = buildSummary(everyTargetButTheServer, null);

    expect((verdicts as unknown as Record<number, string>)[2]).toBe("PARTIAL");
    expect(text).toContain("node server.mjs");
  });
});
