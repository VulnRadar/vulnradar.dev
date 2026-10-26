#!/usr/bin/env node
/**
 * Merge the per-target result files of scripts/spike/run.mjs (and bench.json
 * of bench-serialise.mjs) into one pass or fail table per SPIKE item, the
 * fallback spec 14.1 names for each failure, and the details behind every
 * cell. Prints to stdout and, on GitHub Actions, to the job summary.
 *
 *   node scripts/spike/summarise.mjs spike-results [--strict]
 *
 * Exits 1 when any item failed or errored, or a mutation went undetected.
 * With --strict it also exits 1 when any target or the mutations left no
 * result, so a skipped image cannot read as a pass.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FALLBACKS, SPIKE_TITLES, itemVerdict } from "./lib/report.mjs";

const TARGET_ORDER = ["dev", "start", "start-h", "image"];
const TARGET_LABEL = {
  dev: "next dev",
  start: "next start",
  "start-h": "next start -H",
  image: "image",
};
const ITEMS = [1, 2, 3, 4, 5, 6];

function load(dir, name) {
  const file = path.join(dir, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

function cell(result, item) {
  if (!result) return "not run";
  if (result.skipped) return "not run";
  if (result.error) return "ERROR";
  return itemVerdict(result.checks.filter((c) => c.spike === item));
}

function overall(cells) {
  const ran = cells.filter((c) => c !== "not run");
  const real = ran.filter((c) => c !== "SKIP" && c !== "n/a");
  if (real.some((c) => c === "FAIL" || c === "ERROR")) return "FAIL";
  if (!real.length) return "NOT PROVEN";
  return ran.length < cells.length ? "PARTIAL" : "PASS";
}

export function buildSummary(results, bench, mutations = []) {
  const lines = [];
  const present = TARGET_ORDER;
  const header = ["SPIKE", "Claim", ...present.map((t) => TARGET_LABEL[t])];
  lines.push("## API rewrite spike", "");
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`|${header.map(() => "---").join("|")}|`);

  const verdicts = {};
  for (const item of ITEMS) {
    const cells = present.map((t) => cell(results[t], item));
    verdicts[item] = overall(cells);
    lines.push(`| ${item} | ${SPIKE_TITLES[item]} | ${cells.join(" | ")} |`);
  }
  const benchVerdict = bench
    ? bench.needsNative
      ? "FAIL"
      : "PASS"
    : "not run";
  verdicts[7] = benchVerdict;
  const benchCells = present.map((_, i) =>
    i === 0 ? `${benchVerdict} (node bench)` : "-",
  );
  lines.push(`| 7 | ${SPIKE_TITLES[7]} | ${benchCells.join(" | ")} |`);
  lines.push("");

  const meta = present
    .filter((t) => results[t])
    .map((t) => {
      const r = results[t];
      return r.skipped
        ? `${TARGET_LABEL[t]}: skipped (${r.skipped})`
        : `${TARGET_LABEL[t]}: Next ${r.next ?? "?"}, Node ${r.node}, ${r.platform}`;
    })
    .join("; ");
  lines.push(`Runs: ${meta}`, "");

  lines.push("### Verdict per item", "");
  for (const item of [...ITEMS, 7]) {
    const v = verdicts[item];
    lines.push(`**SPIKE ${item}: ${v}.** ${SPIKE_TITLES[item]}.`);
    if (v === "PARTIAL" || v === "NOT PROVEN") {
      const missing = present.filter((t) => !results[t] || results[t].skipped);
      lines.push(
        `Not run in: ${missing.map((t) => TARGET_LABEL[t]).join(", ")}.`,
      );
    }
    if (v === "FAIL") {
      lines.push(`Fallback (spec 14.1): ${FALLBACKS[item]}`);
      for (const t of present) {
        const r = results[t];
        if (!r) continue;
        if (r.error) {
          lines.push(
            `- ${TARGET_LABEL[t]}: run error: ${r.error.split("\n")[0]}`,
          );
          continue;
        }
        for (const c of r.checks) {
          if (c.spike === item && c.status === "fail") {
            lines.push(`- ${TARGET_LABEL[t]} ${c.id} ${c.title}: ${c.detail}`);
          }
        }
      }
      if (item === 7 && bench) lines.push(`- ${bench.verdict}`);
    } else if (item === 7 && bench) {
      lines.push(bench.verdict);
    }
    lines.push("");
  }

  if (bench) {
    lines.push("### SPIKE 7 numbers", "");
    lines.push(
      `${bench.node} on ${bench.cpu} (${bench.platform}). Long-task line ${bench.longTaskMs} ms, verdict taken at ${bench.verdictSizeMb} MB.`,
      "",
      "| Body MB | Findings | v3 stringify ms | Parse ms | Project ms | Stringify ms | Wrapper adds ms (p95) | Longest block ms (p95) | Native adds ms |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    for (const r of bench.rows) {
      lines.push(
        `| ${r.mb} | ${r.findings} | ${r.v3StringifyMs} | ${r.parseMs} | ${r.projectMs} | ${r.stringifyMs} | ${r.wrapperAddedMs} (${r.wrapperAddedP95Ms}) | ${r.longestBlockMs} (${r.longestBlockP95Ms}) | ${r.nativeAddedMs} |`,
      );
    }
    lines.push("");
  }

  if (mutations.length) {
    lines.push(
      "### The harness can fail",
      "",
      "Each row breaks the scratch copy of the fixture on purpose. The checks named in the third column must report a failure; if one does not, the table above cannot be trusted for that claim.",
      "",
      "| Mutation | What it breaks | Must fail | Result |",
      "|---|---|---|---|",
    );
    for (const m of mutations) {
      lines.push(
        `| ${m.name} | ${m.describes} | ${m.expectFail.join(", ")} | ${m.detected ? "detected" : `MISSED (${m.missed.join(", ") || "run error"})`} |`,
      );
    }
    lines.push("");
  }

  lines.push("### What was recorded", "");
  for (const t of present) {
    const r = results[t];
    if (!r || r.skipped || r.error) continue;
    lines.push(`**${TARGET_LABEL[t]}**`, "");
    for (const c of r.checks) {
      if (
        c.status === "info" ||
        c.status === "warn" ||
        c.id === "5b" ||
        c.id === "5c"
      ) {
        lines.push(`- ${c.id} (${c.status}) ${c.title}: ${c.detail}`);
      }
    }
    lines.push("");
  }

  lines.push("### Every check", "");
  for (const t of present) {
    const r = results[t];
    if (!r || r.skipped || r.error) continue;
    lines.push(
      `<details><summary>${TARGET_LABEL[t]} (${r.checks.length} checks)</summary>`,
      "",
    );
    lines.push("| Check | Status | Detail |", "|---|---|---|");
    for (const c of r.checks) {
      const detail = String(c.detail ?? "")
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ");
      lines.push(
        `| ${c.id} ${c.title} | ${c.status.toUpperCase()} | ${detail} |`,
      );
    }
    lines.push("", "</details>", "");
  }

  return { text: lines.join("\n"), verdicts };
}

function main() {
  const dir = path.resolve(process.argv[2] ?? "spike-results");
  const results = {};
  for (const t of TARGET_ORDER) {
    const r = load(dir, t);
    if (r) results[t] = r;
  }
  const bench = load(dir, "bench");
  if (!Object.keys(results).length && !bench) {
    console.error(`no result files in ${dir}`);
    process.exitCode = 1;
    return;
  }

  const mutations = loadMutations(dir);
  const { text, verdicts } = buildSummary(results, bench, mutations);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }

  const strict = process.argv.includes("--strict");
  const values = Object.values(verdicts);
  const failed =
    values.some((v) => v === "FAIL") || mutations.some((m) => !m.detected);
  const incomplete =
    values.some(
      (v) => v === "PARTIAL" || v === "NOT PROVEN" || v === "not run",
    ) || mutations.length === 0;
  if (failed || (strict && incomplete)) process.exitCode = 1;
}

/** Results of `run.mjs --mutate`, kept in a subdirectory of the results. */
function loadMutations(dir) {
  const sub = path.join(dir, "mutations");
  if (!existsSync(sub)) return [];
  return readdirSync(sub)
    .filter((f) => f.startsWith("mutation-") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(sub, f), "utf8")).mutation)
    .filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
