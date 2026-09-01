import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the client/server split of the config modules (AUDIT-012#fe-15).
 *
 * The defect these pin down was invisible to both tsc and the test suite: it
 * only showed up by reading a compiled chunk. lib/config/constants.ts reads
 * SMTP_PASS and BROWSERBASE_API_KEY, 113 `"use client"` files imported it, and
 * several of those mount from the root layout, so the reads were compiled into
 * the /layout entry chunk and shipped on all 311 routes. Nothing leaked --
 * Next.js inlines only NEXT_PUBLIC_* into browser code, so they evaluated to
 * undefined -- but the read sites were there, one careless rename away from
 * being a real disclosure.
 *
 * These are source-text assertions on purpose. Importing the modules and
 * checking their values would pass just as happily with the reads back in
 * place, because the failure is about what the bundler can see, not what the
 * value resolves to.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Every `process.env.NAME` read in a source file, as the bare NAME.
 *
 * Comment-only lines are dropped first. These modules carry long comments
 * about which variable belongs on which side of the split, and matching the
 * prose would make the assertion report the documentation as the defect.
 * Dropping whole comment lines cannot hide a real read, since a read is never
 * alone on a line that starts with a comment marker.
 */
function envReads(source: string): string[] {
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  return [...code.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
}

const SEARCH_DIRS = ["app", "components", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * The `"use client"` files that still import the server config module.
 *
 * Empty, and it must stay that way. It began as 113 files, was cut to 30 by
 * the migration, and the last 30 were swapped once the agents holding those
 * directories finished. The test fails on an ADDITION, so an empty set is the
 * strict form: any new client component importing
 * `@/lib/config/constants` fails here with its own path named.
 *
 * Note this being empty is NOT sufficient to put `import "server-only"` on
 * lib/config/constants.ts. Two other importers block that and neither is a
 * client component: middleware.ts runs on the edge runtime, and
 * instrumentation.ts runs at boot. Beyond those, server-only's default entry
 * throws outside a react-server context, so it would break roughly a thousand
 * tests across 160+ files. That is why the SMTP credentials live in
 * lib/email/email.ts (which builds the nodemailer transport and can never
 * reach a client bundle) rather than behind the marker.
 */
const KNOWN_REMAINING_CLIENT_IMPORTERS = new Set<string>([]);

describe("lib/config client/server split", () => {
  it("lets client-constants.ts read NEXT_PUBLIC_ variables and nothing else", () => {
    const offenders = envReads(read("lib/config/client-constants.ts")).filter(
      (name) => !name.startsWith("NEXT_PUBLIC_"),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps config-values.ts free of environment reads entirely", () => {
    // client-constants.ts imports it, so anything it reads reaches the
    // browser too. It is meant to be pure compiled data.
    expect(envReads(read("lib/config/config-values.ts"))).toEqual([]);
  });

  it("keeps the SMTP credentials and the Browserbase key out of constants.ts", () => {
    const source = read("lib/config/constants.ts");
    const secretish = envReads(source).filter(
      (name) => name.startsWith("SMTP_") || name.startsWith("BROWSERBASE_"),
    );

    expect(secretish).toEqual([]);
  });

  it("declares the Browserbase configured-check behind the server-only marker", () => {
    const source = read("lib/config/server-constants.ts");

    expect(source).toMatch(/^import "server-only";/);
    expect(source).toContain("BROWSERBASE_API_KEY");
  });

  it("does not let a new client component import the server config module", () => {
    const found: string[] = [];

    for (const dir of SEARCH_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        // The config modules themselves quote both the directive and the
        // import path in their own comments, explaining this very rule.
        if (rel.startsWith("lib/config/")) continue;
        const source = fs.readFileSync(file, "utf8");
        if (!source.includes('"use client"')) continue;
        if (!/from\s+"@\/lib\/config\/constants"/.test(source)) continue;
        found.push(rel);
      }
    }

    const added = found.filter((f) => !KNOWN_REMAINING_CLIENT_IMPORTERS.has(f));

    expect(added).toEqual([]);
  });
});
