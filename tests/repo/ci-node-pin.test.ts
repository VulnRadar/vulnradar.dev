import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readWorkflow, workflowSteps, stepNamed } from "./_workflow-steps";

/**
 * The Node patch is one number kept in three kinds of place: .nvmrc and
 * .node-version (what a developer's version manager reads), the Dockerfile's
 * FROM lines (what ships), and the setup-node steps (what CI and the release
 * run on). They used to be four hand-edited copies, and they drifted: the
 * Dockerfile moved to 22.23.4 while .nvmrc, .node-version and seven workflow
 * steps still said 22.23.3, and the CI guard that was supposed to notice read
 * the FIRST `node:X-alpine` in the file, which was a comment that had already
 * gone stale, so it compared the runner against the wrong number and passed.
 *
 * Now the workflows read .nvmrc instead of repeating it, and the Dockerfile,
 * .nvmrc and .node-version are held equal here (the CI step adds the one thing
 * a unit test cannot, the Node the runner actually has).
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const EXACT_PATCH = /^\d+\.\d+\.\d+$/;

const nvmrc = read(".nvmrc").trim();
const nodeVersion = read(".node-version").trim();
const dockerfile = read("Dockerfile");
const fromLines = dockerfile
  .split("\n")
  .filter((l) => l.startsWith("FROM node:"));

describe("the Node pin files", () => {
  it(".nvmrc is an exact patch, not a major or a range", () => {
    expect(nvmrc).toMatch(EXACT_PATCH);
  });

  it(".node-version equals .nvmrc", () => {
    expect(nodeVersion).toBe(nvmrc);
  });
});

describe("the Dockerfile", () => {
  it("builds every node stage on an exact patch equal to .nvmrc", () => {
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
    for (const line of fromLines) {
      const match = line.match(
        /^FROM node:(\d+\.\d+\.\d+)-alpine(@sha256:[0-9a-f]{64})?( .*)?$/,
      );
      expect(
        match,
        `not an exact-patch node FROM line: ${line}`,
      ).not.toBeNull();
      expect(match?.[1], line).toBe(nvmrc);
    }
  });

  it("names no Node patch in a comment, where it would go stale unnoticed", () => {
    const comments = dockerfile
      .split("\n")
      .filter((l) => l.trim().startsWith("#"));
    for (const line of comments) {
      expect(line).not.toMatch(/node:\d+\.\d+\.\d+/);
    }
  });
});

describe("the support policy", () => {
  const support = read(".github/SUPPORT.md");

  it("points at .nvmrc instead of quoting the patch", () => {
    expect(support).toContain("`.nvmrc`");
    expect(support).not.toContain(nvmrc);
    expect(support).not.toMatch(/drifted|still says/);
  });
});

describe.each(["ci.yml", "release.yml"])("%s", (file) => {
  const workflow = readWorkflow(file);
  const setupNodeSteps = workflowSteps(workflow).filter((s) =>
    /uses:\s*actions\/setup-node@/.test(s.code),
  );

  it("has setup-node steps to check", () => {
    expect(setupNodeSteps.length).toBeGreaterThanOrEqual(1);
    // Every use of the action is a step the reader found, none hiding in a
    // shape the reader skips.
    expect((workflow.match(/uses:\s*actions\/setup-node@/g) ?? []).length).toBe(
      setupNodeSteps.length,
    );
  });

  it("reads the Node version from .nvmrc in every setup-node step", () => {
    for (const step of setupNodeSteps) {
      expect(step.code, step.name ?? "unnamed step").toMatch(
        /^\s+node-version-file:\s*\.nvmrc\s*$/m,
      );
      expect(step.code, step.name ?? "unnamed step").not.toMatch(
        /^\s+node-version:/m,
      );
    }
  });
});

describe("the CI guard that compares the Dockerfile with the runner", () => {
  const steps = workflowSteps(readWorkflow("ci.yml"));
  const guard = stepNamed(steps, "Assert CI Node matches the published image");

  it("reads the real FROM lines, not the first match anywhere in the file", () => {
    expect(guard.code).toContain("grep -E '^FROM node:' Dockerfile");
    expect(guard.code).not.toMatch(/grep\s+-m1/);
  });

  it("compares .nvmrc, .node-version and the runner's own Node", () => {
    expect(guard.code).toContain("< .nvmrc");
    expect(guard.code).toContain("< .node-version");
    expect(guard.code).toContain("process.versions.node");
  });

  it("runs in the Typecheck job, after Node is set up", () => {
    const ci = readWorkflow("ci.yml");
    const typecheck = ci.slice(
      ci.search(/^ {2}typecheck:$/m),
      ci.search(/^ {2}test:$/m),
    );
    const assertStep = typecheck.indexOf(
      "name: Assert CI Node matches the published image",
    );
    expect(assertStep).toBeGreaterThan(-1);
    const setup = typecheck.indexOf("uses: actions/setup-node@");
    expect(setup).toBeGreaterThan(-1);
    expect(setup).toBeLessThan(assertStep);
  });
});
