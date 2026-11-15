import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  advisoriesOf,
  judge,
  reportMarkdown,
} from "../../../scripts/ci/audit-report.mjs";

/**
 * scripts/ci/audit-report.mjs decides whether the daily dependency audit
 * fails. A high or critical advisory fails unless the exceptions file names
 * it with a reason and a date to revisit; an exception that matches nothing
 * fails too.
 */

const SCRIPT = path.resolve(__dirname, "../../../scripts/ci/audit-report.mjs");
const DIR = mkdtempSync(path.join(tmpdir(), "vr-audit-report-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const via = (name: string, severity: string, ghsa: string) => ({
  source: 1,
  name,
  title: `${name} problem`,
  url: `https://github.com/advisories/${ghsa}`,
  severity,
});

const audit = (vulnerabilities: Record<string, unknown>) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: {},
});

const exception = {
  advisory: "GHSA-aaaa-bbbb-cccc",
  package: "left-pad",
  tree: "root",
  reason: "dev only, never shipped",
  revisit: "wave 9 task 13",
};

describe("advisoriesOf", () => {
  it("reads each advisory once, with its own severity, from the via entries", () => {
    const found = advisoriesOf(
      "root",
      audit({
        "left-pad": {
          severity: "high",
          via: [via("left-pad", "high", "GHSA-aaaa-bbbb-cccc")],
        },
        // A package that only depends on the vulnerable one repeats nothing.
        consumer: { severity: "high", via: ["left-pad"] },
        "right-pad": {
          severity: "low",
          via: [via("right-pad", "low", "GHSA-dddd-eeee-ffff")],
        },
      }),
    );
    expect(found.map((a: { advisory: string }) => a.advisory).sort()).toEqual([
      "GHSA-aaaa-bbbb-cccc",
      "GHSA-dddd-eeee-ffff",
    ]);
  });

  it("refuses output that is not an audit, as when the registry was unreachable", () => {
    expect(() =>
      advisoriesOf("root", { error: { summary: "ENOTFOUND" } }),
    ).toThrow(/no result for the root tree/);
    expect(() => advisoriesOf("root", null)).toThrow();
  });
});

describe("judge", () => {
  const high = {
    tree: "root",
    package: "left-pad",
    advisory: "GHSA-aaaa-bbbb-cccc",
    severity: "high",
    title: "t",
  };

  it("fails a high or critical advisory nobody listed", () => {
    expect(judge([high], []).failing).toEqual([high]);
    expect(judge([{ ...high, severity: "critical" }], []).failing).toHaveLength(
      1,
    );
  });

  it("reports an advisory below high and does not fail it", () => {
    const r = judge([{ ...high, severity: "moderate" }], []);
    expect(r.failing).toEqual([]);
    expect(r.reported).toHaveLength(1);
  });

  it("accepts an advisory matched by advisory, package and tree", () => {
    expect(judge([high], [exception]).failing).toEqual([]);
    expect(judge([high], [exception]).accepted).toHaveLength(1);
    // The same advisory in another tree is a different finding.
    expect(
      judge([{ ...high, tree: "extension" }], [exception]).failing,
    ).toHaveLength(1);
  });

  it("fails an exception that matches no high advisory", () => {
    expect(judge([], [exception]).stale).toEqual([exception]);
    expect(judge([{ ...high, severity: "low" }], [exception]).stale).toEqual([
      exception,
    ]);
  });

  it("refuses an exception with no reason or no revisit date", () => {
    expect(judge([], [{ ...exception, reason: "" }]).malformed).toHaveLength(1);
    expect(
      judge([], [{ ...exception, revisit: undefined }]).malformed,
    ).toHaveLength(1);
  });
});

describe("the command", () => {
  function run(trees: Record<string, unknown>, exceptions: unknown) {
    const exceptionsFile = path.join(DIR, "exceptions.json");
    writeFileSync(exceptionsFile, JSON.stringify(exceptions));
    const args = ["--exceptions", exceptionsFile];
    for (const [name, body] of Object.entries(trees)) {
      const file = path.join(DIR, `${name}.json`);
      writeFileSync(file, JSON.stringify(body));
      args.push("--tree", `${name}=${file}`);
    }
    const report = path.join(DIR, "report.md");
    args.push("--report", report);
    const out = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
    });
    return { status: out.status, out: out.stdout, report };
  }

  const bad = audit({
    "left-pad": {
      severity: "high",
      via: [via("left-pad", "high", "GHSA-aaaa-bbbb-cccc")],
    },
  });

  it("exits 0 on a clean tree and writes a report", () => {
    const r = run({ root: audit({}) }, []);
    expect(r.status).toBe(0);
    expect(readFileSync(r.report, "utf8")).toContain("No advisories");
  });

  it("exits 1 on an unlisted high advisory, naming it", () => {
    const r = run({ root: bad, extension: audit({}) }, []);
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "::error::high advisory GHSA-aaaa-bbbb-cccc in left-pad (root tree)",
    );
  });

  it("exits 0 when the advisory is listed, and 1 when the listing goes stale", () => {
    expect(run({ root: bad }, [exception]).status).toBe(0);
    const stale = run({ root: audit({}) }, [exception]);
    expect(stale.status).toBe(1);
    expect(stale.out).toContain("Remove it");
  });

  it("exits 1 when npm audit left nothing readable", () => {
    expect(run({ root: { error: { summary: "x" } } }, []).status).toBe(1);
  });

  it("reads the real exceptions file as a list of well-formed entries", () => {
    const real = JSON.parse(
      readFileSync(
        path.resolve(__dirname, "../../../.github/audit-exceptions.json"),
        "utf8",
      ),
    );
    expect(Array.isArray(real)).toBe(true);
    expect(judge([], real).malformed).toEqual([]);
  });
});

describe("reportMarkdown", () => {
  it("keeps a pipe in a title out of a table cell", () => {
    const md = reportMarkdown(
      judge(
        [
          {
            tree: "root",
            package: "p",
            advisory: "A",
            severity: "low",
            title: "a | b",
          },
        ],
        [],
      ),
      ["root"],
    );
    expect(md).toContain("a _ b");
  });
});
