import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  evaluate,
  summaryTable,
} from "../../../scripts/ci/web-ext-lint-report.mjs";

/**
 * scripts/ci/web-ext-lint-report.mjs decides whether the Firefox package
 * passes the linter AMO uses. An error fails, a warning does not, and a name
 * in lint-exceptions.json that matches nothing fails, so the list cannot keep
 * the name of a problem that is gone.
 */

const SCRIPT = path.resolve(
  __dirname,
  "../../../scripts/ci/web-ext-lint-report.mjs",
);
const DIR = mkdtempSync(path.join(tmpdir(), "vr-web-ext-lint-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const finding = (code: string, file: string, message = "m") => ({
  code,
  file,
  message,
});

function run(report: unknown, exceptions: unknown, summary = false) {
  const reportFile = path.join(DIR, "report.json");
  const exceptionsFile = path.join(DIR, "exceptions.json");
  const summaryFile = path.join(DIR, "summary.md");
  writeFileSync(
    reportFile,
    typeof report === "string" ? report : JSON.stringify(report),
  );
  writeFileSync(exceptionsFile, JSON.stringify(exceptions));
  writeFileSync(summaryFile, "");
  const result = spawnSync(
    process.execPath,
    [SCRIPT, reportFile, exceptionsFile],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summary ? summaryFile : "",
      },
    },
  );
  return {
    status: result.status,
    out: result.stdout,
    summary: readFileSync(summaryFile, "utf8"),
  };
}

const clean = { errors: [], warnings: [], notices: [] };

describe("evaluate", () => {
  it("passes a report with no errors", () => {
    const r = evaluate(
      { ...clean, warnings: [finding("UNSAFE_VAR_ASSIGNMENT", "content.js")] },
      [],
    );
    expect(r.failing).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("fails an error that is not listed", () => {
    const err = finding("MANIFEST_FIELD_REQUIRED", "manifest.json");
    expect(evaluate({ ...clean, errors: [err] }, []).failing).toEqual([err]);
  });

  it("accepts an error listed by code and file, with a reason", () => {
    const err = finding("MANIFEST_FIELD_REQUIRED", "manifest.json");
    const r = evaluate({ ...clean, errors: [err] }, [
      { code: err.code, file: err.file, reason: "AMO accepts this one" },
    ]);
    expect(r.failing).toEqual([]);
    expect(r.stale).toEqual([]);
  });

  it("does not let one file's exception cover the same code in another", () => {
    const r = evaluate(
      { ...clean, errors: [finding("X", "a.js"), finding("X", "b.js")] },
      [{ code: "X", file: "a.js", reason: "r" }],
    );
    expect(r.failing.map((f: { file: string }) => f.file)).toEqual(["b.js"]);
  });

  it("reports an exception that matches nothing as stale", () => {
    const r = evaluate(clean, [{ code: "GONE", file: "x.js", reason: "r" }]);
    expect(r.stale).toHaveLength(1);
  });

  it("refuses an exception with no reason", () => {
    const r = evaluate(clean, [{ code: "X", file: "x.js", reason: " " }]);
    expect(r.malformed).toHaveLength(1);
  });
});

describe("summaryTable", () => {
  it("lists warnings and notices and keeps a pipe out of a cell", () => {
    const rows = summaryTable(
      [finding("W", "a.js", "one | two")],
      [finding("N", "b.js")],
    ).join("\n");
    expect(rows).toContain("| warning | W | a.js | one _ two |");
    expect(rows).toContain("| notice | N | b.js | m |");
  });
});

describe("the command", () => {
  it("exits 0 on warnings and writes them to the job summary", () => {
    const r = run(
      { ...clean, warnings: [finding("UNSAFE_VAR_ASSIGNMENT", "content.js")] },
      [],
      true,
    );
    expect(r.status).toBe(0);
    expect(r.summary).toContain("UNSAFE_VAR_ASSIGNMENT");
  });

  it("exits 1 on an unlisted error, naming it as an annotation", () => {
    const r = run(
      {
        ...clean,
        errors: [finding("MANIFEST_FIELD_REQUIRED", "manifest.json")],
      },
      [],
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "::error file=manifest.json::MANIFEST_FIELD_REQUIRED",
    );
  });

  it("exits 1 on a stale exception", () => {
    const r = run(clean, [{ code: "GONE", file: "x.js", reason: "r" }]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Remove it");
  });

  it("exits 1 when the report is not JSON, as when web-ext crashed", () => {
    const r = run("web-ext: something went wrong", []);
    expect(r.status).toBe(1);
    expect(r.out).toContain("::error::web-ext lint left no readable report");
  });

  it("does not let a message carry a second workflow command", () => {
    const r = run(
      {
        ...clean,
        errors: [finding("X", "a.js", "bad\n::set-output name=x::y")],
      },
      [],
    );
    const lines = r.out.split("\n").filter((l) => l.startsWith("::"));
    expect(lines).toHaveLength(1);
  });

  it("reads the real exceptions file as a list of well-formed entries", () => {
    const real = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          "../../../.github/tools/web-ext/lint-exceptions.json",
        ),
        "utf8",
      ),
    );
    expect(Array.isArray(real)).toBe(true);
    expect(evaluate(clean, real).malformed).toEqual([]);
  });
});
