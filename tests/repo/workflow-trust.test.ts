import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readWorkflow,
  workflowSteps,
  stepNamed,
  jobsOf,
  topLevel,
} from "./_workflow-steps";

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

/** The steps of one job: the shared reader walks the whole file. */
function jobSteps(workflow: string, job: string) {
  const lines = workflow.split("\n");
  const jobs = lines.indexOf("jobs:");
  const start = lines.findIndex((l, n) => n > jobs && l === `  ${job}:`);
  expect(start, `job ${job} exists`).toBeGreaterThan(-1);
  const end = lines.findIndex((l, n) => n > start && /^ {2}\S/.test(l));
  return workflowSteps(
    lines.slice(start + 1, end === -1 ? undefined : end).join("\n"),
  );
}

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

/** The commit the tag in these contexts names. */
const TAG_SHA = "1111111111111111111111111111111111111111";
const OTHER_SHA = "2222222222222222222222222222222222222222";
const DOCKER_PUBLISH = ".github/workflows/docker-publish.yml";

function workflowRun(run: {
  conclusion: string;
  event: string;
  headRepo: string;
  headBranch?: string;
  headSha?: string;
  path?: string;
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
          head_branch: run.headBranch ?? "v4.0.0",
          head_sha: run.headSha ?? TAG_SHA,
          path: run.path ?? DOCKER_PUBLISH,
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
/** A tag moved after the Docker publish built it. */
const TAG_MOVED = workflowRun({
  conclusion: "success",
  event: "push",
  headRepo: REPO,
  headSha: OTHER_SHA,
});
/**
 * A push to a branch of this repository named like a release tag, in another
 * workflow file that carries the Docker publish workflow's name.
 */
const SAME_REPO_BRANCH_NAMED_LIKE_TAG = workflowRun({
  conclusion: "success",
  event: "push",
  headRepo: REPO,
  headBranch: "v3.9.1",
  path: ".github/workflows/evil.yml",
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

const RELEASE_JOBS = ["gate", "build", "release", "publish-npm"];

describe.each(RELEASE_JOBS)(
  "release.yml job %s runs only for this repository's own tag pushes",
  (job) => {
    const cond = jobCondition(release, job);

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

    it("lets a moved tag and a tag-named branch through, so Resolve tag has to refuse them", () => {
      // Both are pushes to this repository that succeeded. Nothing in the
      // event a condition can read tells them apart from a real release; the
      // script below compares the run's path and commit with the tag's.
      expect(evaluate(cond, TAG_MOVED)).toBe(true);
      expect(evaluate(cond, SAME_REPO_BRANCH_NAMED_LIKE_TAG)).toBe(true);
    });
  },
);

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

  // The two triggers of one tag share a group, so whichever arrives second
  // waits. Cancelling instead could stop a release between signing the sums
  // file and uploading it, or an arm64 run between `imagetools create` and
  // `cosign sign`, leaving the release tag on an unsigned index.
  it.each([
    ["release.yml", release],
    ["docker-publish-arm64.yml", arm64],
  ])("%s never cancels the run that holds the group", (_, workflow) => {
    expect(workflow).toMatch(
      /^concurrency:\n {2}group:.+\n {2}cancel-in-progress: false$/m,
    );
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

describe.each(RELEASE_JOBS)(
  "release.yml job %s verifies the tag before anything uses it",
  (job) => {
    const steps = jobSteps(release, job);
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

    it("runs the same check as every other job", () => {
      const first = stepNamed(
        jobSteps(release, RELEASE_JOBS[0]),
        "Resolve tag",
      );
      expect(resolve.code).toBe(first.code);
    });

    it("takes the run's commit and workflow path through env", () => {
      expect(resolve.code).toMatch(
        /^\s+WORKFLOW_RUN_HEAD_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}\s*$/m,
      );
      expect(resolve.code).toMatch(
        /^\s+WORKFLOW_RUN_PATH:\s*\$\{\{\s*github\.event\.workflow_run\.path\s*\}\}\s*$/m,
      );
    });

    it("on workflow_run, requires the Docker publish workflow and the commit it built", () => {
      const path = resolve.code.indexOf(
        '"${WORKFLOW_RUN_PATH%%@*}" != ".github/workflows/docker-publish.yml"',
      );
      const commit = resolve.code.indexOf(
        'TAG_COMMIT=$(git rev-parse "refs/tags/${TAG}^{commit}")',
      );
      const compare = resolve.code.indexOf(
        '[ "$TAG_COMMIT" != "$WORKFLOW_RUN_HEAD_SHA" ]',
      );
      const gate = resolve.code.indexOf(
        'if [ "$EVENT_NAME" = "workflow_run" ]',
      );
      for (const [what, at] of Object.entries({
        path,
        commit,
        compare,
        gate,
      })) {
        expect(at, what).toBeGreaterThan(-1);
      }
      expect(gate).toBeLessThan(path);
      expect(commit).toBeLessThan(compare);
      const write = firstWrite(resolve.code);
      expect(write).toBeGreaterThan(path);
      expect(write).toBeGreaterThan(compare);
      const checks = resolve.code.slice(gate, write);
      expect(checks.match(/exit 1/g)?.length ?? 0).toBe(2);
    });
  },
);

/* ------------------------------------------------------------------------ */
/* The Resolve tag script itself, run against a real repository.            */
/* ------------------------------------------------------------------------ */

/** The dedented body of a step's `run: |`. */
function runScript(raw: string): string {
  const lines = raw.split("\n");
  const at = lines.findIndex((l) => /^\s+run:\s*\|\s*$/.test(l));
  expect(at, "the step has a run: | body").toBeGreaterThan(-1);
  const body = lines.slice(at + 1);
  const indent = Math.min(
    ...body.filter((l) => l.trim() !== "").map((l) => l.search(/\S/)),
  );
  return body.map((l) => l.slice(indent)).join("\n") + "\n";
}

const toolsAvailable =
  spawnSync("bash", ["--version"]).status === 0 &&
  spawnSync("git", ["--version"]).status === 0;

// Every case spawns git and bash, which can take seconds per process on a
// busy Windows machine; the default 10 s hook and test timeouts did not fit.
describe.skipIf(!toolsAvailable)(
  "release.yml's Resolve tag, run against a throwaway repository",
  { timeout: 120_000 },
  () => {
    const script = runScript(
      stepNamed(jobSteps(release, "gate"), "Resolve tag").raw,
    );
    let dir = "";
    let repo = "";
    // An empty global config: no signing, no hooks and no identity from the
    // machine running the test leak into the throwaway repository.
    const gitEnv = (): NodeJS.ProcessEnv => ({
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    });
    const git = (...args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: repo,
        env: gitEnv(),
        encoding: "utf8",
      });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    let scriptFile = "";
    let tagged = "";
    let later = "";

    beforeAll(() => {
      dir = mkdtempSync(path.join(tmpdir(), "vr-resolve-tag-"));
      repo = path.join(dir, "repo");
      scriptFile = path.join(dir, "resolve.sh");
      writeFileSync(path.join(dir, "gitconfig"), "");
      mkdirSync(repo);
      git("init", "-q");
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      git("add", "a.txt");
      git("commit", "-q", "-m", "first");
      git("tag", "-a", "v4.0.0", "-m", "v4.0.0");
      tagged = git("rev-parse", "HEAD");
      writeFileSync(path.join(repo, "a.txt"), "b\n");
      git("commit", "-q", "-am", "second");
      later = git("rev-parse", "HEAD");
      writeFileSync(scriptFile, script);
    }, 120_000);

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function resolveTag(env: Record<string, string>) {
      const envFile = path.join(dir, "env");
      const outFile = path.join(dir, "out");
      writeFileSync(envFile, "");
      writeFileSync(outFile, "");
      const r = spawnSync("bash", [scriptFile], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...gitEnv(),
          GITHUB_ENV: envFile,
          GITHUB_OUTPUT: outFile,
          RELEASE_TAG_NAME: "",
          WORKFLOW_RUN_HEAD_BRANCH: "",
          WORKFLOW_RUN_HEAD_SHA: "",
          WORKFLOW_RUN_PATH: "",
          ...env,
        },
      });
      return {
        status: r.status,
        written: readFileSync(envFile, "utf8") + readFileSync(outFile, "utf8"),
      };
    }

    const fromRun = (sha: string, runPath: string) => ({
      EVENT_NAME: "workflow_run",
      WORKFLOW_RUN_HEAD_BRANCH: "v4.0.0",
      WORKFLOW_RUN_HEAD_SHA: sha,
      WORKFLOW_RUN_PATH: runPath,
    });

    it("accepts the Docker publish run that built the tagged commit", () => {
      const r = resolveTag(fromRun(tagged, DOCKER_PUBLISH));
      expect(r.status).toBe(0);
      expect(r.written).toContain("TAG=v4.0.0");
    });

    it("accepts the run's path with an @ref suffix", () => {
      const r = resolveTag(
        fromRun(tagged, `${DOCKER_PUBLISH}@refs/tags/v4.0.0`),
      );
      expect(r.status).toBe(0);
    });

    it("refuses a tag that no longer names the commit the publish built", () => {
      const r = resolveTag(fromRun(later, DOCKER_PUBLISH));
      expect(r.status).toBe(1);
      expect(r.written).toBe("");
    });

    it("refuses a run of any other workflow file", () => {
      for (const p of [
        ".github/workflows/evil.yml",
        `${DOCKER_PUBLISH}.evil`,
        "",
      ]) {
        const r = resolveTag(fromRun(tagged, p));
        expect(r.status, p).toBe(1);
        expect(r.written, p).toBe("");
      }
    });

    it("still releases a release published by hand, which has no run to compare", () => {
      const r = resolveTag({
        EVENT_NAME: "release",
        RELEASE_TAG_NAME: "v4.0.0",
      });
      expect(r.status).toBe(0);
      expect(r.written).toContain("tag=v4.0.0");
    });

    it("refuses a tag that does not exist", () => {
      const r = resolveTag({
        EVENT_NAME: "release",
        RELEASE_TAG_NAME: "v9.9.9",
      });
      expect(r.status).toBe(1);
      expect(r.written).toBe("");
    });
  },
);

describe("docker-publish.yml checks the tag's shape first", () => {
  // The job's steps: read over the whole file, the trigger list's "- v*"
  // item sits at the step indent too.
  const steps = jobsOf(readWorkflow("docker-publish.yml"))[0].steps;
  const shape = stepNamed(steps, "Check the tag's shape");

  it("uses the same strict pattern as release.yml, on the pushed ref", () => {
    expectStrict(tagPattern(shape.code));
    expect(shape.code).toMatch(/^\s+TAG="\$\{GITHUB_REF_NAME\}"\s*$/m);
    expect(shape.code).toMatch(/\[\[ ! "\$TAG" =~ \$TAG_PATTERN \]\]/);
    expect(shape.code).toMatch(/exit 1/);
  });

  it("is the first step after the checkout, before any login or push", () => {
    const checkout = steps.findIndex((s) => /actions\/checkout@/.test(s.code));
    expect(checkout).toBe(0);
    expect(shape.index).toBe(checkout + 1);
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

  it("on workflow_run, refuses a run of any workflow but docker-publish.yml before writing", () => {
    expect(resolve.code).toMatch(
      /^\s+RUN_PATH:\s*\$\{\{\s*github\.event\.workflow_run\.path\s*\}\}\s*$/m,
    );
    const check = resolve.code.indexOf(
      '[ "$EVENT_NAME" = "workflow_run" ] && [ "${RUN_PATH%%@*}" != ".github/workflows/docker-publish.yml" ]',
    );
    expect(check).toBeGreaterThan(-1);
    expect(resolve.code.indexOf('echo "skip=false"')).toBeGreaterThan(check);
    expect(resolve.code.indexOf('echo "tag=${TAG}"')).toBeGreaterThan(check);
  });

  it("builds only the commit the Docker publish built", () => {
    const checkout = stepNamed(steps, "Checkout repository");
    const same = stepNamed(
      steps,
      "Check the tag is the commit the Docker publish built",
    );
    expect(same.index).toBe(checkout.index + 1);
    expect(same.code).toMatch(
      /^\s+RUN_HEAD_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}\s*$/m,
    );
    expect(same.code).toContain("HEAD_SHA=$(git rev-parse HEAD)");
    expect(same.code).toContain('[ "$HEAD_SHA" != "$RUN_HEAD_SHA" ]');
    expect(same.code).toMatch(/exit 1/);
    expect(same.code).toMatch(
      /^\s+if: steps\.vars\.outputs\.skip != 'true' && github\.event_name == 'workflow_run'\s*$/m,
    );
    const build = stepNamed(steps, "Build and push the arm64 image");
    expect(same.index).toBeLessThan(build.index);
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

describe("dependabot-auto-merge.yml merges only the head CI checked", () => {
  const steps = jobSteps(dependabot, "dependabot-merge");
  const gate = stepNamed(steps, "Wait for CI to pass");
  const merge = stepNamed(steps, "Merge");
  const dispatch = stepNamed(steps, "Run CI on the commit it merged");
  const runBody = (code: string) => code.slice(code.search(/^\s+run:/m));

  it("keeps one run per pull request, and a newer push cancels the older wait", () => {
    const c = topLevel(dependabot, "concurrency");
    expect(c).not.toBeNull();
    expect(c!.body).toMatch(
      /^ {2}group: dependabot-merge-\$\{\{ github\.event\.pull_request\.number \}\}$/m,
    );
    expect(c!.body).toMatch(/^ {2}cancel-in-progress: true$/m);
  });

  it("takes the head sha from the event, through env only", () => {
    for (const step of [gate, merge]) {
      expect(step.code).toMatch(
        /^\s+HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}$/m,
      );
      expect(runBody(step.code)).not.toMatch(/\$\{\{/);
    }
  });

  it("reads the check runs and statuses of that sha, not the pull request's current head", () => {
    const body = runBody(gate.code);
    expect(body).not.toMatch(/gh pr checks/);
    expect(body).toContain(
      '"repos/${GITHUB_REPOSITORY}/commits/${HEAD_SHA}/check-runs?filter=latest&per_page=100"',
    );
    expect(body).toContain(
      '"repos/${GITHUB_REPOSITORY}/commits/${HEAD_SHA}/status?per_page=100"',
    );
    // A failed read retries rather than counting as an empty list.
    expect(body).toMatch(/if ! runs=\$\(gh api --paginate /);
    expect(body).toMatch(/! statuses=\$\(gh api --paginate /);
  });

  it("fails closed: every completed check run that is not success, neutral or skipped fails", () => {
    const body = runBody(gate.code);
    expect(body).toContain(
      'if .status != "completed" then "pending" elif (.conclusion == "success" or .conclusion == "neutral" or .conclusion == "skipped") then "pass" else "fail" end',
    );
    expect(body).toContain(
      'if .state == "success" then "pass" elif .state == "pending" then "pending" else "fail" end',
    );
    expect(body).toMatch(
      /if \[ "\$pending" -eq 0 \] && \[ "\$passed" -gt 0 \]; then/,
    );
    expect(body).toMatch(/deadline=\$\(\( \$\(date \+%s\) \+ 45 \* 60 \)\)/);
  });

  it("still excludes only itself, by its job name", () => {
    const self = /^\s+SELF_CHECK: "([^"]+)"$/m.exec(gate.code);
    expect(self).not.toBeNull();
    const job = jobsOf(dependabot).find((j) => j.id === "dependabot-merge");
    expect(self![1]).toBe(job!.name);
  });

  it("merges that sha and nothing newer", () => {
    expect(merge.code).toMatch(
      /^\s+run: gh pr merge --squash --delete-branch --match-head-commit "\$HEAD_SHA" "\$PR_URL"$/m,
    );
    expect(merge.code).toMatch(/^\s+if: steps\.gate\.outcome == 'success'$/m);
    expect(merge.code).toMatch(/^\s+id: merge$/m);
  });

  it("starts CI on main only after a merge that succeeded", () => {
    expect(dispatch.index).toBe(merge.index + 1);
    expect(dispatch.code).toMatch(
      /^\s+if: steps\.merge\.outcome == 'success'$/m,
    );
    expect(dispatch.code).toMatch(
      /^\s+run: gh workflow run ci\.yml --ref main$/m,
    );
    // ci.yml has to accept the dispatch for this to start anything.
    expect(topLevel(readWorkflow("ci.yml"), "on")!.body).toMatch(
      /^ {2}workflow_dispatch:/m,
    );
  });

  it("outlasts its own wait", () => {
    const job = jobsOf(dependabot).find((j) => j.id === "dependabot-merge")!;
    expect(Number(job.timeoutMinutes)).toBeGreaterThan(45);
    expect(job.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
      actions: "write",
    });
  });
});
