#!/usr/bin/env node
/**
 * Checks the harness itself, with no server and no dependencies installed:
 * the pure helpers behave, the verdict arithmetic is right, every check id is
 * unique and covers SPIKE 1 to 6, and the spike image still mirrors the
 * production Dockerfile on the lines the spike depends on. Run first in the
 * workflow so a broken harness fails before it can report a false pass.
 *
 *   node scripts/spike/selftest.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildSummary } from "./summarise.mjs";
import { REPO_ROOT, pinnedVersions } from "./lib/fixture.mjs";
import { parseLinkHeader, profileStream } from "./lib/http.mjs";
import { itemVerdict } from "./lib/report.mjs";
import { MUTATIONS } from "./mutations.mjs";

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("parseLinkHeader splits folded values and keeps commas inside <> and quotes", () => {
  const links = parseLinkHeader(
    '</docs/api/migrate-v4>; rel="deprecation"; type="text/html", </api/v4/history/a,b>; rel="successor-version", <https://x.test/?a=1,2>; rel="next"; title="one, two"',
  );
  assert.deepEqual(
    links.map((l) => [l.target, l.params.rel]),
    [
      ["/docs/api/migrate-v4", "deprecation"],
      ["/api/v4/history/a,b", "successor-version"],
      ["https://x.test/?a=1,2", "next"],
    ],
  );
  assert.equal(links[0].params.type, "text/html");
  assert.equal(links[2].params.title, "one, two");
  assert.deepEqual(parseLinkHeader(undefined), []);
});

test("profileStream calls a spread-out stream unbuffered and a burst buffered", () => {
  const spec = { lines: 8, gapMs: 300 };
  const spread = {
    chunks: Array.from({ length: 8 }, (_, i) => ({
      at: 40 + i * 300,
      bytes: 50,
    })),
    totalMs: 2200,
  };
  assert.equal(profileStream(spread, spec).unbuffered, true);

  const burst = {
    chunks: [{ at: 2500, bytes: 400 }],
    totalMs: 2502,
  };
  assert.equal(profileStream(burst, spec).unbuffered, false);

  const lateBurst = {
    chunks: Array.from({ length: 8 }, (_, i) => ({ at: 2500 + i, bytes: 50 })),
    totalMs: 2510,
  };
  assert.equal(profileStream(lateBurst, spec).unbuffered, false);

  assert.equal(
    profileStream({ chunks: [], totalMs: 10 }, spec).unbuffered,
    false,
  );
});

test("itemVerdict: a failed required check fails the item, info and warn do not", () => {
  const check = (status) => ({ status });
  assert.equal(itemVerdict([check("pass"), check("pass")]), "PASS");
  assert.equal(itemVerdict([check("pass"), check("fail")]), "FAIL");
  assert.equal(
    itemVerdict([check("pass"), check("warn"), check("info")]),
    "PASS",
  );
  assert.equal(itemVerdict([check("skip")]), "SKIP");
  assert.equal(itemVerdict([check("info")]), "n/a");
});

test("buildSummary reports a failing item with its fallback and exits non-zero upstream", () => {
  const ok = (id, spike) => ({
    id,
    spike,
    title: id,
    status: "pass",
    detail: "",
  });
  const bad = {
    id: "4a",
    spike: 4,
    title: "headers",
    status: "fail",
    detail: "Sunset is undefined",
  };
  const run = (checks) => ({
    target: { name: "start" },
    next: "15.5.28",
    node: "v22",
    platform: "linux-x64",
    checks,
    facts: {},
    error: null,
  });
  const allPass = () => run([1, 2, 3, 4, 5, 6].map((n) => ok(`${n}a`, n)));
  const good = buildSummary(
    {
      dev: allPass(),
      start: allPass(),
      "start-h": allPass(),
      image: allPass(),
    },
    {
      needsNative: false,
      verdict: "PASS: fine",
      rows: [],
      node: "v22",
      cpu: "x",
      platform: "p",
      longTaskMs: 50,
      verdictSizeMb: 5,
    },
  );
  assert.deepEqual(Object.values(good.verdicts), [
    "PASS",
    "PASS",
    "PASS",
    "PASS",
    "PASS",
    "PASS",
    "PASS",
  ]);

  const partial = buildSummary({ start: allPass() }, null);
  assert.equal(
    partial.verdicts[1],
    "PARTIAL",
    "a missing target must not read as a pass",
  );

  const broken = buildSummary(
    { start: run([ok("1a", 1), bad]) },
    {
      needsNative: true,
      verdict: "FAIL: slow",
      rows: [],
      node: "v22",
      cpu: "x",
      platform: "p",
      longTaskMs: 50,
      verdictSizeMb: 5,
    },
  );
  assert.equal(broken.verdicts[4], "FAIL");
  assert.equal(broken.verdicts[7], "FAIL");
  assert.match(
    broken.text,
    /set Deprecation, Sunset and Link inside versioned\(\)/i,
  );
  assert.match(broken.text, /native serialiser/i);
});

function declaredChecks() {
  const dir = path.join(REPO_ROOT, "scripts/spike/checks");
  const seen = new Map();
  for (const file of readdirSync(dir)) {
    const source = readFileSync(path.join(dir, file), "utf8");
    for (const m of source.matchAll(/id:\s*"([0-9a-z-]+)",\s*spike:\s*(\d)/g)) {
      assert.ok(!seen.has(m[1]), `check id ${m[1]} is declared twice`);
      const objectEnd = source.indexOf("}", m.index);
      const required = !/required:\s*false/.test(
        source.slice(m.index, objectEnd),
      );
      seen.set(m[1], { spike: Number(m[2]), required });
    }
  }
  return seen;
}

test("every check id is unique and SPIKE 1 to 6 each have a required check", () => {
  const seen = declaredChecks();
  for (const spike of [1, 2, 3, 4, 5, 6]) {
    assert.ok(
      [...seen.values()].some((c) => c.spike === spike && c.required),
      `SPIKE ${spike} has no required check`,
    );
  }
});

test("every mutation edits text that exists exactly once and expects real, required checks to fail", () => {
  const checks = declaredChecks();
  const covered = new Set();
  for (const [name, mutation] of Object.entries(MUTATIONS)) {
    for (const edit of mutation.edits) {
      const source = readFileSync(
        path.join(REPO_ROOT, "tests/spike/fixture", edit.file),
        "utf8",
      ).replace(/\r\n/g, "\n");
      assert.equal(
        source.split(edit.from).length - 1,
        1,
        `mutation ${name}: ${edit.file} no longer contains its target text exactly once`,
      );
    }
    for (const id of mutation.expectFail) {
      assert.ok(checks.has(id), `mutation ${name} expects unknown check ${id}`);
      assert.ok(
        checks.get(id).required,
        `mutation ${name} expects ${id}, which is not graded`,
      );
      covered.add(checks.get(id).spike);
    }
  }
  for (const spike of [1, 2, 3, 4, 5, 6]) {
    assert.ok(covered.has(spike), `no mutation proves SPIKE ${spike} can fail`);
  }
});

function dockerLines(file) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

test("the spike image mirrors the production Dockerfile where the spike depends on it", () => {
  const root = dockerLines(path.join(REPO_ROOT, "Dockerfile"));
  const spike = dockerLines(path.join(REPO_ROOT, "tests/spike/Dockerfile"));
  for (const line of [
    "ENV PORT=3000",
    'ENV HOSTNAME="0.0.0.0"',
    "ENV NODE_ENV=production",
    'ENTRYPOINT ["/sbin/tini", "--"]',
    'CMD ["npm", "start"]',
    "USER nextjs",
  ]) {
    assert.ok(
      root.includes(line),
      `production Dockerfile no longer has: ${line}`,
    );
    assert.ok(spike.includes(line), `spike Dockerfile is missing: ${line}`);
  }
  const froms = (lines) => lines.filter((l) => l.startsWith("FROM "));
  assert.deepEqual(
    froms(spike).filter((l) => /AS (builder|runner)$/.test(l)),
    froms(root).filter((l) => /AS (builder|runner)$/.test(l)),
    "the builder and runner base images differ from the production Dockerfile",
  );
  for (const copy of [
    "COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next",
    "COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules",
  ]) {
    assert.ok(
      root.includes(copy) && spike.includes(copy),
      `image layout differs: ${copy}`,
    );
  }
});

test("the app is not a standalone build, which is why the image runs next start", () => {
  const config = readFileSync(path.join(REPO_ROOT, "next.config.mjs"), "utf8");
  const code = config.replace(/\/\/.*$/gm, "");
  assert.ok(
    !/output\s*:\s*["']standalone["']/.test(code),
    "next.config.mjs now builds standalone: the spike image must change with it",
  );
});

test("the fixture pins the versions the app pins", () => {
  const v = pinnedVersions();
  assert.match(v.next, /^\d+\.\d+\.\d+$/);
  assert.match(v.react, /^\d+\.\d+\.\d+$/);
  assert.match(v.reactDom, /^\d+\.\d+\.\d+$/);
});

let failed = 0;
for (const { name, fn } of cases) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}
console.log(`\n${cases.length - failed} of ${cases.length} self-tests passed`);
if (failed) process.exitCode = 1;
