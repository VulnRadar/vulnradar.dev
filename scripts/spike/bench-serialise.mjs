#!/usr/bin/env node
/**
 * SPIKE 7 (spec 14.1 item 7): what `versioned()` costs on a large JSON body.
 *
 * For a v4 request on a JSON route the wrapper reads the handler's Response
 * (clone, parse), runs the operation's adapter (an allow-list projection) and
 * serialises the result again. v3 pays none of that. The question is whether
 * that is acceptable on `history/[id]` and `scan/status/[id]`, which for a
 * crawl scan reach megabytes, or whether those two need a native serialiser
 * that builds the v4 body straight from the row.
 *
 * This is a plain node benchmark: the cost is CPU on the event loop, so the
 * server, the database and the network are irrelevant to it. The body is
 * synthetic but shaped like the real thing (a Vulnerability list with
 * evidence and remediation, the history/[id] envelope around it), built from
 * a fixed seed so two runs compare.
 *
 *   node --expose-gc scripts/spike/bench-serialise.mjs [--out spike-results]
 *
 * The verdict rule is stated in one place, below, with its number: a single
 * synchronous block longer than LONG_TASK_MS stalls every other request in the
 * process for that long, so a route whose wrapper holds the loop that long at
 * its realistic worst case needs a native serialiser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

const LONG_TASK_MS = 50;
const SIZES_MB = [0.25, 1, 2, 5, 10];
const VERDICT_SIZE_MB = 5;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function words(random, count) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const out = [];
  for (let i = 0; i < count; i++) {
    let w = "";
    const len = 3 + Math.floor(random() * 8);
    for (let j = 0; j < len; j++) w += alphabet[Math.floor(random() * 26)];
    out.push(w);
  }
  return out.join(" ");
}

function finding(random, i) {
  return {
    id: `chk-${i % 700}-${i}`,
    checkId: `headers.${i % 700}`,
    title: words(random, 6),
    severity: ["critical", "high", "medium", "low", "info"][i % 5],
    category: ["headers", "ssl", "content", "cookies", "api"][i % 5],
    description: words(random, 40),
    confidence: Math.round(random() * 100) / 100,
    cwe: [`CWE-${100 + (i % 900)}`],
    location: `https://example.test/${words(random, 2).replace(/ /g, "/")}`,
    evidence: [
      { label: "Header", value: words(random, 8), excerpt: words(random, 30) },
      { label: "Body", value: words(random, 6), excerpt: words(random, 24) },
    ],
    remediation: {
      summary: words(random, 18),
      steps: [words(random, 14), words(random, 14), words(random, 12)],
      effort: "low",
      references: [
        `https://docs.example.test/${i}`,
        `https://cwe.example.test/${i}`,
      ],
    },
    status: "open",
    firstSeenAt: "2026-10-01T12:00:00.000Z",
    internalScore: random(),
    legacyKey: `f${i}`,
  };
}

/** A history/[id] body of about `bytes` characters. */
function buildScan(bytes) {
  const random = rng(20261026);
  const scan = {
    id: 48211,
    url: "https://example.test/",
    scannedAt: "2026-10-26T12:00:00.000Z",
    duration: 18432,
    summary: { critical: 1, high: 4, medium: 17, low: 40, info: 80 },
    findings: [],
    responseHeaders: Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => [`x-header-${i}`, words(random, 5)]),
    ),
    notes: "",
    userId: 7,
    authenticated: false,
    isPublic: true,
    teamId: null,
    teamIds: [],
    tags: [{ tag: "prod", source: "user" }],
    checksRun: 310,
    dangerScore: 62,
    engineConfidence: 0.91,
    incomplete: false,
  };
  let size = JSON.stringify(scan).length;
  let i = 0;
  while (size < bytes) {
    const f = finding(random, i++);
    scan.findings.push(f);
    size += JSON.stringify(f).length + 1;
  }
  return scan;
}

/** Stand-in for an adapter: allow-list projection to the closed v4 shape. */
function project(scan) {
  return {
    id: "0123456789abcdef0123456789abcdef",
    url: scan.url,
    scannedAt: scan.scannedAt,
    durationMs: scan.duration,
    summary: { ...scan.summary },
    findings: scan.findings.map((f) => ({
      id: f.id,
      checkId: f.checkId,
      title: f.title,
      severity: f.severity,
      category: f.category,
      description: f.description,
      confidence: f.confidence,
      cwe: f.cwe,
      location: f.location,
      evidence: f.evidence.map((e) => ({
        label: e.label,
        value: e.value,
        excerpt: e.excerpt,
      })),
      remediation: f.remediation && {
        summary: f.remediation.summary,
        steps: f.remediation.steps,
        effort: f.remediation.effort,
        references: f.remediation.references,
      },
      status: f.status,
      firstSeenAt: f.firstSeenAt,
    })),
    responseHeaders: scan.responseHeaders,
    notes: scan.notes,
    isPublic: scan.isPublic,
    teamIds: scan.teamIds,
    tags: scan.tags,
    checksRun: scan.checksRun,
    dangerScore: scan.dangerScore,
    incomplete: scan.incomplete,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
};
const round = (n) => Math.round(n * 10) / 10;

async function once(scan) {
  const headers = { "content-type": "application/json" };

  // What the handler does today: serialise the superset once.
  let t = performance.now();
  const v3Text = JSON.stringify(scan);
  const v3StringifyMs = performance.now() - t;

  // What versioned() adds for v4: read the response back, project, serialise.
  const res = new Response(v3Text, { headers });
  t = performance.now();
  const clone = res.clone();
  const data = await clone.json();
  const parseWallMs = performance.now() - t;

  t = performance.now();
  const projected = project(data);
  const projectMs = performance.now() - t;

  t = performance.now();
  const v4Text = JSON.stringify(projected);
  const stringifyMs = performance.now() - t;

  const out = new Response(v4Text, { headers });
  await out.arrayBuffer();

  // The native alternative: project the row the handler already holds and
  // serialise once, in place of the handler's own serialisation.
  t = performance.now();
  const nativeText = JSON.stringify(project(scan));
  const nativeMs = performance.now() - t;
  if (nativeText.length !== v4Text.length) {
    throw new Error("native and wrapped output differ in length");
  }

  // The synchronous pieces are what block other requests.
  t = performance.now();
  JSON.parse(v3Text);
  const parseSyncMs = performance.now() - t;

  return {
    v3StringifyMs,
    parseWallMs,
    parseSyncMs,
    projectMs,
    stringifyMs,
    nativeMs,
    bytesIn: v3Text.length,
    bytesOut: v4Text.length,
  };
}

async function measure(mb) {
  const scan = buildScan(Math.round(mb * 1024 * 1024));
  const runs = mb >= 5 ? 12 : 25;
  for (let i = 0; i < 3; i++) await once(scan);

  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const held = JSON.parse(JSON.stringify(scan));
  const heapMb = global.gc
    ? (process.memoryUsage().heapUsed - before) / 1048576
    : null;
  if (held.findings.length === 0) throw new Error("empty body");

  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await once(scan));
  const col = (key) => samples.map((s) => s[key]);

  const addedMs = samples.map(
    (s) => s.parseWallMs + s.projectMs + s.stringifyMs,
  );
  const longestBlock = samples.map((s) =>
    Math.max(s.parseSyncMs, s.projectMs, s.stringifyMs),
  );
  return {
    mb,
    bytes: samples[0].bytesIn,
    runs,
    findings: scan.findings.length,
    v3StringifyMs: round(median(col("v3StringifyMs"))),
    parseMs: round(median(col("parseSyncMs"))),
    projectMs: round(median(col("projectMs"))),
    stringifyMs: round(median(col("stringifyMs"))),
    wrapperAddedMs: round(median(addedMs)),
    wrapperAddedP95Ms: round(p95(addedMs)),
    nativeAddedMs: round(
      median(col("nativeMs")) - median(col("v3StringifyMs")),
    ),
    longestBlockMs: round(median(longestBlock)),
    longestBlockP95Ms: round(p95(longestBlock)),
    parsedHeapMb: heapMb === null ? null : round(heapMb),
  };
}

async function main() {
  const { values } = parseArgs({
    options: { out: { type: "string", default: "spike-results" } },
  });

  const rows = [];
  for (const mb of SIZES_MB) rows.push(await measure(mb));

  const verdictRow = rows.find((r) => r.mb === VERDICT_SIZE_MB);
  const needsNative = verdictRow.longestBlockP95Ms > LONG_TASK_MS;
  const perMb = verdictRow.longestBlockMs / verdictRow.mb;
  const result = {
    node: process.version,
    v8: process.versions.v8,
    cpu: os.cpus()[0]?.model ?? "unknown",
    platform: `${process.platform}-${process.arch}`,
    longTaskMs: LONG_TASK_MS,
    verdictSizeMb: VERDICT_SIZE_MB,
    rows,
    breakEvenMb: round(LONG_TASK_MS / perMb),
    needsNative,
    verdict: needsNative
      ? `FAIL: at ${VERDICT_SIZE_MB} MB the wrapper holds the event loop for ${verdictRow.longestBlockP95Ms} ms (p95), over the ${LONG_TASK_MS} ms long-task line. history/[id] and scan/status/[id] need a native serialiser that the handler and the adapter both call; the wrapper stays for the small routes.`
      : `PASS: at ${VERDICT_SIZE_MB} MB the longest synchronous block is ${verdictRow.longestBlockMs} ms (p95 ${verdictRow.longestBlockP95Ms} ms), under the ${LONG_TASK_MS} ms long-task line, and the wrapper adds ${verdictRow.wrapperAddedMs} ms in total. The wrapper is acceptable on history/[id] and scan/status/[id]; revisit above about ${round(LONG_TASK_MS / perMb)} MB per body.`,
  };

  console.log(
    `\nSPIKE 7: wrapper cost on a history/[id] body (${result.node}, ${result.cpu})\n`,
  );
  console.log(
    "size MB  findings  v3 stringify  parse  project  stringify  wrapper adds (p95)  longest block (p95)  native adds  parsed heap MB",
  );
  for (const r of rows) {
    console.log(
      [
        String(r.mb).padStart(7),
        String(r.findings).padStart(9),
        `${r.v3StringifyMs} ms`.padStart(13),
        `${r.parseMs} ms`.padStart(6),
        `${r.projectMs} ms`.padStart(8),
        `${r.stringifyMs} ms`.padStart(10),
        `${r.wrapperAddedMs} (${r.wrapperAddedP95Ms}) ms`.padStart(19),
        `${r.longestBlockMs} (${r.longestBlockP95Ms}) ms`.padStart(20),
        `${r.nativeAddedMs} ms`.padStart(12),
        String(r.parsedHeapMb ?? "n/a").padStart(15),
      ].join("  "),
    );
  }
  console.log(`\n${result.verdict}`);

  mkdirSync(values.out, { recursive: true });
  writeFileSync(
    path.join(values.out, "bench.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
