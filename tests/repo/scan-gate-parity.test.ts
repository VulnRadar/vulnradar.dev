/**
 * The CLI, the GitHub Action and the GitLab template are one gate in three
 * places, and nothing tied them together.
 *
 * Each decides pass or fail from a scan result, and each was written by hand
 * against the same fields. They drifted: the CLI learned to read
 * `result.incomplete` and to leave out findings the owner marked a false
 * positive while the other two kept judging `result.summary`, so the same scan
 * passed in one pipeline and failed in another. These tests hold the fields,
 * the counting rule, the label list and the documented flags to one
 * description, so the next change to the gate has to be made in all three.
 *
 * The jq half runs the filters the two CI files actually contain through a
 * real `jq` and compares the answer with the CLI's. It skips where there is no
 * jq (CI runners have it).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { INCOMPLETE_LABELS as APP_INCOMPLETE_LABELS } from "@/lib/scanner/incomplete-labels";
import { BOT_CHALLENGE_INCOMPLETE } from "@/lib/scanner/bot-challenge";
import { PAGE_UNREACHABLE_INCOMPLETE } from "@/lib/scanner/target-failure";
import {
  BLOCKING_INCOMPLETE,
  EXIT,
  INCOMPLETE_LABELS as CLI_INCOMPLETE_LABELS,
  USAGE,
  gateCounts,
  hasSummary,
  incompleteOutcome,
} from "../../cli/lib.mjs";

const read = (relative: string) =>
  readFileSync(path.join(process.cwd(), relative), "utf8");

const ACTION = read(".github/actions/scan-gate/action.yml");
const GITLAB = read("public/gitlab/vulnradar-scan.gitlab-ci.yml");
const CLI_README = read("cli/README.md");
const CLI_DOCS_PAGE = read("app/docs/cli/page.tsx");

/** The first shell block scalar (`run: |` or `- |`) of a CI file, dedented. */
function shellOf(source: string): string {
  const lines = source.split("\n");
  const opener = lines.findIndex(
    (line) => /^\s+run:\s*\|\s*$/.test(line) || /^\s+- \|\s*$/.test(line),
  );
  expect(opener).toBeGreaterThan(-1);
  const indent = (lines[opener + 1].match(/^ */) as RegExpMatchArray)[0].length;
  const body: string[] = [];
  for (const line of lines.slice(opener + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if ((line.match(/^ */) as RegExpMatchArray)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return `${body.join("\n")}\n`;
}

const ACTION_SH = shellOf(ACTION);
const GITLAB_SH = shellOf(GITLAB);

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** The jq program in `gate_counts_jq='...'`. */
function countsProgram(script: string): string {
  const match = /gate_counts_jq='([^']+)'/.exec(script);
  expect(match, "gate_counts_jq is defined").not.toBeNull();
  return (match as RegExpExecArray)[1];
}

/** The program in the first `jq -e '...'` (the summary guard). */
function guardProgram(script: string): string {
  const match = /jq -e '([^']+)'/.exec(script);
  expect(match, "a jq -e summary guard").not.toBeNull();
  return (match as RegExpExecArray)[1];
}

/** The program that lists `result.incomplete`. */
function incompleteProgram(script: string): string {
  const match = /'(\[\(\.result\.incomplete[^']*)'/.exec(script);
  expect(match, "a jq program reading result.incomplete").not.toBeNull();
  return (match as RegExpExecArray)[1];
}

describe("the CLI's label list and the app's", () => {
  it("names exactly the areas the app can report as not checked", () => {
    expect(Object.keys(CLI_INCOMPLETE_LABELS).sort()).toEqual(
      Object.keys(APP_INCOMPLETE_LABELS).sort(),
    );
  });

  it("blocks on the two areas that mean the page was never read", () => {
    expect([...BLOCKING_INCOMPLETE].sort()).toEqual(
      [BOT_CHALLENGE_INCOMPLETE, PAGE_UNREACHABLE_INCOMPLETE].sort(),
    );
  });
});

describe.each([
  ["action.yml", ACTION, ACTION_SH],
  ["the GitLab template", GITLAB, GITLAB_SH],
])("%s reads what the CLI reads", (_name, source, script) => {
  it("judges findings, the summary object, incomplete areas and the failure kind", () => {
    for (const field of [
      "findings",
      "suppressed",
      ".severity",
      "summary",
      "incomplete",
      "pageUnreachable",
      "redirectHost",
      "failureKind",
    ]) {
      expect(script, field).toContain(field);
    }
  });

  it("blocks on the same areas, with the same exit codes", () => {
    for (const slug of BLOCKING_INCOMPLETE) expect(script).toContain(slug);
    expect(script).toContain(`exit ${EXIT.GATE_FAILED}`);
    expect(script).toContain(`exit ${EXIT.ERROR}`);
    expect(script).toContain(`exit ${EXIT.INCOMPLETE}`);
  });

  it("offers the same two knobs as the CLI's flags", () => {
    expect(source).toMatch(/fail-on-incomplete|FAIL_ON_INCOMPLETE/);
    expect(source).toMatch(/include-suppressed|INCLUDE_SUPPRESSED/);
  });

  it("is valid shell", () => {
    const probe = spawnSync("bash", ["--version"]);
    if (probe.status !== 0) return;
    const dir = mkdtempSync(path.join(tmpdir(), "scan-gate-"));
    try {
      const file = path.join(dir, "gate.sh").replace(/\\/g, "/");
      writeFileSync(file, script);
      const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Every `run:` script in a file: block scalars dedented, inline values as
 * they are. Keys are matched at any indent, so a step list of any depth is
 * covered.
 */
function runScripts(source: string): string[] {
  const lines = source.split("\n");
  const scripts: string[] = [];
  lines.forEach((line, i) => {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (!match) return;
    const inline = match[2].trim();
    if (!/^[|>][-+]?\s*$/.test(inline)) {
      scripts.push(inline);
      return;
    }
    const body: string[] = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() === "") {
        body.push("");
        continue;
      }
      if ((next.match(/^ */) as RegExpMatchArray)[0].length <= match[1].length)
        break;
      body.push(next);
    }
    scripts.push(body.join("\n"));
  });
  return scripts;
}

function actionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return actionFiles(full);
    return /\.ya?ml$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Run a gate script up to the point it would start a scan. curl and jq are
 * shell functions that record the call, so a script that gets past its input
 * checks shows up as a recorded request instead of a network call.
 */
function runGateInputs(
  script: string,
  shell: "bash" | "sh",
  env: Record<string, string>,
) {
  const dir = mkdtempSync(path.join(tmpdir(), "scan-gate-input-"));
  try {
    const calls = path.join(dir, "calls.log").replace(/\\/g, "/");
    const file = path.join(dir, "gate.sh").replace(/\\/g, "/");
    writeFileSync(
      file,
      [
        `curl() { echo "curl $*" >> '${calls}'; return 7; }`,
        `jq() { echo "jq $*" >> '${calls}'; echo '{}'; }`,
        script,
      ].join("\n"),
    );
    const result = spawnSync(shell, [file], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    const called = existsSync(calls) ? readFileSync(calls, "utf8") : "";
    return {
      status: result.status,
      out: `${result.stdout}${result.stderr}`,
      startedScan: called.includes("curl"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const shellAvailable = spawnSync("bash", ["--version"]).status === 0;

const GATE_DEFAULTS = {
  VR_URL: "https://example.com",
  VR_API_BASE: "http://127.0.0.1:9/api/v3",
  VR_CRAWL: "false",
  VR_MAX_CRITICAL: "0",
  VR_MAX_HIGH: "0",
  VR_MAX_MEDIUM: "-1",
  VR_INCLUDE_SUPPRESSED: "false",
  VR_FAIL_ON_INCOMPLETE: "never",
  VR_TIMEOUT: "",
  VR_POLL_INTERVAL: "5",
  VR_SARIF_FILE: "",
  VR_API_KEY: "vr_test",
  VULNRADAR_TOKEN: "vr_test",
};

describe("the composite actions' scripts", () => {
  const files = actionFiles(path.join(process.cwd(), ".github/actions"));

  it("are found", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(runScripts(ACTION)).toHaveLength(1);
  });

  it.each(files.map((file) => [path.relative(process.cwd(), file), file]))(
    "%s never puts an expression into a run script",
    (_name, file) => {
      // The runner expands `${{ }}` anywhere in a run script before the shell
      // sees it, and a backslash in front does not stop it. A value that
      // reaches the script that way is pasted into its source, so it goes
      // through `env:` instead and is read back as a quoted variable.
      for (const script of runScripts(readFileSync(file, "utf8"))) {
        expect(script).not.toContain("${{");
      }
    },
  );

  it.skipIf(!shellAvailable)(
    "still shows the secret to pass when the key is empty",
    () => {
      const run = runGateInputs(ACTION_SH, "bash", {
        ...GATE_DEFAULTS,
        VR_API_KEY: "",
      });
      expect(run.status).toBe(EXIT.ERROR);
      expect(run.startedScan).toBe(false);
      expect(run.out).toContain(
        "::error::api-key is empty. Pass it from a repo secret, e.g. ${{ secrets.VULNRADAR_TOKEN }}.",
      );
    },
  );
});

describe.skipIf(!shellAvailable).each([
  ["action.yml", ACTION_SH, "bash" as const],
  ["the GitLab template", GITLAB_SH, "sh" as const],
])("%s refuses a threshold it cannot compare", (_name, script, shell) => {
  // `[ 3 -gt "abc" ]` is an error, and an error inside `if` is just false, so
  // a threshold that is not a number used to pass every scan. It is refused
  // with exit 2 before the scan is started and charged.
  it.each([
    ["VR_MAX_CRITICAL", "abc"],
    ["VR_MAX_CRITICAL", ""],
    ["VR_MAX_CRITICAL", "1.5"],
    ["VR_MAX_CRITICAL", "-1"],
    ["VR_MAX_HIGH", "ten"],
    ["VR_MAX_HIGH", ""],
    ["VR_MAX_HIGH", "2 "],
    ["VR_MAX_MEDIUM", "abc"],
    ["VR_MAX_MEDIUM", "-x"],
  ])("%s=%j exits 2 without starting a scan", (name, value) => {
    const run = runGateInputs(script, shell, {
      ...GATE_DEFAULTS,
      [name]: value,
    });
    expect(run.startedScan, run.out).toBe(false);
    expect(run.status, run.out).toBe(EXIT.ERROR);
  });

  it.each([
    ["the defaults", {}],
    ["numbers", { VR_MAX_CRITICAL: "2", VR_MAX_HIGH: "10" }],
    ["an empty medium threshold", { VR_MAX_MEDIUM: "" }],
    ["a negative medium threshold", { VR_MAX_MEDIUM: "-5" }],
  ])("accepts %s and goes on to start the scan", (_label, extra) => {
    const run = runGateInputs(script, shell, { ...GATE_DEFAULTS, ...extra });
    expect(run.startedScan, run.out).toBe(true);
  });
});

describe("one counting rule in the Action and the template", () => {
  it("is the same jq program, character for character apart from whitespace", () => {
    expect(squash(countsProgram(GITLAB_SH))).toBe(
      squash(countsProgram(ACTION_SH)),
    );
    expect(squash(guardProgram(GITLAB_SH))).toBe(
      squash(guardProgram(ACTION_SH)),
    );
    expect(squash(incompleteProgram(GITLAB_SH))).toBe(
      squash(incompleteProgram(ACTION_SH)),
    );
  });
});

describe("the floating GitLab include", () => {
  it("does not start failing pipelines on an incomplete scan until it is switched on", () => {
    // The include is served live to every instance that references it, so a
    // default that exits 3 would turn pipelines red the moment this file is
    // deployed. The CLI and the pinned Action default to the strict value.
    expect(GITLAB).toMatch(/VR_FAIL_ON_INCOMPLETE: "never"/);
    expect(ACTION).toMatch(/fail-on-incomplete:[\s\S]*?default: "blocking"/);
  });
});

const jqAvailable = spawnSync("jq", ["--version"]).status === 0;

/** Run a jq program over a document and parse what it prints. */
function jq(program: string, input: unknown, args: string[] = []): unknown {
  const result = spawnSync("jq", ["-c", ...args, program], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const out = result.stdout.trim();
  return out === "" ? undefined : JSON.parse(out);
}

const SUMMARY = { critical: 3, high: 2, medium: 1, low: 4, info: 1, total: 11 };
const finding = (severity: string, suppressed?: boolean) => ({
  id: `${severity}-${suppressed ? "fp" : "open"}`,
  severity,
  ...(suppressed ? { suppressed: true } : {}),
});

const RESULTS: Record<string, unknown> = {
  "open and suppressed findings": {
    summary: SUMMARY,
    findings: [
      finding("critical"),
      finding("critical", true),
      finding("high", true),
      finding("medium"),
      finding("low"),
      finding("info"),
    ],
  },
  "only suppressed findings": {
    summary: SUMMARY,
    findings: [finding("critical", true), finding("high", true)],
  },
  "an empty findings array": { summary: SUMMARY, findings: [] },
  "no findings array, so the summary": { summary: SUMMARY },
  "a summary with missing counts": { summary: { critical: 1 } },
  "findings with entries that are not objects": {
    summary: SUMMARY,
    findings: [finding("high"), null, "x", 3, [finding("critical")]],
  },
};

describe.skipIf(!jqAvailable)("the jq filters give the CLI's answers", () => {
  it.each(Object.entries(RESULTS))(
    "counts the same for %s, with and without --include-suppressed",
    (_name, result) => {
      for (const includeSuppressed of [false, true]) {
        const fromJq = jq(
          countsProgram(ACTION_SH),
          { status: "completed", result },
          ["--argjson", "inc", String(includeSuppressed)],
        );
        const { critical, high, medium, low, total, suppressed } = gateCounts(
          result,
          { includeSuppressed },
        );
        expect(fromJq).toEqual({
          critical,
          high,
          medium,
          low,
          total,
          suppressed,
        });
      }
    },
  );

  it.each([
    ["a summary object", { summary: {} }],
    ["no summary", { findings: [] }],
    ["a summary array", { summary: [] }],
    ["a summary string", { summary: "1" }],
    ["a null summary", { summary: null }],
  ])("accepts or refuses %s as the CLI does", (_name, result) => {
    const guard = spawnSync("jq", ["-e", guardProgram(ACTION_SH)], {
      input: JSON.stringify({ status: "completed", result }),
    });
    expect(guard.status === 0).toBe(hasSummary(result));
  });

  it("refuses a result that is not an object", () => {
    for (const result of [null, "done", 7, []]) {
      const guard = spawnSync("jq", ["-e", guardProgram(ACTION_SH)], {
        input: JSON.stringify({ status: "completed", result }),
      });
      expect(guard.status === 0, JSON.stringify(result)).toBe(false);
      expect(hasSummary(result)).toBe(false);
    }
  });

  it.each([
    ["two areas", { incomplete: ["page-unreachable", "dns"] }],
    ["one area", { incomplete: ["bot-challenge"] }],
    ["none listed", { incomplete: [] }],
    ["no field", {}],
    ["entries that are not strings", { incomplete: ["dns", 3, null, "tls"] }],
    ["a field that is not a list", { incomplete: "dns" }],
  ])("lists %s as the CLI does", (_name, extra) => {
    const result = { summary: SUMMARY, ...extra };
    const fromJq = spawnSync("jq", ["-r", incompleteProgram(ACTION_SH)], {
      input: JSON.stringify({ status: "completed", result }),
      encoding: "utf8",
    });
    expect(fromJq.status).toBe(0);
    expect(fromJq.stdout.trim()).toBe(
      incompleteOutcome(result)
        .areas.map((area: { slug: string }) => area.slug)
        .join(","),
    );
  });
});

describe("the documented flags and exit codes are the ones the CLI has", () => {
  const flags = [
    ...new Set(
      USAGE.split("\n")
        .filter((line: string) => /^ {2}-/.test(line))
        .flatMap((line: string) => line.match(/--[a-z][a-z-]*/g) ?? []),
    ),
  ] as string[];

  it("finds the flags in the usage text", () => {
    expect(flags).toEqual(
      expect.arrayContaining([
        "--allow-incomplete",
        "--fail-on-incomplete",
        "--include-suppressed",
        "--cancel-on-timeout",
        "--allow-insecure",
        "--report",
      ]),
    );
  });

  it.each(["the CLI README", "the /docs/cli page"])(
    "lists every flag in %s",
    (which) => {
      const text = which === "the CLI README" ? CLI_README : CLI_DOCS_PAGE;
      const missing = flags.filter((flag) => !text.includes(flag));
      expect(missing).toEqual([]);
    },
  );

  it("lists every exit code in both", () => {
    for (const code of Object.values(EXIT) as number[]) {
      expect(CLI_README, `README exit ${code}`).toContain(`\`${code}\``);
      expect(CLI_DOCS_PAGE, `docs exit ${code}`).toContain(`code: "${code}"`);
    }
  });
});

describe("where the files send you for a key", () => {
  it.each([
    ["cli/README.md", CLI_README],
    ["cli/vulnradar.mjs", read("cli/vulnradar.mjs")],
    ["action.yml", ACTION],
    ["the GitLab template", GITLAB],
  ])("%s names Profile > Developer > API Keys, not Settings", (_name, text) => {
    expect(text).toContain("Profile > Developer > API Keys");
    expect(text).not.toContain("Settings > API Keys");
  });

  it("does not repeat plan caps that live in code", () => {
    expect(CLI_README).not.toMatch(/25\/50\/100\/250/);
    expect(ACTION).not.toMatch(/from 25 upwards/);
    expect(GITLAB).not.toMatch(/starts at 25/);
  });
});
