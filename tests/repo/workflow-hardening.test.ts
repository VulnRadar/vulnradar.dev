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
      "image-arm64.yml",
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
  {
    file: "dependabot-auto-merge.yml",
    job: "dependabot-merge",
    scope: "actions",
    reason:
      "starts ci.yml on main for the merge commit, which a GITHUB_TOKEN push never triggers",
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

/* ------------------------------------------------------------------------ */
/* Publish jobs read no cache, and the tools they run are pinned once.       */
/* ------------------------------------------------------------------------ */

const toolsDockerfile = readRepo(".github/tools/Dockerfile");

/** Each `FROM <ref> AS <stage>` of the tools Dockerfile, by stage. */
const TOOL_STAGES = new Map(
  toolsDockerfile
    .split("\n")
    .filter((l) => l.startsWith("FROM "))
    .map((l) => {
      const m = /^FROM (\S+) AS ([a-z0-9-]+)$/.exec(l);
      return [m?.[2] ?? l, m?.[1] ?? ""] as const;
    }),
);

describe("the jobs that publish or sign", () => {
  const credentialed = files.flatMap(({ file, jobs }) =>
    jobs
      .filter(
        (j) =>
          j.permissions.packages === "write" ||
          j.permissions["id-token"] === "write",
      )
      .map((j) => ({ file, job: j })),
  );

  it("are found", () => {
    expect(credentialed.length).toBeGreaterThanOrEqual(4);
  });

  it.each(credentialed.map(({ file, job }) => [`${file} ${job.id}`, job]))(
    "%s reads and writes no Actions cache",
    (_, job) => {
      // A cache entry is whatever the last job with a write token to that
      // scope saved. Built on, or installed from, in the job that signs, it
      // becomes part of what is signed.
      expect(job.cacheMode).toBe("none");
      expect(job.code).not.toMatch(/type=gha/);
      expect(job.code).not.toMatch(/uses:\s*actions\/cache/);
      for (const step of job.steps) {
        if (!/uses:\s*actions\/setup-node@/.test(step.code)) continue;
        expect(step.code, step.name ?? "").toMatch(
          /^\s+package-manager-cache:\s*false\s*$/m,
        );
      }
    },
  );
});

describe(".github/tools/Dockerfile", () => {
  it("pins every stage to a tag and a digest", () => {
    const froms = toolsDockerfile
      .split("\n")
      .filter((l) => l.startsWith("FROM "));
    expect(froms.length).toBe(TOOL_STAGES.size);
    for (const line of froms) {
      expect(line).toMatch(
        /^FROM [a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64} AS [a-z0-9-]+$/,
      );
    }
  });

  it("has every stage a workflow builds", () => {
    for (const { file, text } of files) {
      for (const m of text.matchAll(/--target ([a-z0-9-]+)/g)) {
        expect(TOOL_STAGES.has(m[1]), `${file} builds --target ${m[1]}`).toBe(
          true,
        );
      }
    }
  });

  it("is the reference ci.yml's Postgres services use, at compose's tag", () => {
    const pg = TOOL_STAGES.get("postgres");
    expect(pg).toBeDefined();
    const ci = readWorkflow("ci.yml");
    const services = [...ci.matchAll(/^ {8}image:\s*(\S+)\s*$/gm)].map(
      (m) => m[1],
    );
    expect(services.length).toBeGreaterThanOrEqual(2);
    for (const image of services) expect(image).toBe(pg);
    const compose = /^ {4}image:\s*(postgres:\S+)\s*$/m.exec(
      readRepo("docker-compose.yml"),
    );
    expect(compose, "docker-compose.yml names a postgres image").not.toBeNull();
    expect(pg!.split("@")[0]).toBe(compose![1]);
  });

  it("is the BuildKit both publish jobs run", () => {
    const buildkit = TOOL_STAGES.get("buildkit");
    expect(buildkit).toBeDefined();
    for (const file of ["docker-publish.yml", "docker-publish-arm64.yml"]) {
      const setups = workflowSteps(readWorkflow(file)).filter((s) =>
        /uses:\s*docker\/setup-buildx-action@/.test(s.code),
      );
      expect(setups.length, file).toBe(1);
      expect(setups[0].code).toMatch(
        new RegExp(
          `^ +driver-opts: image=${buildkit!.replace(/[.]/g, "[.]")}$`,
          "m",
        ),
      );
    }
  });

  it("is watched by Dependabot, as are the composite actions", () => {
    const dependabot = readRepo(".github/dependabot.yml");
    const block = (ecosystem: string) =>
      dependabot
        .split(/^ {2}- package-ecosystem:/m)
        .find((b) => b.startsWith(` "${ecosystem}"`)) ?? "";
    expect(block("docker")).toMatch(/^ {6}- "\/[.]github\/tools"$/m);
    expect(block("github-actions")).toMatch(/^ {6}- "\/"$/m);
    expect(block("github-actions")).toMatch(
      /^ {6}- "\/[.]github\/actions\/[*]"$/m,
    );
  });
});

describe("every Postgres service", () => {
  it("is the tools postgres stage, in every workflow that runs one", () => {
    const pg = TOOL_STAGES.get("postgres");
    const found = files.flatMap(({ file, text }) =>
      [...text.matchAll(/^ {8}image:\s*(\S+)\s*$/gm)].map((m) => ({
        file,
        image: m[1],
      })),
    );
    expect(found.map((f) => f.file)).toEqual(
      expect.arrayContaining([
        "ci.yml",
        "docker-publish-arm64.yml",
        "image-arm64.yml",
      ]),
    );
    for (const { file, image } of found) expect(image, file).toBe(pg);
  });
});

/* ------------------------------------------------------------------------ */
/* Booting the image. ci.yml's Self-host smoke test boots amd64; the arm64    */
/* image is booted by the publish job before it joins the release tags, and   */
/* by image-arm64.yml on pull requests. One boot that drifted from the others */
/* (a looser health probe, a smaller schema, a different origin) would pass   */
/* an image the others refuse.                                                */
/* ------------------------------------------------------------------------ */

const BOOTS = [
  { file: "ci.yml", job: "selfhost" },
  { file: "docker-publish-arm64.yml", job: "arm64" },
  { file: "image-arm64.yml", job: "arm64" },
] as const;

/** The `-e` flags of the job's `docker run -d --name vr-smoke` command. */
function bootEnv(job: WorkflowJob): string[] {
  const lines = job.code.split("\n");
  const at = lines.findIndex((l) =>
    /^\s+docker run -d --name vr-smoke --network host \x5c$/.test(l),
  );
  expect(at, `${job.id} boots vr-smoke on the host network`).not.toBe(-1);
  const flags: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const m = /^\s+-e (\S+)( \x5c)?$/.exec(lines[i]);
    if (m) flags.push(m[1]);
    if (!lines[i].endsWith("\\")) break;
  }
  return flags.sort();
}

/** The `env:` block of the job's postgres service, as lines. */
function serviceEnv(job: WorkflowJob): string {
  const m = /^ {8}env:\n((?: {10}\S.*\n)+)/m.exec(job.raw);
  expect(m, `${job.id} has a postgres service env`).not.toBeNull();
  return m![1];
}

describe("every boot of the image is the same boot", () => {
  const boots = BOOTS.map(({ file, job }) => ({
    label: `${file} ${job}`,
    job: jobOf(file, job),
  }));
  const reference = boots[0].job;

  it.each(boots.map((b) => [b.label, b.job]))(
    "%s starts it with the Self-host smoke test's environment",
    (_, job) => {
      expect(bootEnv(job)).toEqual(bootEnv(reference));
      expect(serviceEnv(job)).toBe(serviceEnv(reference));
      // The origin is the one the container serves, never a build-time value.
      expect(bootEnv(job)).toContain("APP_URL=http://localhost:3000");
      expect(job.code).not.toMatch(/-e NEXT_PUBLIC_APP_URL/);
    },
  );

  it.each(boots.map((b) => [b.label, b.job]))(
    "%s waits for a 200 from the health endpoint, checks the schema and the HEALTHCHECK",
    (_, job) => {
      expect(job.code).toContain(
        "code=$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/api/v3/health 2>/dev/null || true)",
      );
      expect(job.code).toMatch(/if \[ "\$code" = "200" \]; then/);
      expect(job.code).toMatch(/for i in \$\(seq 1 60\); do/);
      expect(job.code).toMatch(/^\s+sleep 10$/m);
      expect(job.code).toContain(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'",
      );
      expect(job.code).toMatch(/test "\$count" -gt 40 \|\|/);
      expect(job.code).toContain(
        "docker exec vr-smoke wget --no-verbose --tries=1 --spider http://localhost:3000/api/v3/health",
      );
    },
  );

  it("builds the CI images with the build.invalid sentinel and the published ones with it empty", () => {
    for (const file of ["ci.yml", "image-arm64.yml"]) {
      const builds = workflowSteps(readWorkflow(file)).filter((s) =>
        // The app image: the repository root as the context. The tools
        // stages build from .github/tools.
        /^\s+run: docker build .* [.]$/m.test(s.code),
      );
      expect(builds.length, file).toBeGreaterThanOrEqual(1);
      for (const b of builds) {
        expect(b.code, file).toContain(
          "--build-arg NEXT_PUBLIC_APP_URL=https://build.invalid",
        );
      }
    }
    for (const file of ["docker-publish.yml", "docker-publish-arm64.yml"]) {
      const builds = workflowSteps(readWorkflow(file)).filter((s) =>
        /uses:\s*docker\/build-push-action@/.test(s.code),
      );
      expect(builds.length, file).toBe(1);
      expect(builds[0].code, file).toMatch(
        /build-args: \|\n\s+NEXT_PUBLIC_APP_URL=$/m,
      );
    }
  });

  it("boots the arm64 release image after it is built and before it is merged", () => {
    const steps = jobOf("docker-publish-arm64.yml", "arm64").steps;
    const index = (name: string) => {
      const s = steps.find((st) => st.name === name);
      expect(s, name).toBeDefined();
      return s!.index;
    };
    const build = index("Build and push the arm64 image");
    const boot = index("Boot the arm64 image before it joins the release tags");
    const merge = index("Merge both architectures into the release tags");
    expect(boot).toBe(build + 1);
    expect(merge).toBe(boot + 1);
    const code = steps.find((s) => s.index === boot)!.code;
    // The image the build just pushed under its own arch tag, not a release
    // tag, which still holds the amd64-only index at this point.
    expect(code).toContain('IMAGE="${REF}:${TAG}-arm64"');
    expect(code).toMatch(/^\s+set -euo pipefail$/m);
    expect(code).toMatch(
      /fail\(\) \{\n\s+echo "::error::\$1"\n\s+docker logs vr-smoke \|\| true\n\s+exit 1\n/,
    );
  });
});

/* ------------------------------------------------------------------------ */
/* The suites run against the booted image.                                  */
/* ------------------------------------------------------------------------ */

describe("the Self-host smoke test's suites against the container", () => {
  const steps = jobOf("ci.yml", "selfhost").steps;
  const at = (name: string) => {
    const s = steps.find((st) => st.name === name);
    expect(s, name).toBeDefined();
    return s!;
  };

  it.each([
    [
      "Self-scan every published route",
      "Assert the self-scan actually ran",
      "VULNRADAR_SELF_SCAN_URL",
      "tests/selfscan",
      "selfscan-results.json",
    ],
    [
      "Attack the booted app (cross-site writes)",
      "Assert the attack suite actually ran",
      "VULNRADAR_ATTACK_URL",
      "tests/attack",
      "attack-results.json",
    ],
  ])(
    "%s points at the container only, and %s right after it",
    (run, assertion, variable, suite, report) => {
      const r = at(run);
      const a = at(assertion);
      expect(a.index).toBe(r.index + 1);
      expect(r.code).toMatch(
        new RegExp(`^ +${variable}: http://localhost:3000$`, "m"),
      );
      expect(r.code).toContain(`npx vitest run ${suite}`);
      expect(r.code).toContain(`--outputFile.json="$RUNNER_TEMP/${report}"`);
      expect(a.code).toContain(`process.env.RUNNER_TEMP + '/${report}'`);
      expect(a.code).toContain("if (skipped > 0 || passed === 0) {");
    },
  );

  it("runs the attack after the self-scan, on the same booted container", () => {
    expect(at("Attack the booted app (cross-site writes)").index).toBe(
      at("Assert the self-scan actually ran").index + 1,
    );
  });

  it("tests/attack contacts nothing but the URL it is given", () => {
    const dir = path.join(ROOT, "tests", "attack");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const text = readRepo(path.join("tests", "attack", file));
      // Every fetch goes to BASE, the address the job passes.
      for (const call of text.matchAll(/fetch\(([^,]+),/g)) {
        expect(call[1].trim(), file).toMatch(/^`\$\{BASE\}/);
      }
      // Any other host named is .invalid, which never resolves: data, sent
      // as an Origin header, never a destination.
      for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
        expect(m[1], file).toMatch(/^(localhost|[a-z0-9-]+[.]invalid)$/);
      }
    }
  });
});
