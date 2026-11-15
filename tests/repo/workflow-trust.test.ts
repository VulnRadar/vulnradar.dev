import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { evaluate, evaluateValue, type Ctx } from "./_expressions";

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

interface RequiredCheck {
  context: string;
  integration_id: number;
}

/** The checks .github/rulesets/main.json requires, as it lists them. */
function rulesetRequiredChecks(): RequiredCheck[] {
  const ruleset = JSON.parse(
    readFileSync(
      path.join(process.cwd(), ".github", "rulesets", "main.json"),
      "utf8",
    ),
  ) as {
    rules: {
      type: string;
      parameters?: { required_status_checks?: RequiredCheck[] };
    }[];
  };
  const rule = ruleset.rules.find((r) => r.type === "required_status_checks");
  expect(rule, "the ruleset requires status checks").toBeDefined();
  return rule!.parameters!.required_status_checks!;
}

/** The lines of a `key: |` block scalar in a step, as they are. */
function blockValue(raw: string, key: string): string {
  const lines = raw.split("\n");
  const at = lines.findIndex((l) => l.trim() === `${key}: |`);
  expect(at, `${key}: | in the step`).toBeGreaterThan(-1);
  const indent = lines[at].search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indent) break;
    body.push(line);
  }
  return body.join("\n");
}

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

  it("reads CI's run, the check runs and the statuses of that sha, not the pull request's current head", () => {
    const body = runBody(gate.code);
    expect(body).not.toMatch(/gh pr checks/);
    const ciRuns =
      '"repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${HEAD_SHA}&event=pull_request&per_page=100"';
    const checkRuns =
      '"repos/${GITHUB_REPOSITORY}/commits/${HEAD_SHA}/check-runs?filter=latest&per_page=100"';
    expect(body).toContain(ciRuns);
    expect(body).toContain(checkRuns);
    expect(body).toContain(
      '"repos/${GITHUB_REPOSITORY}/commits/${HEAD_SHA}/status?per_page=100"',
    );
    // A failed read retries rather than counting as an empty list.
    expect(body).toMatch(/if ! ci_run=\$\(gh api "/);
    expect(body).toMatch(/! runs=\$\(gh api --paginate /);
    expect(body).toMatch(/! statuses=\$\(gh api --paginate /);
    // CI's run first: once it has finished, every check it makes exists
    // already, so the reads after it cannot miss one.
    expect(body.indexOf(ciRuns)).toBeLessThan(body.indexOf(checkRuns));
  });

  it("fails closed: every completed check run that is not success, neutral or skipped fails", () => {
    const body = runBody(gate.code);
    expect(body).toContain(
      'if .status != "completed" then "pending" elif (.conclusion == "success" or .conclusion == "neutral" or .conclusion == "skipped") then "pass" else "fail" end',
    );
    expect(body).toContain(
      'if .state == "success" then "pass" elif .state == "pending" then "pending" else "fail" end',
    );
    expect(body).toMatch(/deadline=\$\(\( \$\(date \+%s\) \+ \d+ \* 60 \)\)/);
  });

  it("merges only once CI's run finished green and every check the ruleset requires succeeded", () => {
    const body = runBody(gate.code);
    // Nothing pending and something passed is what a fast check gives
    // before CI has registered a single job.
    expect(body).not.toMatch(
      /if \[ "\$pending" -eq 0 \] && \[ "\$passed" -gt 0 \]; then/,
    );
    const lines = body.split("\n").map((l) => l.trim());
    const merges = lines.indexOf(
      'if [ "$pending" -eq 0 ] && [ "$ci_run" = "completed/success" ] && [ -z "$missing" ]; then',
    );
    expect(merges).toBeGreaterThan(-1);
    // The one way out of the wait that is not a failure is inside that if.
    expect(lines.filter((l) => l === "break")).toHaveLength(1);
    const breaks = lines.indexOf("break");
    expect(breaks).toBeGreaterThan(merges);
    expect(lines.slice(merges + 1, breaks)).not.toContain("fi");
  });

  it("requires the checks the ruleset requires, by name and app, exactly as it lists them", () => {
    const listed = JSON.parse(blockValue(gate.raw, "REQUIRED_CHECKS"));
    expect(listed).toEqual(rulesetRequiredChecks());
    expect(listed).toHaveLength(12);
    const body = runBody(gate.code);
    expect(body).toContain('--argjson required "$REQUIRED_CHECKS"');
    // A successful check run of that name from that app; a commit status
    // has no app, so it never stands in for one.
    expect(body).toContain(
      "any($checks[]; .name == $r.context and .app == $r.integration_id and .success)",
    );
    expect(body).toContain('app: .app.id, success: (.conclusion == "success")');
    expect(body).toContain(
      '{name: .context, app: null, success: (.state == "success")',
    );
  });

  it("fails at once when CI's run ended any other way, or finished a required check short", () => {
    const body = runBody(gate.code);
    expect(body).toContain(
      'if [ "${ci_run%%/*}" = "completed" ] && [ "$ci_run" != "completed/success" ]; then',
    );
    const lines = body.split("\n").map((l) => l.trim());
    const short = lines.indexOf(
      'if [ "$pending" -eq 0 ] && [ "$ci_run" = "completed/success" ]; then',
    );
    expect(short).toBeGreaterThan(-1);
    expect(lines[short + 1]).toMatch(/^echo "::error::CI finished on /);
    expect(lines[short + 2]).toBe("exit 1");
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

  const waitMinutes = Number(
    /deadline=\$\(\( \$\(date \+%s\) \+ (\d+) \* 60 \)\)/.exec(
      runBody(gate.code),
    )![1],
  );

  it("says the same ceiling in its timeout message", () => {
    expect(runBody(gate.code)).toContain(
      `Timed out after ${waitMinutes} minutes waiting`,
    );
  });

  /**
   * The longest chain of `needs:` a Dependabot pull request can start, in
   * timeout-minutes, across every workflow with a pull_request trigger. The
   * gate waits for every check on the head, path-filtered report-only ones
   * included, so a ceiling below this chain gives up on a pull request whose
   * checks are all still on their way to passing. That is what happened when
   * Site checks arrived: image (25) then Lighthouse (55) against a 45-minute
   * wait, on every root npm or Dockerfile bump.
   */
  function slowestPullRequestChain(): { minutes: number; path: string } {
    const dir = path.join(process.cwd(), ".github", "workflows");
    let slowest = { minutes: 0, path: "" };
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      if (file === "dependabot-auto-merge.yml") continue;
      const wf = readWorkflow(file);
      if (!/^ {2}pull_request:/m.test(topLevel(wf, "on")?.body ?? "")) continue;
      const jobs = jobsOf(wf);
      const ctx: Ctx = {
        github: {
          event_name: "pull_request",
          actor: "dependabot[bot]",
          event: { pull_request: { user: { login: "dependabot[bot]" } } },
        },
        inputs: {},
      };
      const runs = (job: (typeof jobs)[number]) => {
        if (job.condition === null) return true;
        try {
          return evaluate(job.condition, ctx);
        } catch {
          // A condition the evaluator cannot read counts as one that runs.
          return true;
        }
      };
      const memo = new Map<string, { minutes: number; path: string }>();
      const chain = (id: string): { minutes: number; path: string } => {
        const known = memo.get(id);
        if (known) return known;
        const job = jobs.find((j) => j.id === id)!;
        expect(
          job.timeoutMinutes,
          `${file} ${id} sets timeout-minutes`,
        ).not.toBeNull();
        const own = Number(job.timeoutMinutes);
        const needs = (job.needs ?? "")
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean);
        let before = { minutes: 0, path: "" };
        for (const n of needs) {
          const c = chain(n);
          if (c.minutes > before.minutes) before = c;
        }
        const result = {
          minutes: before.minutes + own,
          path: `${before.path ? `${before.path} -> ` : `${file}: `}${id} (${own})`,
        };
        memo.set(id, result);
        return result;
      };
      for (const job of jobs.filter(runs)) {
        const c = chain(job.id);
        if (c.minutes > slowest.minutes) slowest = c;
      }
    }
    return slowest;
  }

  it("waits longer than the slowest chain of jobs a pull request starts", () => {
    const slowest = slowestPullRequestChain();
    // The chain is Site checks' image build then Lighthouse today; a
    // reader that found nothing would make this test pass vacuously.
    expect(slowest.minutes).toBeGreaterThanOrEqual(80);
    // Five minutes over the chain's own timeouts, for runner queueing.
    expect(waitMinutes, slowest.path).toBeGreaterThanOrEqual(
      slowest.minutes + 5,
    );
  });

  it("outlasts its own wait", () => {
    const job = jobsOf(dependabot).find((j) => j.id === "dependabot-merge")!;
    expect(Number(job.timeoutMinutes)).toBeGreaterThan(waitMinutes);
    expect(job.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
      actions: "write",
    });
  });
});

/** bash, and a jq that bash finds, which is the one the step would run. */
const gateRunnable = spawnSync("bash", ["-c", "command -v jq"]).status === 0;

/**
 * The wait itself, run by bash against canned API answers. gh answers each
 * read from a file through the real jq, sleep returns at once, and every
 * date is half an hour after the one before, so a wait that would never end
 * gives up after a few rounds. Skipped where there is no jq; CI has it.
 */
describe.skipIf(!gateRunnable)(
  "dependabot-auto-merge.yml's wait, run against canned API answers",
  { timeout: 120_000 },
  () => {
    const step = stepNamed(
      jobSteps(dependabot, "dependabot-merge"),
      "Wait for CI to pass",
    );
    const script = runScript(step.raw);
    const self = /^\s+SELF_CHECK: "([^"]+)"$/m.exec(step.code)![1];
    const required = rulesetRequiredChecks();
    const SHA = "3333333333333333333333333333333333333333";
    const STAND_INS = [
      "gh() {",
      '  [ "$1" = api ] || return 90',
      "  shift",
      '  if [ "$1" = --paginate ]; then shift; fi',
      '  [ "$2" = --jq ] || return 91',
      '  case "$1" in',
      '    *"/commits/$HEAD_SHA/check-runs?"*) file=check-runs.json ;;',
      '    *"/commits/$HEAD_SHA/status?"*) file=statuses.json ;;',
      '    *"/actions/workflows/ci.yml/runs?head_sha=$HEAD_SHA&"*) file=ci-runs.json ;;',
      '    *) echo "unexpected: gh api $1" >&2; return 92 ;;',
      "  esac",
      '  jq -rc "$3" "$FAKE_DIR/$file"',
      "}",
      "sleep() { :; }",
      "date() {",
      '  now=$(cat "$FAKE_DIR/clock")',
      '  echo $((now + 1800)) > "$FAKE_DIR/clock"',
      '  echo "$now"',
      "}",
    ].join("\n");

    function runGate(answers: {
      checkRuns: object[];
      statuses?: object[];
      ciRuns: object[];
    }) {
      const dir = mkdtempSync(path.join(tmpdir(), "vr-merge-gate-"));
      const slash = (p: string) => p.split(String.fromCharCode(92)).join("/");
      const write = (name: string, value: unknown) =>
        writeFileSync(path.join(dir, name), JSON.stringify(value));
      try {
        write("check-runs.json", {
          total_count: answers.checkRuns.length,
          check_runs: answers.checkRuns,
        });
        write("statuses.json", {
          state: "pending",
          statuses: answers.statuses ?? [],
        });
        write("ci-runs.json", {
          total_count: answers.ciRuns.length,
          workflow_runs: answers.ciRuns,
        });
        writeFileSync(path.join(dir, "clock"), "1800000000");
        const file = path.join(dir, "gate.sh");
        writeFileSync(file, [STAND_INS, script].join("\n"));
        const r = spawnSync("bash", [slash(file)], {
          encoding: "utf8",
          env: {
            ...process.env,
            FAKE_DIR: slash(dir),
            HEAD_SHA: SHA,
            GH_TOKEN: "not-a-token",
            GITHUB_REPOSITORY: REPO,
            SELF_CHECK: self,
            REQUIRED_CHECKS: JSON.stringify(required),
          },
        });
        return { status: r.status, out: `${r.stdout}${r.stderr}` };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    const checkRun = (name: string, extra: Record<string, unknown> = {}) => ({
      name,
      status: "completed",
      conclusion: "success",
      app: { id: 15368, slug: "github-actions" },
      ...extra,
    });
    const requiredRuns = required.map((c) =>
      checkRun(c.context, { app: { id: c.integration_id } }),
    );
    const itself = checkRun(self, { status: "in_progress", conclusion: null });
    const labels = checkRun("Apply labels");
    const ciRun = (id: number, status: string, conclusion: string | null) => ({
      id,
      status,
      conclusion,
      event: "pull_request",
      head_sha: SHA,
    });

    it("does not merge on a fast check that passed before CI registered a job", () => {
      const r = runGate({ checkRuns: [labels, itself], ciRuns: [] });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain("Timed out after 85 minutes");
    });

    it("does not merge while CI's newest run is still going, whatever has passed so far", () => {
      const r = runGate({
        checkRuns: [checkRun("Lint"), checkRun("Typecheck"), labels, itself],
        ciRuns: [
          ciRun(6, "completed", "success"),
          ciRun(7, "in_progress", null),
        ],
      });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain("Timed out after 85 minutes");
    });

    it("merges once CI's run finished green with every required check among the passes", () => {
      const r = runGate({
        checkRuns: [...requiredRuns, labels, checkRun("Lighthouse"), itself],
        ciRuns: [ciRun(7, "completed", "success")],
      });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain(`CI passed on ${SHA}`);
    });

    it("does not count a required check that is a commit status, or a check run from another app", () => {
      const r = runGate({
        checkRuns: [
          ...requiredRuns.filter((c) => c.name !== "Build"),
          checkRun("Build", { app: { id: 99999 } }),
          labels,
          itself,
        ],
        statuses: [{ context: "Build", state: "success" }],
        ciRuns: [ciRun(7, "completed", "success")],
      });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain(
        `CI finished on ${SHA} without a successful Build`,
      );
    });

    it("refuses as soon as CI's run ended any way but success", () => {
      const r = runGate({
        checkRuns: [...requiredRuns, labels, itself],
        ciRuns: [ciRun(7, "completed", "failure")],
      });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain(`CI's run on ${SHA} ended failure`);
    });
  },
);

/* ------------------------------------------------------------------------ */
/* Dependency review and the secret scan on every change.                    */
/* ------------------------------------------------------------------------ */

describe("ci.yml reviews dependencies and scans for secrets", () => {
  const ci = readWorkflow("ci.yml");
  const jobs = jobsOf(ci);
  const job = (id: string) => {
    const found = jobs.find((j) => j.id === id);
    expect(found, `ci.yml has a ${id} job`).toBeDefined();
    return found!;
  };
  const runOf = (code: string) => code.slice(code.search(/^\s+run:/m));

  describe("Dependency review", () => {
    const review = job("dependency-review");

    it("runs on pull requests only, and is skipped (which passes) otherwise", () => {
      expect(review.name).toBe("Dependency review");
      const on = (event_name: string): Ctx => ({ github: { event_name } });
      expect(evaluate(review.condition!, on("pull_request"))).toBe(true);
      for (const e of [
        "push",
        "merge_group",
        "workflow_dispatch",
        "schedule",
      ]) {
        expect(evaluate(review.condition!, on(e)), e).toBe(false);
      }
    });

    it("holds contents: read and nothing else, and checks nothing out", () => {
      expect(review.permissions).toEqual({ contents: "read" });
      expect(review.code).not.toMatch(/actions\/checkout@/);
    });

    it("runs the pinned action at the bar both audits use, on both scopes, without commenting", () => {
      expect(review.steps).toHaveLength(1);
      const step = review.steps[0].code;
      expect(step).toMatch(
        /uses: actions\/dependency-review-action@[0-9a-f]{40} # v[0-9]+[.][0-9]+[.][0-9]+$/m,
      );
      expect(step).toMatch(/^\s+fail-on-severity: high$/m);
      expect(step).toMatch(/^\s+fail-on-scopes: runtime, development$/m);
      expect(step).toMatch(/^\s+comment-summary-in-pr: never$/m);
    });
  });

  describe("Secret scan", () => {
    const scan = job("secret-scan");
    const step = scan.steps.find(
      (s) => s.name === "Scan the commits this event adds",
    )!;

    it("holds contents: read only", () => {
      expect(scan.name).toBe("Secret scan");
      expect(scan.permissions).toEqual({ contents: "read" });
      expect(step).toBeDefined();
    });

    it("builds the digest-pinned tools stage and pulls nothing by a floating tag", () => {
      expect(scan.code).toMatch(
        /^\s+run: docker build --target gitleaks -t vr-gitleaks [.]github\/tools$/m,
      );
      expect(scan.code).not.toMatch(/:latest\b/);
      expect(scan.code).not.toMatch(/zricethezav|gitleaks\/gitleaks:/);
    });

    it("takes the range only from env, as commit ids", () => {
      const run = runOf(step.code);
      expect(run).not.toMatch(/\$\{\{/);
      for (const v of [
        "EVENT_NAME",
        "PR_BASE",
        "PR_HEAD",
        "PUSH_BEFORE",
        "PUSH_AFTER",
        "MQ_BASE",
        "MQ_HEAD",
      ]) {
        expect(step.code).toMatch(
          new RegExp(`^\\s+${v}: \\$\\{\\{ [^}]+ \\}\\}$`, "m"),
        );
      }
      expect(run).toMatch(
        /is_sha\(\) \{ \[\[ "\$1" =~ \^\[0-9a-f\]\{40\}\$ \]\]; \}/,
      );
      expect(run).toMatch(/--log-opts "\$RANGE"/);
    });

    it("redacts, fails on a finding, and reads the repository's config", () => {
      const run = runOf(step.code);
      expect(run).toMatch(
        / git --redact --no-banner --exit-code 1 --config [.]gitleaks[.]toml /,
      );
      // A finding prints rule, file, line and commit; never the match.
      expect(run).not.toMatch(/[.]Match\b|[.]Secret\b/);
    });

    it("uploads nothing", () => {
      expect(scan.code).not.toMatch(/upload-artifact/);
    });

    it("skips with a notice where there is no range, rather than scanning nothing quietly", () => {
      expect(runOf(step.code)).toMatch(
        /::notice::A \$EVENT_NAME run scans no range: scheduled[.]yml scans the whole history weekly[.]/,
      );
    });
  });

  describe("Build", () => {
    const build = job("build");
    const sentinels = [
      'STRIPE_SECRET_KEY: "vrci-sentinel-stripe-secret"',
      'STRIPE_WEBHOOK_SECRET: "vrci-sentinel-stripe-webhook"',
      'DATABASE_URL: "postgresql://placeholder:vrci-sentinel-db-password@localhost:5432/placeholder"',
      `API_KEY_ENCRYPTION_KEY: "${"5e".repeat(32)}"`,
    ];

    it("builds with a unique sentinel for each server secret", () => {
      for (const line of sentinels) expect(build.code).toContain(line);
    });

    it("searches the client bundle for every one of them after the build", () => {
      const names = build.steps.map((s) => s.name);
      const at = names.indexOf("No server secret reached the client bundle");
      const built = names.indexOf("Build Next.js app");
      expect(at).toBeGreaterThan(built);
      // Nothing between the build and the search but the read-only check of
      // the build's middleware manifest, which ci-next-guards.test.ts keeps
      // directly after the build.
      expect(names.slice(built + 1, at)).toEqual([
        "Assert middleware still compiles for the Edge runtime and covers the API",
      ]);
      const run = runOf(build.steps[at].code);
      for (const ref of [
        '"$STRIPE_SECRET_KEY"',
        '"$STRIPE_WEBHOOK_SECRET"',
        "vrci-sentinel-db-password",
        '"$API_KEY_ENCRYPTION_KEY"',
      ]) {
        expect(run).toContain(ref);
      }
      expect(run).toContain('grep -rIl -e "$sentinel" .next/static');
      // grep's "could not search" is a failure, not a clean result.
      expect(run).toMatch(/\*\)\n\s+echo "::error::grep could not search/);
    });
  });
});
