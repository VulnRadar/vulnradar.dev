import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  readWorkflow,
  workflowSteps,
  stepNamed,
  jobsOf,
  jobNamed,
} from "./_workflow-steps";

/**
 * The CI steps that prove what Next and its bundler take part in: the Edge
 * middleware and its compiled matchers after the build, and the script
 * nonces, escaped API prefixes and route types on the booted image. Each one
 * is a single line in ci.yml that runs a script, so this keeps both the line
 * and the script's substance from being dropped quietly.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const steps = workflowSteps(readWorkflow("ci.yml"));

describe("the Build job's middleware manifest check", () => {
  const build = stepNamed(steps, "Build Next.js app");
  const check = stepNamed(
    steps,
    "Assert middleware still compiles for the Edge runtime and covers the API",
  );

  it("runs right after the build, against its output", () => {
    expect(check.index).toBe(build.index + 1);
    expect(check.code).toContain(
      "node scripts/ci/next16-build-checks.mjs .next",
    );
  });

  it("reads the manifests and checks the matchers", () => {
    const script = read("scripts/ci/next16-build-checks.mjs");
    expect(script).toContain("middleware-manifest.json");
    expect(script).toContain("functions-config-manifest.json");
    expect(script).toContain('"/%61pi/v3/support-tickets/12.png": true');
  });
});

describe("the Self-host job's runtime probes", () => {
  const probe = stepNamed(
    steps,
    "Probe the running image for script nonces, escaped API writes and route types",
  );

  it("runs against the booted image, before its logs are collected", () => {
    expect(probe.index).toBeGreaterThan(
      stepNamed(steps, "Assert the image's own HEALTHCHECK passes").index,
    );
    expect(probe.index).toBeLessThan(
      stepNamed(steps, "Container logs on failure").index,
    );
    expect(probe.code).toContain(
      "node scripts/ci/next16-runtime-probes.mjs http://localhost:3000",
    );
  });

  it("probes the nonces, the escaped prefixes and the route types", () => {
    const script = read("scripts/ci/next16-runtime-probes.mjs");
    for (const part of [
      "nonce-",
      "/%61pi/v3/scan",
      "/api/v3/x/%2e%2e/scan",
      "text/x-component",
      '"Sec-Fetch-Dest": "image"',
      "/api/v3/shared/not-a-real-token/screenshot",
    ]) {
      expect(script, part).toContain(part);
    }
  });
});

describe("the Self-host job's shutdown check", () => {
  // The worker stop path calls members of dynamically imported modules, the
  // pattern Turbopack's export-name mangling can break, and a failure there
  // is caught and only logged. So the step stops the real container and
  // reads both its exit code and its log.
  const stop = stepNamed(
    steps,
    "Stop the smoke container and assert a clean shutdown",
  );

  it("stops the booted image after every step that uses it, before its logs are collected", () => {
    for (const name of [
      "Self-scan every published route",
      "Attack the booted app (cross-site writes)",
      "Check every sitemap page (SEO and links)",
    ]) {
      expect(stop.index, name).toBeGreaterThan(stepNamed(steps, name).index);
    }
    // Nothing after it reaches the container but the failure log.
    const job = jobNamed(jobsOf(readWorkflow("ci.yml")), "selfhost").steps;
    const at = stepNamed(job, stop.name!).index;
    const selfhost = job.filter(
      (s) => s.index > at && /localhost:3000|vr-smoke/.test(s.code),
    );
    expect(selfhost.map((s) => s.name)).toEqual(["Container logs on failure"]);
    expect(stop.index).toBe(
      stepNamed(steps, "Container logs on failure").index - 1,
    );
    expect(stop.code).toContain("docker stop -t 60 vr-smoke");
    expect(stop.code).toContain("{{.State.ExitCode}}");
  });

  it("fails on each message the shutdown logs when a step of it fails", () => {
    const messages: Array<[string, string]> = [
      [
        "lib/database/boot/graceful-shutdown.ts",
        "Shutdown: stopping workers failed",
      ],
      ["lib/database/boot/workers.ts", "Failed to stop a background worker"],
      ["lib/database/boot/graceful-shutdown.ts", "Error closing database pool"],
    ];
    for (const [file, message] of messages) {
      expect(read(file), `${file} still logs it`).toContain(message);
      expect(stop.code, message).toContain(message);
    }
  });
});
