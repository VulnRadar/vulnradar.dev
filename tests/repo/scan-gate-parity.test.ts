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
 * Every `run:` script in a file: a block scalar as its indented lines, an
 * inline value as it is. Keys are matched at any indent, so a step list of
 * any depth is covered.
 */
function runScripts(source: string): string[] {
  const lines = source.split("\n");
  const scripts: string[] = [];
  lines.forEach((line, i) => {
    const match = /^(\s*)(- )?run:\s*(.*)$/.exec(line);
    if (!match) return;
    const inline = match[3].trim();
    if (!/^[|>][-+]?\s*$/.test(inline)) {
      scripts.push(inline);
      return;
    }
    // A `- run:` key sits two columns past its dash. The step's next key
    // (often the `env:` this guard asks for) starts at that column and ends
    // the script, so it must not be read as part of it.
    const keyIndent = match[1].length + (match[2] ? 2 : 0);
    const body: string[] = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() === "") {
        body.push("");
        continue;
      }
      if ((next.match(/^ */) as RegExpMatchArray)[0].length <= keyIndent) break;
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

  it("are read up to the step's next key, in either step layout", () => {
    const steps = [
      "    - run: |",
      '        echo "$X"',
      "      env:",
      "        X: ${{ inputs.x }}",
      "    - shell: bash",
      "      run: |",
      '        echo "$Y" ${{ inputs.y }}',
      "      env:",
      "        Y: ${{ inputs.y }}",
    ].join("\n");
    expect(runScripts(steps)).toEqual([
      '        echo "$X"',
      '        echo "$Y" ${{ inputs.y }}',
    ]);
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

/**
 * Run a gate script with a scan start that succeeds and answers `scanId`.
 * Every later request is answered 401, so a script that accepts the id makes
 * exactly one status request and stops there.
 */
function runGateStart(script: string, shell: "bash" | "sh", scanId: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "scan-gate-start-"));
  try {
    const calls = path.join(dir, "calls.log").replace(/\\/g, "/");
    const output = path.join(dir, "output.txt").replace(/\\/g, "/");
    const file = path.join(dir, "gate.sh").replace(/\\/g, "/");
    writeFileSync(
      file,
      [
        "curl() {",
        `  printf '%s\\n' "curl $*" >> '${calls}'`,
        "  code=401; out=''; prev=''",
        '  for arg in "$@"; do',
        '    case "$arg" in POST) code=201 ;; esac',
        '    case "$prev" in -o) out="$arg" ;; esac',
        '    prev="$arg"',
        "  done",
        '  if [ -n "$out" ]; then echo \'{}\' > "$out"; printf \'%s\' "$code";',
        "  else printf '{}\\n%s' \"$code\"; fi",
        "}",
        "jq() { cat > /dev/null; printf '%s\\n' \"$FAKE_SCAN_ID\"; }",
        script,
      ].join("\n"),
    );
    const result = spawnSync(shell, [file], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        ...GATE_DEFAULTS,
        FAKE_SCAN_ID: scanId,
        GITHUB_OUTPUT: output,
      },
    });
    const called = existsSync(calls) ? readFileSync(calls, "utf8") : "";
    return {
      status: result.status,
      out: `${result.stdout}${result.stderr}`,
      requests: called.split("\n").filter((line) => line.startsWith("curl ")),
      output: existsSync(output) ? readFileSync(output, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!shellAvailable).each([
  ["action.yml", ACTION_SH, "bash" as const],
  ["the GitLab template", GITLAB_SH, "sh" as const],
])(
  "%s takes the scan id from the reply only as a plain id",
  (_n, script, shell) => {
    // The id is pasted into the status and report paths, and the Action writes
    // it to $GITHUB_OUTPUT. "../../keys/5" sent the polls, with the key, to
    // another path on the API host, and a newline added an output line.
    it.each([
      ["../../keys/5"],
      [".."],
      ["a/b"],
      ["5?x=1"],
      ["abc\nscan-id=forged"],
      ["abc def"],
    ])("refuses %j before any request uses it", (scanId) => {
      const run = runGateStart(script, shell, scanId);
      expect(run.status, run.out).toBe(EXIT.ERROR);
      expect(run.requests, run.out).toHaveLength(1);
      expect(run.out).toContain("cannot be used in a URL");
      expect(run.out).not.toContain("Started scan");
      expect(run.output).not.toContain("scan-id=");
    });

    it.each([["0123456789abcdef0123456789abcdef"], ["456"]])(
      "polls the status of %j",
      (scanId) => {
        const run = runGateStart(script, shell, scanId);
        expect(run.requests, run.out).toHaveLength(2);
        expect(run.requests[1]).toContain(`/scan/status/${scanId}`);
        expect(run.out).toContain(`Started scan ${scanId} for`);
        if (shell === "bash") expect(run.output).toBe(`scan-id=${scanId}\n`);
      },
    );
  },
);

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

  it("checks the same counts against the same pattern", () => {
    const countCheck = (script: string) => {
      const match =
        /(for pair in "critical:[^\n]*)\n\s*case "\$\{pair#\*:\}" in\n\s*([^)\n]+\))/.exec(
          script,
        );
      expect(match, "a whole-number check over the counts").not.toBeNull();
      return [(match as RegExpExecArray)[1], (match as RegExpExecArray)[2]];
    };
    expect(countCheck(GITLAB_SH)).toEqual(countCheck(ACTION_SH));
    expect(countCheck(ACTION_SH)[1]).toBe("''|*[!0-9]*|??????????*)");
  });

  it("hands the counts to jq with printf, which no sh decodes", () => {
    // dash's echo turns the \n inside a JSON string into a line break,
    // and jq 1.7 then cannot parse the counts at all, so under dash, the sh
    // these tests run the template with on Ubuntu, a bad high count was
    // refused as a bad critical one.
    const backslash = String.fromCharCode(92);
    for (const script of [ACTION_SH, GITLAB_SH]) {
      expect(script).not.toContain('echo "$counts"');
      for (const field of [
        "critical",
        "high",
        "medium",
        "low",
        "total",
        "suppressed",
      ]) {
        expect(script).toContain(
          `${field}=$(printf '%s${backslash}n' "$counts" | jq '.${field}')`,
        );
      }
    }
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

const NL = String.fromCharCode(10);
const STAND_IN_CURL = read("tests/fixtures/scan-gate/stand-in-curl.sh");
const STAND_IN_JQ = read("tests/fixtures/scan-gate/stand-in-jq.sh");

/** A summary count as the API sends it, and as jq prints it without -r. */
type Count = { literal: string; printed: string };
const count = (literal: string, printed = literal): Count => ({
  literal,
  printed,
});
const ZERO = count("0");
const summaryWith = (field: string, value: Count) => ({
  critical: ZERO,
  high: ZERO,
  medium: ZERO,
  low: ZERO,
  total: ZERO,
  [field]: value,
});

/**
 * Run a gate script against a scan that completes on the first poll with no
 * findings array, so the counts come from `summary`. The body is written out
 * by hand because a literal such as 2.0 does not survive JSON.stringify.
 */
function runGateCounts(
  script: string,
  shell: "bash" | "sh",
  standInJq: boolean,
  summary: Record<string, Count>,
) {
  const dir = mkdtempSync(path.join(tmpdir(), "scan-gate-counts-"));
  try {
    const output = path.join(dir, "output.txt").replace(/\\/g, "/");
    const stepSummary = path.join(dir, "summary.md").replace(/\\/g, "/");
    const file = path.join(dir, "gate.sh").replace(/\\/g, "/");
    const fields = Object.entries(summary)
      .map(([name, value]) => `"${name}":${value.literal}`)
      .join(",");
    const env: Record<string, string> = {
      ...GATE_DEFAULTS,
      FAKE_STATUS_BODY: `{"status":"completed","result":{"summary":{${fields}}}}`,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: stepSummary,
    };
    for (const [name, value] of Object.entries(summary)) {
      env[`FAKE_COUNT_${name}`] = value.printed;
    }
    writeFileSync(
      file,
      [STAND_IN_CURL, standInJq ? STAND_IN_JQ : "", script].join("\n"),
    );
    const result = spawnSync(shell, [file], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return {
      status: result.status,
      out: `${result.stdout}${result.stderr}`,
      output: existsSync(output) ? readFileSync(output, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// jq 1.7 prints a number the way the reply wrote it, so 2.0 reaches the
// script as "2.0". jq 1.6 prints it as 2, which is a whole number and fine.
const jqKeepsDecimals =
  jqAvailable &&
  spawnSync("jq", [".c"], {
    input: '{"c":2.0}',
    encoding: "utf8",
  }).stdout.trim() === "2.0";

const NOT_WHOLE: [string, Count][] = [
  ["2.0", count("2.0")],
  ["a fraction", count("2.5")],
  ["a string of digits", count('"3"')],
  [
    "a string with a newline in it",
    count(JSON.stringify(`0${NL}scan-id=forged`)),
  ],
  ["a negative number", count("-1")],
  ["a number past the shell's integers", count("1e19", "10000000000000000000")],
  ["true", count("true")],
  ["a list", count("[1]")],
];

/** [field, label, value]: every way a count can fail, on every field. */
const REFUSALS: [string, string, Count][] = [
  ...NOT_WHOLE.map(([label, value]): [string, string, Count] => [
    "critical",
    label,
    value,
  ]),
  ...["high", "medium", "low", "total"].flatMap(
    (field): [string, string, Count][] => [
      [field, "a fraction", count("2.5")],
      [
        field,
        "a string with a newline in it",
        count(JSON.stringify(`0${NL}${field}=0`)),
      ],
    ],
  ),
];

// A full run forks a few dozen times, which is quick on a CI runner and
// seconds apiece on Windows. The stand-in runs, which go wherever there is a
// shell, keep to one case of each kind; the jq runs in CI take every case.
const STAND_IN_REFUSALS = REFUSALS.filter(
  ([field, label]) =>
    (field === "critical" &&
      [
        "2.0",
        "a string of digits",
        "a number past the shell's integers",
      ].includes(label)) ||
    (field === "low" && label === "a string with a newline in it"),
);
const FULL_RUN_MS = 120_000;

describe.each([
  ["action.yml", "a stand-in jq", ACTION_SH, "bash" as const, true],
  ["the GitLab template", "a stand-in jq", GITLAB_SH, "sh" as const, true],
  ["action.yml", "jq", ACTION_SH, "bash" as const, false],
  ["the GitLab template", "jq", GITLAB_SH, "sh" as const, false],
])(
  "%s judges only whole-number summary counts, read with %s",
  (_name, _jq, script, shell, standInJq) => {
    // With no findings array the counts come from `summary` as the reply
    // wrote them. `[ 2.0 -gt 0 ]` is an error, an error inside `if` is just
    // false, and so a count the shell could not compare passed the gate. The
    // Action also writes each count to $GITHUB_OUTPUT, where a newline in one
    // added an output line of the reply's choosing.
    const runnable = shellAvailable && (standInJq || jqAvailable);
    const run = (summary: Record<string, Count>) =>
      runGateCounts(script, shell, standInJq, summary);

    it.skipIf(!runnable).each(standInJq ? STAND_IN_REFUSALS : REFUSALS)(
      "refuses a %s count that is %s with exit 2",
      (field, label, value) => {
        if (!standInJq && label === "2.0" && !jqKeepsDecimals) return;
        const result = run(summaryWith(field, value));
        expect(result.status, result.out).toBe(EXIT.ERROR);
        expect(result.out).toContain(
          `Scan abc123 reported a ${field} count that is not a whole number`,
        );
        expect(result.out).not.toContain("Scan complete");
        expect(result.out).not.toContain("scan-id=forged");
        expect(result.output).not.toMatch(
          /^(critical|high|medium|low|total)=/m,
        );
        expect(result.output).not.toContain("forged");
      },
      FULL_RUN_MS,
    );

    it.skipIf(!runnable)(
      "passes and reports whole-number counts",
      () => {
        const result = run({
          ...summaryWith("medium", count("3")),
          low: count("4"),
          total: count("7"),
        });
        expect(result.status, result.out).toBe(0);
        expect(result.out).toContain(
          "Scan complete: critical=0 high=0 medium=3 low=4 total=7",
        );
        if (shell === "bash") {
          expect(result.output).toContain(
            ["critical=0", "high=0", "medium=3", "low=4", "total=7", ""].join(
              NL,
            ),
          );
        }
      },
      FULL_RUN_MS,
    );

    it.skipIf(!runnable || standInJq)(
      "reads a null count as 0, as the CLI does",
      () => {
        const result = run(summaryWith("critical", count("null", "0")));
        expect(result.status, result.out).toBe(0);
      },
      FULL_RUN_MS,
    );

    it.skipIf(!runnable).each(standInJq ? [["3"]] : [["3"], ["999999999"]])(
      "fails the gate on a critical count of %s",
      (critical) => {
        const result = run(summaryWith("critical", count(critical)));
        expect(result.status, result.out).toBe(EXIT.GATE_FAILED);
        expect(result.out).toContain(
          `${critical} critical finding(s) exceed the max of 0`,
        );
      },
      FULL_RUN_MS,
    );
  },
);

describe("the CLI refuses the summary counts the two scripts refuse", () => {
  // Number(value) || 0 read "lots" and NaN as 0 and took -1 and a fraction
  // as they were, so a summary-only result failed open in the CLI alone.
  // 2.0 is left out: JSON.parse reads it as the whole number 2, which only
  // jq 1.7 prints back as written.
  it.each(REFUSALS.filter(([, label]) => label !== "2.0"))(
    "names a %s count that is %s",
    (field, _label, value) => {
      const summary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
      const counts = gateCounts({
        summary: { ...summary, [field]: JSON.parse(value.literal) },
      });
      expect(counts.unreadable).toBe(field);
    },
  );

  it.each([
    ["a null count", null, 0],
    ["a missing count", undefined, 0],
    ["the largest nine-digit count", 999_999_999, 999_999_999],
  ])("reads %s as the scripts do", (_label, value, expected) => {
    const counts = gateCounts({ summary: { critical: value } });
    expect(counts.unreadable).toBeNull();
    expect(counts.critical).toBe(expected);
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
