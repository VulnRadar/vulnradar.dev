import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readWorkflow, workflowSteps, stepNamed } from "./_workflow-steps";

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
