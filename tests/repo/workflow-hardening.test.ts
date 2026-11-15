import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  readWorkflow,
  workflowSteps,
  jobsOf,
  topLevel,
  type WorkflowJob,
} from "./_workflow-steps";

/**
 * The rules every workflow in this repository follows, checked over every
 * file in .github/workflows rather than a list, so a workflow added later is
 * held to them the moment it arrives.
 *
 * Each rule names what it stops. A rule with an exception carries the
 * exception as a table in this file, one row per case with the reason next
 * to it, and a row that no longer matches anything fails too, so the tables
 * cannot quietly grow stale.
 */

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");
const ACTIONS_DIR = path.join(ROOT, ".github", "actions");

const WORKFLOWS = readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();

const ACTIONS = readdirSync(ACTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(".github", "actions", d.name, "action.yml"))
  .sort();

const readRepo = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const isComment = (line: string) => line.trim().startsWith("#");
const indentOf = (line: string) => line.length - line.trimStart().length;

/** Non-comment lines, so a rule is never satisfied or broken by prose. */
const codeLines = (text: string) =>
  text.split("\n").filter((l) => l.trim() !== "" && !isComment(l));

/**
 * The body of every `run:` key in a file, comments inside it included: the
 * runner expands an expression anywhere in the script text, a shell comment
 * as much as a command.
 */
function runBodies(text: string): string[] {
  const lines = text.split("\n");
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? 2 : 0);
    const value = m[3].trim();
    if (!/^[|>][-+]?$/.test(value)) {
      bodies.push(value);
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() !== "" && indentOf(lines[j]) <= keyIndent) break;
      body.push(lines[j]);
    }
    bodies.push(body.join("\n"));
    i = j - 1;
  }
  return bodies;
}

/** The nearest less-indented non-comment line above line `at`. */
function parentKey(lines: string[], at: number): string | null {
  const own = indentOf(lines[at]);
  for (let i = at - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === "" || isComment(line)) continue;
    if (indentOf(line) < own) return line.trim();
  }
  return null;
}

const files = WORKFLOWS.map((file) => {
  const text = readWorkflow(file);
  return { file, text, jobs: jobsOf(text) };
});

const jobOf = (file: string, id: string): WorkflowJob => {
  const found = files
    .find((f) => f.file === file)
    ?.jobs.find((j) => j.id === id);
  if (!found) throw new Error(`no job ${id} in ${file}`);
  return found;
};

it("finds the workflows and the composite actions", () => {
  expect(WORKFLOWS).toEqual(
    expect.arrayContaining([
      "ci.yml",
      "dependabot-auto-merge.yml",
      "docker-publish.yml",
      "docker-publish-arm64.yml",
      "ghcr-cleanup.yml",
      "label.yml",
      "release.yml",
      "spike-api-rewrite.yml",
      "stale.yml",
    ]),
  );
  expect(ACTIONS).toContain(
    path.join(".github", "actions", "scan-gate", "action.yml"),
  );
});

/* ------------------------------------------------------------------------ */
/* 1. The layout the line-based reader depends on.                           */
/* ------------------------------------------------------------------------ */

describe.each(WORKFLOWS)(
  "%s keeps the layout the reader depends on",
  (file) => {
    const text = readWorkflow(file);
    const lines = text.split("\n");
    const jobsAt = lines.indexOf("jobs:");

    it("has a jobs: block, and it is the last top-level key", () => {
      expect(jobsAt, "a `jobs:` line at column 0").toBeGreaterThan(-1);
      const after = lines
        .slice(jobsAt + 1)
        .filter((l) => l.trim() !== "" && !isComment(l));
      for (const line of after) {
        expect(
          indentOf(line),
          `a top-level key after jobs: ${line}`,
        ).toBeGreaterThan(0);
      }
    });

    it("puts every job header at exactly two spaces and nothing else there", () => {
      const body = lines
        .slice(jobsAt + 1)
        .filter((l) => l.trim() !== "" && !isComment(l));
      for (const line of body) {
        const indent = indentOf(line);
        expect(indent === 1 || indent === 3, `odd indent: ${line}`).toBe(false);
        if (indent === 2)
          expect(line, "a job header").toMatch(/^ {2}[A-Za-z0-9_-]+:\s*$/);
      }
      expect(jobsOf(text).length).toBeGreaterThan(0);
    });

    it("puts every step at exactly six spaces as a `- ` item", () => {
      for (const job of jobsOf(text)) {
        const jl = job.raw.split("\n");
        const at = jl.findIndex((l) => /^ {4}steps:\s*$/.test(l));
        expect(
          at,
          `${job.id} has a steps: block at four spaces`,
        ).toBeGreaterThan(-1);
        for (const line of jl.slice(at + 1)) {
          if (line.trim() === "" || isComment(line)) continue;
          const indent = indentOf(line);
          if (indent <= 4) break;
          expect(indent, `${job.id}: ${line}`).toBeGreaterThanOrEqual(6);
          if (indent === 6)
            expect(line, `${job.id}: a step`).toMatch(/^ {6}- /);
          expect(indent === 7, `${job.id}: ${line}`).toBe(false);
        }
        expect(job.steps.length, `${job.id} has steps`).toBeGreaterThan(0);
      }
    });

    it("finds every `uses:` inside a step it parsed", () => {
      const usesLine = /^\s*(- )?uses:\s/;
      const inFile = codeLines(text).filter((l) => usesLine.test(l)).length;
      const inSteps = workflowSteps(text)
        .map((s) => s.code.split("\n").filter((l) => usesLine.test(l)).length)
        .reduce((a, b) => a + b, 0);
      expect(inSteps).toBe(inFile);
    });
  },
);

/* ------------------------------------------------------------------------ */
/* 2 and 3. Permissions.                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Every write scope a job holds, with the reason it needs it. A grant that is
 * not listed fails, and so does a row that no longer matches a grant.
 */
const WRITE_GRANTS: {
  file: string;
  job: string;
  scope: string;
  reason: string;
}[] = [
  {
    file: "docker-publish.yml",
    job: "build-and-push",
    scope: "packages",
    reason: "pushes the amd64 image to GHCR",
  },
  {
    file: "docker-publish.yml",
    job: "build-and-push",
    scope: "id-token",
    reason: "cosign keyless signing of the image",
  },
  {
    file: "docker-publish-arm64.yml",
    job: "arm64",
    scope: "packages",
    reason: "pushes the arm64 image and the merged index",
  },
  {
    file: "docker-publish-arm64.yml",
    job: "arm64",
    scope: "id-token",
    reason: "cosign keyless signing of the merged index",
  },
  {
    file: "release.yml",
    job: "release",
    scope: "contents",
    reason: "creates the GitHub release and uploads its assets",
  },
  {
    file: "release.yml",
    job: "release",
    scope: "id-token",
    reason: "cosign keyless signing of the tarball and the sums file",
  },
  {
    file: "release.yml",
    job: "publish-npm",
    scope: "id-token",
    reason: "npm trusted publishing with provenance",
  },
  {
    file: "ghcr-cleanup.yml",
    job: "cleanup",
    scope: "packages",
    reason: "deletes orphaned image versions",
  },
  {
    file: "label.yml",
    job: "label",
    scope: "pull-requests",
    reason: "applies path labels to the pull request",
  },
  {
    file: "stale.yml",
    job: "stale",
    scope: "issues",
    reason: "marks and closes stale issues",
  },
  {
    file: "stale.yml",
    job: "stale",
    scope: "pull-requests",
    reason: "marks and closes stale pull requests",
  },
  {
    file: "dependabot-auto-merge.yml",
    job: "dependabot-merge",
    scope: "contents",
    reason: "squash-merges the pull request",
  },
  {
    file: "dependabot-auto-merge.yml",
    job: "dependabot-merge",
    scope: "pull-requests",
    reason: "merges and deletes the pull request branch",
  },
];

describe.each(WORKFLOWS)("%s states its permissions job by job", (file) => {
  const text = readWorkflow(file);
  const jobs = jobsOf(text);

  it("grants nothing at the top level", () => {
    const top = topLevel(text, "permissions");
    expect(top, "a top-level permissions: key").not.toBeNull();
    expect(top!.value).toBe("{}");
    expect(
      top!.body.split("\n").filter((l) => l.trim() !== "" && !isComment(l)),
    ).toEqual([]);
  });

  it.each(jobs.map((j) => j.id))(
    "job %s declares its own permissions",
    (id) => {
      const job = jobs.find((j) => j.id === id)!;
      expect(
        job.permissionsDeclared,
        `${id} has a permissions: key`,
      ).not.toBeNull();
      expect(
        ["", "{}"],
        `${id}: read-all, write-all or another shorthand`,
      ).toContain(job.permissionsDeclared);
      if (job.permissionsDeclared === "") {
        expect(
          Object.keys(job.permissions).length,
          `${id} lists its scopes`,
        ).toBeGreaterThan(0);
      }
      for (const [scope, level] of Object.entries(job.permissions)) {
        expect(
          ["read", "write", "none"],
          `${id}: ${scope}: ${level}`,
        ).toContain(level);
        if (level === "write") {
          const row = WRITE_GRANTS.find(
            (g) => g.file === file && g.job === id && g.scope === scope,
          );
          expect(
            row,
            `${file} ${id} holds ${scope}: write with no row in WRITE_GRANTS`,
          ).toBeDefined();
        }
      }
    },
  );
});

it("has no WRITE_GRANTS row that no longer matches a grant", () => {
  for (const g of WRITE_GRANTS) {
    expect(
      g.reason.length,
      `${g.file} ${g.job} ${g.scope} has a reason`,
    ).toBeGreaterThan(0);
    expect(
      jobOf(g.file, g.job).permissions[g.scope],
      `${g.file} ${g.job} ${g.scope}`,
    ).toBe("write");
  }
});

/* ------------------------------------------------------------------------ */
/* 4 and 5. Timeouts and concurrency.                                        */
/* ------------------------------------------------------------------------ */

/** Workflows a cancelled run could leave half-published or half-pruned. */
const NEVER_CANCEL = [
  "docker-publish.yml",
  "docker-publish-arm64.yml",
  "release.yml",
  "ghcr-cleanup.yml",
];

describe.each(WORKFLOWS)("%s bounds every run", (file) => {
  const text = readWorkflow(file);

  it.each(jobsOf(text).map((j) => j.id))(
    "job %s has a timeout of 1 to 90 minutes",
    (id) => {
      const job = jobsOf(text).find((j) => j.id === id)!;
      expect(job.timeoutMinutes, `${id} has timeout-minutes`).toMatch(
        /^[0-9]+$/,
      );
      const minutes = Number(job.timeoutMinutes);
      expect(minutes).toBeGreaterThanOrEqual(1);
      expect(minutes).toBeLessThanOrEqual(90);
    },
  );

  it("has a top-level concurrency group", () => {
    const c = topLevel(text, "concurrency");
    expect(c, "a top-level concurrency: key").not.toBeNull();
    expect(c!.body).toMatch(/^ {2}group:\s*\S/m);
    expect(c!.body).toMatch(/^ {2}cancel-in-progress:\s*\S/m);
  });

  if (NEVER_CANCEL.includes(file)) {
    it("never cancels a run in progress", () => {
      expect(topLevel(text, "concurrency")!.body).toMatch(
        /^ {2}cancel-in-progress:\s*false\s*$/m,
      );
    });
  }
});

it("lists only workflows that exist under NEVER_CANCEL", () => {
  for (const file of NEVER_CANCEL) expect(WORKFLOWS).toContain(file);
});

/* ------------------------------------------------------------------------ */
/* 6. Triggers that run in this repository's context.                       */
/* ------------------------------------------------------------------------ */

/** The workflow_run consumers, both covered by workflow-trust.test.ts. */
const WORKFLOW_RUN = ["docker-publish-arm64.yml", "release.yml"];

describe.each(WORKFLOWS)("%s triggers", (file) => {
  const text = readWorkflow(file);
  const on = topLevel(text, "on");

  it("never uses pull_request_target", () => {
    expect(codeLines(text).join("\n")).not.toMatch(/pull_request_target/);
  });

  it("uses workflow_run only where workflow-trust.test.ts checks it", () => {
    expect(on, "a top-level on: key").not.toBeNull();
    const uses =
      /^\s+workflow_run:/m.test(on!.body) || /workflow_run/.test(on!.value);
    expect(uses).toBe(WORKFLOW_RUN.includes(file));
  });
});

/* ------------------------------------------------------------------------ */
/* 7 and 8. What every step runs, and what it leaves behind.                 */
/* ------------------------------------------------------------------------ */

/** owner/repo[/path]@<commit> # <the exact release tag>, nothing else. */
const PINNED_USES =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40} # v?[0-9]+[.][0-9]+[.][0-9]+$/;

describe.each([...WORKFLOWS.map((f) => `.github/workflows/${f}`), ...ACTIONS])(
  "%s pins what it runs",
  (rel) => {
    const text = readRepo(rel);

    it("pins every action to a commit and names the exact release", () => {
      const uses = codeLines(text)
        .map((l) => /^\s*(?:- )?uses:\s*(.+?)\s*$/.exec(l)?.[1])
        .filter((u): u is string => u !== undefined);
      for (const u of uses) {
        expect(u.startsWith("docker://"), u).toBe(false);
        if (u.startsWith("./")) continue;
        expect(u).toMatch(PINNED_USES);
      }
    });
  },
);

describe.each(WORKFLOWS)("%s checkouts", (file) => {
  it("keep no token in .git/config", () => {
    // Nothing in any workflow pushes with git. A job that ever has to gets a
    // named row here, not a blanket exception.
    for (const step of workflowSteps(readWorkflow(file))) {
      if (!/uses:\s*actions\/checkout@/.test(step.code)) continue;
      expect(step.code, step.name ?? "unnamed checkout").toMatch(
        /^\s+persist-credentials:\s*false\s*$/m,
      );
    }
  });
});

/* ------------------------------------------------------------------------ */
/* 9 and 10. What a script can be made to run or print.                      */
/* ------------------------------------------------------------------------ */

describe.each([...WORKFLOWS.map((f) => `.github/workflows/${f}`), ...ACTIONS])(
  "%s scripts",
  (rel) => {
    const text = readRepo(rel);
    const bodies = runBodies(text);

    it("finds a body for every run: key", () => {
      const keys = codeLines(text).filter((l) =>
        /^\s*(- )?run:/.test(l),
      ).length;
      expect(bodies.length).toBeLessThanOrEqual(keys);
      if (keys > 0) expect(bodies.length).toBeGreaterThan(0);
    });

    it("interpolate no expression into a script", () => {
      // An expression inside run: is pasted into the script before bash reads
      // it, so a value with a quote or a $( in it runs as code. Values go in
      // through env: and are read as variables.
      for (const body of bodies) expect(body).not.toContain("${{");
    });

    it("never trace commands or dump the environment", () => {
      for (const body of bodies) {
        expect(body).not.toMatch(/\bset\s+-[A-Za-z]*x/);
        expect(body).not.toMatch(/\bset\s+-o\s+xtrace\b/);
        expect(body).not.toMatch(/\b(ba)?sh\s+-[A-Za-z]*x/);
        expect(body).not.toMatch(/\bprintenv\b/);
      }
    });

    it("reads no secret but GITHUB_TOKEN, and that only as an env: or with: value", () => {
      const lines = text.split("\n");
      lines.forEach((line, n) => {
        if (isComment(line)) return;
        const exprs = line.match(/\$\{\{[^}]*\}\}/g) ?? [];
        if (!exprs.some((e) => /\bsecrets\b/.test(e))) return;
        expect(line, `line ${n + 1}`).toMatch(
          /^\s+[A-Za-z0-9_-]+:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}\s*$/,
        );
        expect(["env:", "with:"], `line ${n + 1}`).toContain(
          parentKey(lines, n),
        );
      });
    });
  },
);

/* ------------------------------------------------------------------------ */
/* 11. Names that other things are bound to.                                 */
/* ------------------------------------------------------------------------ */

/** The contexts .github/rulesets/main.json requires, by job name. */
const REQUIRED_CHECKS = [
  "Lint",
  "Typecheck",
  "Test",
  "Extension",
  "Build",
  "Self-host smoke test",
  "Integration",
];

describe.each(WORKFLOWS)("%s job names", (file) => {
  const jobs = jobsOf(readWorkflow(file));

  it("are unique, by id and by name", () => {
    const ids = jobs.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = jobs
      .map((j) => j.name)
      .filter((n): n is string => n !== null);
    expect(new Set(names).size).toBe(names.length);
  });
});

it("ci.yml names every required check exactly once", () => {
  const names = jobsOf(readWorkflow("ci.yml")).map((j) => j.name);
  for (const required of REQUIRED_CHECKS) {
    expect(
      names.filter((n) => n === required),
      required,
    ).toHaveLength(1);
  }
});
