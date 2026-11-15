#!/usr/bin/env node
// Run by the Build job in .github/workflows/ci.yml right after `npm run build`,
// against the .next it produced. Two things the bundler decides that no unit
// test sees:
//
// 1. middleware.ts runs on the Edge runtime on purpose (see its comments). A
//    proxy.ts, or a runtime: "nodejs" in its config, would move it to Node.js,
//    which puts the database pool in front of every request. The Edge build is
//    listed in middleware-manifest.json; a Node.js one shows up in
//    functions-config-manifest.json as /_middleware instead.
// 2. The matcher regexps are compiled by the bundler, and Turbopack's
//    generator (in Rust) has diverged from webpack's before
//    (GHSA-26hh-7cqf-hhc6). So the compiled ones are run against paths whose
//    answer is known, including an /api path that ends in an image suffix and
//    one whose prefix is spelled with an escape.
//
// Run: `node scripts/ci/next16-build-checks.mjs [distDir]` (default .next)

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Path -> whether middleware must run for it. */
export const MATCHER_EXPECTATIONS = {
  "/api/v3/support-tickets/12.png": true,
  "/%61pi/v3/support-tickets/12.png": true,
  "/api/v3/scan": true,
  "/pricing": true,
  "/_next/static/chunks/x.js": false,
  "/logo.png": false,
};

/**
 * @param {{ middlewareManifest: any, functionsConfig: any }} manifests
 * @returns {{ problems: string[], matchers: number }}
 */
export function checkMiddlewareBuild({ middlewareManifest, functionsConfig }) {
  const entry = middlewareManifest?.middleware?.["/"];
  if (!entry) {
    return {
      problems: ["middleware-manifest.json has no Edge middleware for /"],
      matchers: 0,
    };
  }
  const problems = [];
  const functions = functionsConfig?.functions ?? {};
  if (functions["/_middleware"]) {
    problems.push(
      "middleware was compiled for Node.js: functions-config-manifest.json lists /_middleware",
    );
  }
  const regexps = (entry.matchers ?? []).map((m) => new RegExp(m.regexp));
  if (regexps.length === 0) {
    problems.push("the Edge middleware has no compiled matchers");
  }
  const decoded = (p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  };
  const hits = (p) => regexps.some((r) => r.test(p) || r.test(decoded(p)));
  for (const [p, want] of Object.entries(MATCHER_EXPECTATIONS)) {
    const got = hits(p);
    if (got !== want) problems.push(`${p}: matched ${got}, expected ${want}`);
  }
  return { problems, matchers: regexps.length };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function main(distDir) {
  const server = path.join(distDir, "server");
  const manifestFile = path.join(server, "middleware-manifest.json");
  if (!existsSync(manifestFile)) {
    console.error(`${manifestFile} does not exist. Run npm run build first.`);
    process.exit(1);
  }
  const functionsFile = path.join(server, "functions-config-manifest.json");
  const { problems, matchers } = checkMiddlewareBuild({
    middlewareManifest: readJson(manifestFile),
    functionsConfig: existsSync(functionsFile) ? readJson(functionsFile) : {},
  });
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(
    `Edge middleware, ${matchers} matchers, ${Object.keys(MATCHER_EXPECTATIONS).length} paths as expected`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv[2] ?? ".next");
}
