import { describe, it, expect } from "vitest";
import { readWorkflow, workflowSteps, stepNamed } from "./_workflow-steps";

/**
 * Who can make the release workflows run, and with what tag.
 *
 * release.yml and docker-publish-arm64.yml start on `workflow_run` of the
 * Docker publish workflow, and a `workflow_run` job runs in THIS repository's
 * context: contents: write, an OIDC token for cosign and npm, the default
 * branch's copy of the workflow. GitHub matches the upstream run by workflow
 * NAME, so a fork's pull request that adds a workflow called "Build, Sign, and
 * Publish Docker Image" completes a run that matches too. A job gated on
 * `conclusion == 'success'` alone then runs with the fork's branch name as its
 * tag and downloads the fork run's artifact as the image SBOM, which it would
 * sign and upload over a real release asset.
 *
 * These tests evaluate the job conditions rather than grep them, so a
 * reworded condition that still lets a fork in fails here, and a correct
 * rewording does not.
 */

const release = readWorkflow("release.yml");
const arm64 = readWorkflow("docker-publish-arm64.yml");
const dependabot = readWorkflow("dependabot-auto-merge.yml");

const REPO = "VulnRadar/vulnradar.dev";

/** The job-level `if:` of `job`, folded onto one line. */
function jobCondition(workflow: string, job: string): string {
  const lines = workflow.split("\n");
  // From `jobs:` on: release.yml also has a `release:` trigger under `on:`.
  const jobs = lines.indexOf("jobs:");
  expect(jobs, "the workflow has a jobs: block").toBeGreaterThan(-1);
  const start = lines.findIndex((l, n) => n > jobs && l === `  ${job}:`);
  expect(start, `job ${job} exists`).toBeGreaterThan(-1);
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {0,2}\S/.test(line)) break;
    const inline = /^ {4}if:\s*(.+)$/.exec(line);
    if (!inline) continue;
    if (!/^[>|]-?$/.test(inline[1].trim())) return inline[1].trim();
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== "" && !/^ {6}/.test(lines[j])) break;
      body.push(lines[j].trim());
    }
    return body.join(" ").trim();
  }
  throw new Error(`job ${job} has no if:`);
}

/* ------------------------------------------------------------------------ */
/* A small evaluator for the subset of GitHub expressions these conditions   */
/* use: property paths, string literals, ==, !=, !, &&, || and parentheses.  */
/* Strings compare case-insensitively and a missing property is null, which  */
/* is how the Actions runtime treats both.                                   */
/* ------------------------------------------------------------------------ */

type Value = string | boolean | null;
type Ctx = Record<string, unknown>;

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  const re =
    /\s*(\|\||&&|==|!=|!|\(|\)|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.-]*)/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`cannot tokenize at: ${src.slice(pos)}`);
    tokens.push(m[1]);
    pos = re.lastIndex;
  }
  return tokens;
}

const truthy = (v: Value) => v !== null && v !== false && v !== "";

/** The expression's value: && and || return an operand, as in Actions. */
function evaluateValue(expr: string, ctx: Ctx): Value {
  const src = expr.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  const lookup = (path: string): Value => {
    let cur: unknown = ctx;
    for (const part of path.split(".")) {
      if (cur === null || typeof cur !== "object") return null;
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur === undefined) return null;
    return cur as Value;
  };
  const eq = (a: Value, b: Value) =>
    typeof a === "string" && typeof b === "string"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;

  const primary = (): Value => {
    const t = next();
    if (t === "(") {
      const v = or();
      if (next() !== ")") throw new Error("expected )");
      return v;
    }
    if (t === "!") return !truthy(primary());
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    return lookup(t);
  };
  const comparison = (): Value => {
    const left = primary();
    if (peek() === "==") {
      next();
      return eq(left, primary());
    }
    if (peek() === "!=") {
      next();
      return !eq(left, primary());
    }
    return left;
  };
  const and = (): Value => {
    let v = comparison();
    while (peek() === "&&") {
      next();
      const r = comparison();
      v = truthy(v) ? r : v;
    }
    return v;
  };
  const or = (): Value => {
    let v = and();
    while (peek() === "||") {
      next();
      const r = and();
      v = truthy(v) ? v : r;
    }
    return v;
  };

  const result = or();
  if (i !== tokens.length) throw new Error(`trailing tokens in: ${expr}`);
  return result;
}

function evaluate(expr: string, ctx: Ctx): boolean {
  return truthy(evaluateValue(expr, ctx));
}

/**
 * The workflow's top-level concurrency group with its expressions filled in.
 * It is decided before any job's if:, so a run every job skips still joins
 * the group and, with cancel-in-progress, cancels whatever holds it.
 */
function concurrencyGroup(workflow: string, ctx: Ctx): string {
  const m = /^concurrency:\n {2}group:\s*(.+)$/m.exec(workflow);
  expect(m, "the workflow has a top-level concurrency group").not.toBeNull();
  return m![1].replace(/\$\{\{(.+?)\}\}/g, (_, expr: string) => {
    const v = evaluateValue(expr, ctx);
    return v === null ? "" : String(v);
  });
}

let runId = 1000;

function workflowRun(run: {
  conclusion: string;
  event: string;
  headRepo: string;
}): Ctx {
  return {
    github: {
      event_name: "workflow_run",
      repository: REPO,
      run_id: String(++runId),
      event: {
        workflow_run: {
          conclusion: run.conclusion,
          event: run.event,
          head_branch: "v4.0.0",
          head_repository: { full_name: run.headRepo },
        },
      },
    },
  };
}

const TAG_PUSH = workflowRun({
  conclusion: "success",
  event: "push",
  headRepo: REPO,
});
const FORK_PR = workflowRun({
  conclusion: "success",
  event: "pull_request",
  headRepo: "someone/vulnradar.dev",
});
const SAME_REPO_PR = workflowRun({
  conclusion: "success",
  event: "pull_request",
  headRepo: REPO,
});
const FORK_PUSH = workflowRun({
  conclusion: "success",
  event: "push",
  headRepo: "someone/vulnradar.dev",
});
const FAILED_PUSH = workflowRun({
  conclusion: "failure",
  event: "push",
  headRepo: REPO,
});

describe("the expression evaluator these tests rely on", () => {
  it("handles the operators the conditions use", () => {
    const ctx = { github: { a: "X", b: "x", c: "" } };
    expect(evaluate("github.a == github.b", ctx)).toBe(true);
    expect(evaluate("github.a != 'y'", ctx)).toBe(true);
    expect(evaluate("github.c || github.missing", ctx)).toBe(false);
    expect(evaluate("!github.c && (github.a == 'z' || true)", ctx)).toBe(true);
    expect(evaluate("${{ github.a == 'x' }}", ctx)).toBe(true);
  });
});

describe("release.yml runs only for this repository's own tag pushes", () => {
  const cond = jobCondition(release, "release");

  it("runs when a release is published by hand", () => {
    expect(
      evaluate(cond, { github: { event_name: "release", repository: REPO } }),
    ).toBe(true);
  });

  it("runs after a successful Docker publish of a tag pushed here", () => {
    expect(evaluate(cond, TAG_PUSH)).toBe(true);
  });

  it("does not run for a fork's pull request whose workflow shares the name", () => {
    expect(evaluate(cond, FORK_PR)).toBe(false);
  });

  it("does not run for a pull request from a branch of this repository", () => {
    expect(evaluate(cond, SAME_REPO_PR)).toBe(false);
  });

  it("does not run for a push to another repository", () => {
    expect(evaluate(cond, FORK_PUSH)).toBe(false);
  });

  it("does not run when the Docker publish failed", () => {
    expect(evaluate(cond, FAILED_PUSH)).toBe(false);
  });
});

describe("a fork's run cannot cancel a release through the concurrency group", () => {
  const PUBLISHED = {
    github: {
      event_name: "release",
      repository: REPO,
      run_id: "1",
      event: { release: { tag_name: "v4.0.0" } },
    },
  };
  const DISPATCHED = {
    github: { event_name: "workflow_dispatch", repository: REPO, run_id: "2" },
    inputs: { tag: "v4.0.0" },
  };

  it("release.yml still shares one group between the two triggers for a tag", () => {
    expect(concurrencyGroup(release, TAG_PUSH)).toBe("release-attach-v4.0.0");
    expect(concurrencyGroup(release, PUBLISHED)).toBe("release-attach-v4.0.0");
  });

  it("release.yml gives a fork or pull request run on a tag-named branch its own group", () => {
    const real = concurrencyGroup(release, TAG_PUSH);
    for (const ctx of [FORK_PR, SAME_REPO_PR, FORK_PUSH]) {
      expect(concurrencyGroup(release, ctx)).not.toBe(real);
    }
  });

  it("docker-publish-arm64.yml still shares one group between a tag push and a re-run", () => {
    expect(concurrencyGroup(arm64, TAG_PUSH)).toBe("docker-arm64-v4.0.0");
    expect(concurrencyGroup(arm64, DISPATCHED)).toBe("docker-arm64-v4.0.0");
  });

  it("docker-publish-arm64.yml gives a fork or pull request run its own group", () => {
    const real = concurrencyGroup(arm64, TAG_PUSH);
    for (const ctx of [FORK_PR, SAME_REPO_PR, FORK_PUSH]) {
      expect(concurrencyGroup(arm64, ctx)).not.toBe(real);
    }
  });
});

describe("docker-publish-arm64.yml keeps the same gate", () => {
  const cond = jobCondition(arm64, "arm64");

  it("runs on a manual dispatch and after a tag pushed here", () => {
    expect(
      evaluate(cond, {
        github: { event_name: "workflow_dispatch", repository: REPO },
      }),
    ).toBe(true);
    expect(evaluate(cond, TAG_PUSH)).toBe(true);
  });

  it("refuses fork runs, pull request runs and failed runs", () => {
    for (const ctx of [FORK_PR, SAME_REPO_PR, FORK_PUSH, FAILED_PUSH]) {
      expect(evaluate(cond, ctx)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* The tag.                                                                  */
/* ------------------------------------------------------------------------ */

const STRICT_TAG = String.raw`^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`;

/** The value a step assigns to TAG_PATTERN, as a JS RegExp. */
function tagPattern(code: string): RegExp {
  const m = /^\s*TAG_PATTERN='([^']+)'\s*$/m.exec(code);
  expect(m, "the step defines TAG_PATTERN in single quotes").not.toBeNull();
  return new RegExp(m![1]);
}

const GOOD_TAGS = ["v4.0.0", "v3.9.1", "v3.8.0-rc.1", "v1.9.4-patch.1"];
const BAD_TAGS = [
  "main",
  "v4/topic",
  "v4.0",
  "v4.0.0-",
  "v4.0.0.1",
  "refs/tags/v4.0.0",
  "v4.0.0 extra",
  "v4.0.0\nTAG=evil",
  "v4.0.0-rc.1\n",
  "v4.0.0-$(id)",
  "v4.0.0;id",
  "xv4.0.0",
];

function expectStrict(re: RegExp) {
  expect(re.source).toBe(STRICT_TAG);
  for (const t of GOOD_TAGS) expect(re.test(t), t).toBe(true);
  for (const t of BAD_TAGS) expect(re.test(t), JSON.stringify(t)).toBe(false);
}

/** Offset of the first write to the runner's env or output file, or -1. */
function firstWrite(code: string): number {
  return code.search(/>>\s*"?\$\{?GITHUB_(ENV|OUTPUT)\b/);
}

describe("release.yml verifies the tag before anything uses it", () => {
  const steps = workflowSteps(release);
  const resolve = stepNamed(steps, "Resolve tag");

  it("accepts only a strict, anchored version tag", () => {
    expectStrict(tagPattern(resolve.code));
    expect(resolve.code).toMatch(/\[\[ ! "\$TAG" =~ \$TAG_PATTERN \]\]/);
  });

  it("requires the tag to exist in this repository", () => {
    expect(resolve.code).toMatch(
      /git rev-parse --verify --quiet "refs\/tags\/\$\{TAG\}"/,
    );
  });

  it("stops the job when either check fails", () => {
    const checks = resolve.code.slice(resolve.code.indexOf("TAG_PATTERN"));
    expect(checks.match(/exit 1/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(resolve.code).toContain("set -euo pipefail");
  });

  it("writes TAG to the env and outputs only after both checks", () => {
    const write = firstWrite(resolve.code);
    const pattern = resolve.code.indexOf("=~ $TAG_PATTERN");
    const exists = resolve.code.indexOf("git rev-parse");
    expect(pattern).toBeGreaterThan(-1);
    expect(exists).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(pattern);
    expect(write).toBeGreaterThan(exists);
  });

  it("has the repository checked out before it looks the tag up", () => {
    const checkout = steps.find((s) => /actions\/checkout@/.test(s.code));
    expect(checkout).toBeDefined();
    expect(checkout!.index).toBeLessThan(resolve.index);
    expect(checkout!.code).toMatch(/fetch-depth:\s*0/);
  });

  it("is the first step that reads the tag", () => {
    for (const s of steps) {
      if (/steps\.vars\.outputs\.tag|\$\{?TAG\b/.test(s.code)) {
        expect(s.index, s.name ?? "").toBeGreaterThanOrEqual(resolve.index);
      }
    }
  });

  it("never interpolates the event's tag or branch into a script", () => {
    for (const s of steps) {
      const run = s.code.split(/^\s+run:\s*\|?\s*$/m)[1] ?? "";
      expect(run, s.name ?? "").not.toMatch(
        /\$\{\{\s*github\.event\.(workflow_run\.head_branch|release\.tag_name)/,
      );
    }
  });
});

describe("docker-publish-arm64.yml anchors its tag check", () => {
  const steps = workflowSteps(arm64);
  const resolve = stepNamed(steps, "Resolve tag");

  it("uses the same strict pattern as release.yml, anchored at both ends", () => {
    expectStrict(tagPattern(resolve.code));
    expect(resolve.code).toMatch(/\[\[ ! "\$TAG" =~ \$TAG_PATTERN \]\]/);
  });

  it("writes the tag only after the check", () => {
    const check = resolve.code.indexOf("=~ $TAG_PATTERN");
    expect(check).toBeGreaterThan(-1);
    for (const write of ['echo "tag=${TAG}"', 'echo "TAG=${TAG}"']) {
      expect(resolve.code.indexOf(write), write).toBeGreaterThan(check);
    }
  });

  it("checks out the tag ref itself, so a branch of the same name cannot stand in", () => {
    const checkout = stepNamed(steps, "Checkout repository");
    expect(checkout.code).toMatch(
      /^\s+ref:\s*refs\/tags\/\$\{\{\s*steps\.vars\.outputs\.tag\s*\}\}\s*$/m,
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Dependabot auto-merge.                                                    */
/* ------------------------------------------------------------------------ */

describe("dependabot-auto-merge.yml trusts the pull request's author", () => {
  const cond = jobCondition(dependabot, "dependabot-merge");
  const pr = (author: string, actor: string): Ctx => ({
    github: {
      actor,
      event_name: "pull_request",
      event: { pull_request: { user: { login: author } } },
    },
  });

  it("runs for a pull request Dependabot opened", () => {
    expect(evaluate(cond, pr("dependabot[bot]", "dependabot[bot]"))).toBe(true);
  });

  it("still runs when someone else triggered the event on Dependabot's PR", () => {
    expect(evaluate(cond, pr("dependabot[bot]", "a-maintainer"))).toBe(true);
  });

  it("does not run for anyone else's pull request, whoever the actor is", () => {
    expect(evaluate(cond, pr("someone", "dependabot[bot]"))).toBe(false);
  });

  it("does not read github.actor", () => {
    expect(cond).not.toMatch(/github\.actor/);
  });
});
