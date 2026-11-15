#!/usr/bin/env node
// Judges the JSON `npm audit --json` printed for each dependency tree, and
// writes the markdown report the scheduled workflow publishes.
//
//   node scripts/ci/audit-report.mjs --exceptions .github/audit-exceptions.json \
//     --tree root=audit-root.json --tree extension=audit-extension.json \
//     --report report.md
//
// A high or critical advisory fails unless .github/audit-exceptions.json
// names it, as {advisory, package, tree, reason, revisit}. An exception that
// matches no high or critical advisory fails too, so the list shrinks when
// the dependency is fixed. Everything below high goes to the report only.
//
// No dependencies.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FAILING = new Set(["high", "critical"]);
const ORDER = ["critical", "high", "moderate", "low", "info"];

/** GHSA-xxxx-xxxx-xxxx from an advisory URL, or the numeric source. */
function advisoryId(via) {
  const last = String(via.url ?? "")
    .split("/")
    .filter(Boolean)
    .pop();
  return last && last !== "advisories" ? last : String(via.source ?? "unknown");
}

/** Every advisory in one tree's audit, once each, with its own severity. */
export function advisoriesOf(tree, audit) {
  if (
    !audit ||
    typeof audit !== "object" ||
    audit.error ||
    typeof audit.vulnerabilities !== "object"
  ) {
    throw new Error(
      `npm audit printed no result for the ${tree} tree${audit?.error?.summary ? ` (${String(audit.error.summary).slice(0, 80)})` : ""}`,
    );
  }
  const found = new Map();
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const entry = {
        tree,
        package: via.name ?? name,
        advisory: advisoryId(via),
        severity: via.severity ?? vulnerability.severity ?? "info",
        title: via.title ?? "",
      };
      found.set(`${tree}\n${entry.package}\n${entry.advisory}`, entry);
    }
  }
  return [...found.values()];
}

/**
 * Sets the advisories against the exceptions. Returns what fails (a high or
 * critical advisory nobody listed), the exceptions that matched nothing, the
 * malformed ones, and what only goes in the report.
 */
export function judge(advisories, exceptions) {
  const malformed = [];
  const listed = [];
  for (const [n, e] of exceptions.entries()) {
    const ok = ["advisory", "package", "tree", "reason", "revisit"].every(
      (k) => typeof e?.[k] === "string" && e[k].trim() !== "",
    );
    if (ok) listed.push(e);
    else {
      malformed.push(
        `entry ${n} needs an advisory, a package, a tree, a reason and a revisit`,
      );
    }
  }
  const used = new Set();
  const failing = [];
  const reported = [];
  const accepted = [];
  for (const a of advisories) {
    if (!FAILING.has(a.severity)) {
      reported.push(a);
      continue;
    }
    const hit = listed.find(
      (e) =>
        e.advisory === a.advisory &&
        e.package === a.package &&
        e.tree === a.tree,
    );
    if (hit) {
      used.add(hit);
      accepted.push({ ...a, entry: hit });
    } else failing.push(a);
  }
  const stale = listed.filter((e) => !used.has(e));
  return { failing, stale, malformed, reported, accepted };
}

function plain(text) {
  return String(text)
    .split("")
    .map((ch) => (ch >= " " && ch <= "~" && ch !== "%" ? ch : "_"))
    .join("");
}

function cell(text) {
  return plain(text).replace(/[|]/g, "_");
}

export function reportMarkdown(result, trees) {
  const rows = (list) =>
    list
      .sort(
        (a, b) =>
          ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) ||
          a.package.localeCompare(b.package),
      )
      .map(
        (a) =>
          `| ${cell(a.tree)} | ${cell(a.package)} | ${cell(a.advisory)} | ${cell(a.severity)} | ${cell(a.title).slice(0, 90)} |`,
      );
  const table = (list) => [
    "| Tree | Package | Advisory | Severity | Title |",
    "|---|---|---|---|---|",
    ...rows(list),
    "",
  ];
  const out = [`Trees audited: ${trees.join(", ")}.`, ""];
  if (result.failing.length > 0) {
    out.push(
      "### Failing: high or critical, and not in audit-exceptions.json",
      "",
    );
    out.push(...table(result.failing));
  }
  if (result.accepted.length > 0) {
    out.push("### Accepted by audit-exceptions.json", "");
    out.push(
      "| Tree | Package | Advisory | Reason | Revisit |",
      "|---|---|---|---|---|",
      ...result.accepted.map(
        (a) =>
          `| ${cell(a.tree)} | ${cell(a.package)} | ${cell(a.advisory)} | ${cell(a.entry.reason).slice(0, 90)} | ${cell(a.entry.revisit)} |`,
      ),
      "",
    );
  }
  if (result.stale.length > 0) {
    out.push(
      "### Stale exceptions: no high or critical advisory matches them",
      "",
    );
    out.push(
      ...result.stale.map(
        (e) => `- ${cell(e.advisory)} in ${cell(e.package)} (${cell(e.tree)})`,
      ),
      "",
    );
  }
  if (result.reported.length > 0) {
    out.push("### Below high, for information", "");
    out.push(...table(result.reported));
  }
  if (
    result.failing.length +
      result.accepted.length +
      result.stale.length +
      result.reported.length ===
    0
  ) {
    out.push("No advisories in any tree.", "");
  }
  return out.join("\n");
}

function argValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1] !== undefined) values.push(argv[i + 1]);
  }
  return values;
}

export function main(argv, env = process.env) {
  const exceptionsFile = argValues(argv, "--exceptions")[0];
  const reportFile = argValues(argv, "--report")[0];
  const treeArgs = argValues(argv, "--tree").map((t) => {
    const at = t.indexOf("=");
    return [t.slice(0, at), t.slice(at + 1)];
  });
  if (!exceptionsFile || treeArgs.length === 0) {
    console.error(
      "usage: audit-report.mjs --exceptions <file> --tree <name>=<audit.json> [--tree ...] [--report <file>]",
    );
    return 2;
  }

  let exceptions;
  const advisories = [];
  try {
    exceptions = JSON.parse(readFileSync(exceptionsFile, "utf8"));
    if (!Array.isArray(exceptions)) throw new Error("not a list");
    for (const [tree, file] of treeArgs) {
      advisories.push(
        ...advisoriesOf(tree, JSON.parse(readFileSync(file, "utf8"))),
      );
    }
  } catch (error) {
    console.log(`::error::${plain(error.message)}`);
    return 1;
  }

  const result = judge(advisories, exceptions);
  const markdown = reportMarkdown(
    result,
    treeArgs.map(([tree]) => tree),
  );
  console.log(markdown);
  if (reportFile) writeFileSync(reportFile, `${markdown}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }

  for (const a of result.failing) {
    console.log(
      `::error::${plain(a.severity)} advisory ${plain(a.advisory)} in ${plain(a.package)} (${plain(a.tree)} tree): ${plain(a.title).slice(0, 80)}`,
    );
  }
  for (const e of result.stale) {
    console.log(
      `::error::audit-exceptions.json lists ${plain(e.advisory)} in ${plain(e.package)} (${plain(e.tree)}), which no high or critical advisory matches. Remove it.`,
    );
  }
  for (const m of result.malformed) console.log(`::error::${plain(m)}`);
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
