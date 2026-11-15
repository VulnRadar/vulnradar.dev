#!/usr/bin/env node
// The weekly "outdated packages and waiting pull requests" report, as
// markdown on stdout. It reads files and makes no request itself: the
// workflow fetches the registries and `gh` output into files first, so every
// host CI talks to is named in the workflow, where tests/repo/
// external-targets.test.ts reads it.
//
//   node scripts/ci/outdated-report.mjs --root . \
//     --npm-root outdated-root.json --npm-extension outdated-extension.json \
//     --npm-versions npm-11.json --node-index node-index.json \
//     --postgres-tags postgres-tags.json --prs prs.json [--now 2026-11-15T00:00:00Z]
//
// Three parts: npm packages with a newer version, the pins raised by hand
// (the npm the release installs, .nvmrc, the Postgres tag) against what is
// newest on their sources, and every open pull request with why it is
// waiting and how long until stale.yml marks it.
//
// No dependencies.

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86_400_000;

const semver = (v) =>
  String(v)
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);

export function compareVersions(a, b) {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

function cell(text) {
  return String(text ?? "")
    .split("")
    .map((ch) => (ch >= " " && ch <= "~" ? ch : "_"))
    .join("")
    .replace(/[|]/g, "_");
}

/** What kind of step it is from `from` to `to`. */
export function bumpKind(from, to) {
  const [a, b] = [semver(from), semver(to)];
  if (b[0] !== a[0]) return "major";
  if (b[1] !== a[1]) return "minor";
  return "patch";
}

export function outdatedTable(label, outdated) {
  if (outdated === null || typeof outdated !== "object") {
    return [`### ${label}`, "", "`npm outdated` left nothing readable.", ""];
  }
  const rows = Object.entries(outdated ?? {})
    .map(([name, v]) => ({
      name,
      current: v.current ?? "not installed",
      wanted: v.wanted ?? "",
      latest: v.latest ?? "",
      kind: v.current && v.latest ? bumpKind(v.current, v.latest) : "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (rows.length === 0)
    return [`### ${label}`, "", "Everything is current.", ""];
  return [
    `### ${label}`,
    "",
    `${rows.length} packages have a newer version.`,
    "",
    "| Package | Current | Wanted | Latest | Step |",
    "|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${cell(r.name)} | ${cell(r.current)} | ${cell(r.wanted)} | ${cell(r.latest)} | ${cell(r.kind)} |`,
    ),
    "",
  ];
}

/** The highest version in an `npm view` answer: one string or a list. */
export function highestOf(versions) {
  const list = (Array.isArray(versions) ? versions : [versions])
    .filter((v) => typeof v === "string" && /^v?\d+[.]\d+[.]\d+$/.test(v))
    .sort(compareVersions);
  return list.at(-1) ?? null;
}

/** The newest 22.x in nodejs.org's index, whatever order it lists them in. */
export function newestNode(index, major) {
  return highestOf(
    (Array.isArray(index) ? index : [])
      .map((r) => r.version)
      .filter((v) => typeof v === "string" && v.startsWith(`v${major}.`)),
  );
}

/** The newest `<major>.<minor>-alpine` tag in Docker Hub's tag listing. */
export function newestPostgres(tags, major) {
  const names = (tags?.results ?? [])
    .map((t) => t.name)
    .filter(
      (n) =>
        typeof n === "string" && new RegExp(`^${major}[.]\\d+-alpine$`).test(n),
    );
  return (
    names
      .sort((a, b) =>
        compareVersions(a.replace("-alpine", ""), b.replace("-alpine", "")),
      )
      .at(-1) ?? null
  );
}

export function pinsTable(pins) {
  return [
    "### Pins raised by hand",
    "",
    "| Pin | Current | Newest | Status |",
    "|---|---|---|---|",
    ...pins.map((p) => {
      const behind =
        p.newest &&
        compareVersions(
          p.current.replace("-alpine", ""),
          p.newest.replace("-alpine", ""),
        ) < 0;
      const status =
        p.newest === null ? "could not read" : behind ? "behind" : "current";
      return `| ${cell(p.name)} | ${cell(p.current)} | ${cell(p.newest ?? "")} | ${status} |`;
    }),
    "",
  ];
}

const FAILED = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

export function checkState(rollup) {
  const checks = rollup ?? [];
  if (checks.length === 0) return "none";
  const failed = checks.some((c) => FAILED.has(c.conclusion ?? c.state ?? ""));
  if (failed) return "failing";
  const pending = checks.some(
    (c) =>
      (c.status !== undefined && c.status !== "COMPLETED") ||
      c.state === "PENDING",
  );
  return pending ? "running" : "passing";
}

/** Why a pull request is not merged, as short phrases. */
export function waitingReasons(pr) {
  const reasons = [];
  if (pr.isDraft) reasons.push("draft");
  const state = checkState(pr.statusCheckRollup);
  if (state === "failing") reasons.push("failing checks");
  if (state === "running") reasons.push("checks running");
  if (pr.reviewDecision === "REVIEW_REQUIRED") reasons.push("needs review");
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    reasons.push("changes requested");
  const labels = (pr.labels ?? []).map((l) => l.name);
  const bot = /dependabot/i.test(pr.author?.login ?? "");
  if (labels.includes("dependabot-merge-ignore")) {
    reasons.push("dependabot-merge-ignore: merge by hand");
  } else if (bot) {
    const bump = /from (\S+) to (\S+)/.exec(pr.title ?? "");
    if (bump && bumpKind(bump[1], bump[2]) !== "patch") {
      reasons.push(`${bumpKind(bump[1], bump[2])} bump: a person merges it`);
    }
  }
  return reasons;
}

/** Days until stale.yml marks the pull request, or "exempt". */
export function daysUntilStale(pr, stale, now) {
  const labels = (pr.labels ?? []).map((l) => l.name);
  if (labels.some((l) => stale.exempt.includes(l))) return "exempt";
  const idle = Math.floor((now - Date.parse(pr.updatedAt)) / DAY);
  const left = stale.days - idle;
  return left <= 0 ? "stale now" : `${left} days`;
}

export function readStalePolicy(workflow) {
  const days = Number(
    /^\s+days-before-stale:\s*(\d+)\s*$/m.exec(workflow)?.[1] ?? 60,
  );
  const exempt = (
    /^\s+exempt-pr-labels:\s*"([^"]*)"\s*$/m.exec(workflow)?.[1] ?? ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { days, exempt };
}

export function prTable(prs, stale, now) {
  if (prs.length === 0) return ["### Open pull requests", "", "None.", ""];
  const rows = [...prs]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((pr) => {
      const age = Math.floor((now - Date.parse(pr.createdAt)) / DAY);
      const reasons = waitingReasons(pr);
      return `| #${pr.number} ${cell(pr.title).slice(0, 70)} | ${age} days | ${cell(pr.author?.login)} | ${cell((pr.labels ?? []).map((l) => l.name).join(", "))} | ${checkState(pr.statusCheckRollup)} | ${cell(reasons.join("; ") || "ready")} | ${daysUntilStale(pr, stale, now)} |`;
    });
  return [
    "### Open pull requests",
    "",
    `${prs.length} open, oldest first.`,
    "",
    "| Pull request | Age | Author | Labels | Checks | Waiting on | Until stale |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ];
}

function readJson(file, fallback) {
  if (!file) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function buildReport({ root, files, now }) {
  const text = (rel) => readFileSync(path.join(root, rel), "utf8");
  const nvmrc = text(".nvmrc").trim();
  const npmPin =
    /npm@(\d+[.]\d+[.]\d+)/.exec(text(".github/workflows/release.yml"))?.[1] ??
    "unknown";
  const postgresPin =
    /^FROM postgres:(\S+?)@/m.exec(text(".github/tools/Dockerfile"))?.[1] ??
    "unknown";
  const npmMajor = npmPin.split(".")[0];
  const nodeMajor = nvmrc.split(".")[0];
  const postgresMajor = postgresPin.split(".")[0];

  const pins = [
    {
      name: `npm in release.yml (${npmMajor}.x)`,
      current: npmPin,
      newest: highestOf(readJson(files.npmVersions, null)),
    },
    {
      name: `Node in .nvmrc (${nodeMajor}.x)`,
      current: nvmrc,
      newest:
        newestNode(readJson(files.nodeIndex, []), nodeMajor)?.replace(
          /^v/,
          "",
        ) ?? null,
    },
    {
      name: `Postgres tag (${postgresMajor}.x-alpine)`,
      current: postgresPin,
      newest: newestPostgres(readJson(files.postgresTags, {}), postgresMajor),
    },
  ];
  const stale = readStalePolicy(text(".github/workflows/stale.yml"));
  const prs = readJson(files.prs, []);

  return [
    `Generated ${new Date(now).toISOString()}.`,
    "",
    ...outdatedTable(
      "Outdated npm packages: the app",
      readJson(files.npmRoot, null),
    ),
    ...outdatedTable(
      "Outdated npm packages: the extension",
      readJson(files.npmExtension, null),
    ),
    ...pinsTable(pins),
    ...prTable(prs, stale, now),
  ].join("\n");
}

function argValue(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

export function main(argv) {
  const root = argValue(argv, "--root") ?? ".";
  const now = argValue(argv, "--now")
    ? Date.parse(argValue(argv, "--now"))
    : Date.now();
  if (Number.isNaN(now)) {
    console.error("--now is not a date");
    return 2;
  }
  const files = {
    npmRoot: argValue(argv, "--npm-root"),
    npmExtension: argValue(argv, "--npm-extension"),
    npmVersions: argValue(argv, "--npm-versions"),
    nodeIndex: argValue(argv, "--node-index"),
    postgresTags: argValue(argv, "--postgres-tags"),
    prs: argValue(argv, "--prs"),
  };
  console.log(buildReport({ root, files, now }));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
