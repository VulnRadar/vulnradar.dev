#!/usr/bin/env node
// Turns the JSON `web-ext lint --output json` prints into a pass or a fail,
// the way AMO's own review would read it: an error fails, a warning or a
// notice is reported and does not.
//
//   node scripts/ci/web-ext-lint-report.mjs <report.json> <lint-exceptions.json>
//
// An error the extension cannot fix is listed in lint-exceptions.json as
// {code, file, reason}. An exception that matches no error fails too, so the
// list shrinks when the problem is fixed instead of keeping a name for
// something that is gone.
//
// No dependencies. The report and the file names in it come from linting our
// own build, but a name still goes through the same filter before it reaches
// a workflow command or the job summary.

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** A file name or message made safe for a `::error` command or a table cell. */
function plain(text, allowed) {
  return String(text ?? "")
    .split("")
    .map((ch) => (allowed.test(ch) ? ch : "_"))
    .join("");
}

const FILE_CHARS = /[A-Za-z0-9._/+@-]/;
const TEXT_CHARS = /[ -~]/;

function sameFinding(a, b) {
  return a.code === b.code && (a.file ?? "") === (b.file ?? "");
}

/**
 * Judges one web-ext report against the exceptions list.
 *
 * Returns the findings that fail, the exceptions that matched nothing, the
 * entries of the list that are malformed, and the warnings and notices to
 * report.
 */
export function evaluate(report, exceptions) {
  const malformed = [];
  const listed = [];
  for (const [n, e] of exceptions.entries()) {
    const ok =
      e &&
      typeof e.code === "string" &&
      e.code !== "" &&
      typeof e.file === "string" &&
      typeof e.reason === "string" &&
      e.reason.trim() !== "";
    if (ok) listed.push(e);
    else malformed.push(`entry ${n} needs a code, a file and a reason`);
  }
  const used = new Set();
  const failing = [];
  for (const finding of report.errors ?? []) {
    const hit = listed.find((e) => sameFinding(e, finding));
    if (hit) used.add(hit);
    else failing.push(finding);
  }
  const stale = listed.filter((e) => !used.has(e));
  return {
    failing,
    stale,
    malformed,
    warnings: report.warnings ?? [],
    notices: report.notices ?? [],
  };
}

/** The job-summary table for the findings that do not fail the job. */
export function summaryTable(warnings, notices) {
  const rows = [
    ...warnings.map((f) => ["warning", f]),
    ...notices.map((f) => ["notice", f]),
  ];
  if (rows.length === 0) return ["web-ext lint: no warnings or notices.", ""];
  return [
    "### web-ext lint warnings and notices",
    "",
    "| Level | Code | File | Message |",
    "|---|---|---|---|",
    ...rows.map(
      ([level, f]) =>
        `| ${level} | ${plain(f.code, FILE_CHARS)} | ${plain(f.file, FILE_CHARS)} | ${plain(f.message, TEXT_CHARS).replace(/[|]/g, "_")} |`,
    ),
    "",
  ];
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function main(argv, env = process.env) {
  const [reportFile, exceptionsFile] = argv;
  if (!reportFile || !exceptionsFile) {
    console.error(
      "usage: web-ext-lint-report.mjs <report.json> <lint-exceptions.json>",
    );
    return 2;
  }
  let report;
  let exceptions;
  try {
    report = readJson(reportFile);
    exceptions = readJson(exceptionsFile);
  } catch (error) {
    console.log(
      `::error::web-ext lint left no readable report, or the exceptions file is not JSON (${plain(error.message, TEXT_CHARS)}).`,
    );
    return 1;
  }
  if (
    !Array.isArray(report.errors) ||
    !Array.isArray(report.warnings) ||
    !Array.isArray(report.notices) ||
    !Array.isArray(exceptions)
  ) {
    console.log(
      "::error::web-ext lint did not print errors, warnings and notices, or lint-exceptions.json is not a list.",
    );
    return 1;
  }

  const result = evaluate(report, exceptions);
  const table = summaryTable(result.warnings, result.notices);
  console.log(
    `web-ext lint: ${report.errors.length} errors, ${result.warnings.length} warnings, ${result.notices.length} notices.`,
  );
  for (const line of table) console.log(line);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${table.join("\n")}\n`);
  }

  for (const f of result.failing) {
    console.log(
      `::error file=${plain(f.file, FILE_CHARS)}::${plain(f.code, FILE_CHARS)}: ${plain(f.message, TEXT_CHARS)}`,
    );
  }
  for (const e of result.stale) {
    console.log(
      `::error::lint-exceptions.json lists ${plain(e.code, FILE_CHARS)} in ${plain(e.file, FILE_CHARS)}, which web-ext no longer reports. Remove it.`,
    );
  }
  for (const m of result.malformed) console.log(`::error::${m}`);
  return result.failing.length + result.stale.length + result.malformed.length >
    0
    ? 1
    : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
