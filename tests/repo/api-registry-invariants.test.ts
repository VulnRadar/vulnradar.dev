import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  INTERNAL_ANONYMOUS,
  LEGACY_V3_TAILS,
  PERMALINKS,
  V4_ROUTES,
  matchTemplate,
  resolveApiPath,
} from "@/lib/api/route-registry";
import { REPO_ROOT, readPre40Routes } from "../_helpers/api-routes";

/**
 * Invariants of the routing registry that no single unit test owns. They read
 * the pre-4.0 fixture and the source tree, so they keep holding as files move
 * and as other clusters add code: a new violation fails here, and nothing in
 * this file needs editing when a route is added.
 *
 * Baselines are keyed by file and handler name, never by line number, so an
 * edit elsewhere in a file does not trip them.
 */

const sample = (template: string) =>
  template.replace(/:(\w+)/g, (_, name: string) => `${name}-1`);
const segments = (path: string) => path.split("/").slice(1);
const isParam = (segment: string) => segment.startsWith(":");

const fixture = readPre40Routes();
const v3Tails = fixture
  .filter((row) => row.template.startsWith("/api/v3/"))
  .map((row) => row.template.slice("/api/v3".length));

describe("S12: static beats dynamic, derived from the pre-4.0 inventory", () => {
  const paramPermalinks = PERMALINKS.filter((link) =>
    segments(link.template).some(isParam),
  );

  /** Fixture routes that fit a permalink's shape with a static segment where it has a parameter. */
  function siblingsOf(link: (typeof PERMALINKS)[number]) {
    const want = segments(link.template);
    return fixture.filter((row) => {
      if (row.template === link.template) return false;
      const have = segments(row.template);
      return (
        have.length === want.length &&
        want.every((segment, i) => isParam(segment) || segment === have[i])
      );
    });
  }

  it("covers the permalinks that have a parameter", () => {
    expect(paramPermalinks.map((link) => link.template)).toEqual([
      "/api/v3/auth/oauth/:provider/callback",
      "/api/v3/avatar/:userId",
      "/api/v3/badge/:token",
    ]);
  });

  it.each(paramPermalinks.map((link) => [link.template, link] as const))(
    "%s excludes every static sibling the inventory knows",
    (_template, link) => {
      const want = segments(link.template);
      const excluded = new Set(link.except ?? []);
      const seen = new Set<string>();
      for (const sibling of siblingsOf(link)) {
        const have = segments(sibling.template);
        want.forEach((segment, i) => {
          if (!isParam(segment)) return;
          expect(
            isParam(have[i]),
            `${sibling.template} has a competing parameter where ${link.template} has one`,
          ).toBe(false);
          expect(
            excluded.has(have[i]),
            `${link.template} must list "${have[i]}" in except, because ${sibling.template} is a static sibling`,
          ).toBe(true);
          seen.add(have[i]);
        });
      }
      for (const segment of excluded) {
        expect(
          seen.has(segment),
          `except "${segment}" matches no route in the inventory`,
        ).toBe(true);
      }
    },
  );

  it("never resolves a static sibling as the permalink, before or after the files move", () => {
    const tails = LEGACY_V3_TAILS as string[];
    const saved = [...tails];
    try {
      for (const migrated of [false, true]) {
        if (migrated) tails.length = 0;
        for (const link of paramPermalinks) {
          for (const sibling of siblingsOf(link)) {
            const resolved = resolveApiPath(sample(sibling.template), false);
            expect(resolved.kind, sibling.template).not.toBe("permalink");
          }
        }
      }
    } finally {
      tails.splice(0, tails.length, ...saved);
    }
  });

  it("keeps the same rule for anonymous internal templates: a parameter never makes a protected sibling anonymous", () => {
    const anonymous = INTERNAL_ANONYMOUS.map((entry) => entry.template);
    for (const template of anonymous.filter((t) => segments(t).some(isParam))) {
      const want = segments(template);
      for (const tail of v3Tails) {
        const have = segments(tail);
        if (tail === template || have.length !== want.length) continue;
        if (!want.every((s, i) => isParam(s) || s === have[i])) continue;
        expect(
          anonymous.some((other) => matchTemplate(other, sample(tail))),
          `${tail} is matched by anonymous ${template} but is not anonymous itself`,
        ).toBe(true);
      }
    }
  });

  it("only lists anonymous internal templates that were real routes", () => {
    for (const entry of INTERNAL_ANONYMOUS) {
      expect(
        v3Tails.some((tail) => tail === entry.template),
        entry.template,
      ).toBe(true);
    }
  });
});

describe("v4 rows", () => {
  const rows = V4_ROUTES;
  const operationIds = rows.flatMap((row) => Object.values(row.operations));

  it("have unique templates and unique operationIds", () => {
    expect(new Set(rows.map((row) => row.template)).size).toBe(rows.length);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("are exactly the 23 operations the design names", () => {
    expect([...operationIds].sort()).toEqual(
      [
        "auth.me",
        "demoScan.create",
        "findingTypes.list",
        "openapi.get",
        "history.list",
        "history.clear",
        "history.get",
        "history.update",
        "history.delete",
        "history.report",
        "history.summarize",
        "scan.create",
        "scan.createAuthenticated",
        "scan.createBulk",
        "scan.createCrawl",
        "scan.discoverCrawl",
        "scan.discover",
        "scan.discoverProgress",
        "scan.reputation",
        "scan.status",
        "scan.cancel",
        "scan.verify",
        "scan.verifyBatch",
      ].sort(),
    );
    for (const id of operationIds) {
      expect(id).toMatch(/^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Source scans. Everything below reads non-test source under app, lib,
// components and hooks, plus the two root entry files.
// ---------------------------------------------------------------------------

const SOURCE_DIRS = ["app", "lib", "components", "hooks"];
const ROOT_FILES = ["middleware.ts", "instrumentation.ts"];
const posix = (path: string) => path.split(sep).join("/");

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSource(full));
    else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

let cached: Map<string, string> | undefined;
function sources(): Map<string, string> {
  if (cached) return cached;
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => walkSource(join(REPO_ROOT, dir))),
    ...ROOT_FILES.map((file) => join(REPO_ROOT, file)).filter(existsSync),
  ];
  cached = new Map(
    files.map((file) => [
      posix(relative(REPO_ROOT, file)),
      readFileSync(file, "utf8"),
    ]),
  );
  return cached;
}

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "x.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function visit(node: ts.Node, fn: (node: ts.Node) => void) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

/** The top-level declaration that contains a node: a function or variable name, or "<module>". */
function handlerOf(node: ts.Node): string {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent))
    current = current.parent;
  if (ts.isFunctionDeclaration(current) && current.name)
    return current.name.text;
  if (ts.isVariableStatement(current)) {
    const name = current.declarationList.declarations[0]?.name;
    if (name && ts.isIdentifier(name)) return name.text;
  }
  return "<module>";
}

describe("limiter keys are built from a principal, never from a path (spec 5.2)", () => {
  const FORBIDDEN: [RegExp, string][] = [
    [/\bpathname\b/, "pathname"],
    [/\bnextUrl\b/, "nextUrl"],
    [/\b(?:request|req)\.url\b/, "request.url"],
    [/\b(?:API|ROUTES|FROZEN|PREFIX)\./, "a route constant"],
    [/\/api\//, "an /api/ literal"],
  ];

  /** Calls of checkRateLimit whose key is derived from the path, as "handler: why". */
  function limiterKeyProblems(text: string): {
    calls: number;
    problems: string[];
  } {
    const file = parse(text);
    const declared = new Map<string, string[]>();
    visit(file, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const list = declared.get(node.name.text) ?? [];
        list.push(node.initializer.getText(file));
        declared.set(node.name.text, list);
      }
    });

    let calls = 0;
    const problems: string[] = [];
    visit(file, (node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        node.expression.text !== "checkRateLimit"
      ) {
        return;
      }
      const config = node.arguments[0];
      if (!config || !ts.isObjectLiteralExpression(config)) return;
      for (const property of config.properties) {
        let expressions: string[] = [];
        if (
          ts.isPropertyAssignment(property) &&
          property.name.getText(file) === "key"
        ) {
          const value = property.initializer;
          expressions = ts.isIdentifier(value)
            ? (declared.get(value.text) ?? [])
            : [value.getText(file)];
        } else if (
          ts.isShorthandPropertyAssignment(property) &&
          property.name.text === "key"
        ) {
          expressions = declared.get("key") ?? [];
        } else {
          continue;
        }
        calls++;
        for (const expression of expressions) {
          for (const [pattern, why] of FORBIDDEN) {
            if (pattern.test(expression)) {
              problems.push(`${handlerOf(node)}: key uses ${why}`);
            }
          }
        }
      }
    });
    return { calls, problems };
  }

  it("flags a key derived from the path", () => {
    const bad = (key: string) =>
      limiterKeyProblems(
        `export async function POST(request) { await checkRateLimit({ key: ${key}, limit: "x" }); }`,
      ).problems;
    expect(bad("`scan:${request.nextUrl.pathname}`")).toEqual([
      "POST: key uses pathname",
      "POST: key uses nextUrl",
    ]);
    expect(bad("`x:${new URL(request.url).host}`")).toEqual([
      "POST: key uses request.url",
    ]);
    expect(bad("`${API.SCAN}:${ip}`")).toEqual([
      "POST: key uses a route constant",
    ]);
    expect(bad("`/api/v3/scan:${ip}`")).toEqual([
      "POST: key uses an /api/ literal",
    ]);
    expect(bad("`demo_scan:${ip}`")).toEqual([]);
  });

  it("follows a key that is built into a variable first", () => {
    const { calls, problems } = limiterKeyProblems(
      "export async function GET(request) { const key = `x:${request.nextUrl.pathname}`; await checkRateLimit({ key, limit: 'x' }); }",
    );
    expect(calls).toBe(1);
    expect(problems).toContain("GET: key uses pathname");
  });

  it("holds across the whole tree", () => {
    let calls = 0;
    const found: string[] = [];
    for (const [file, text] of sources()) {
      if (!text.includes("checkRateLimit(")) continue;
      const result = limiterKeyProblems(text);
      calls += result.calls;
      for (const problem of result.problems) found.push(`${file} ${problem}`);
    }
    // A floor, so the scan cannot go blind and pass: there are about 60 today.
    expect(calls).toBeGreaterThan(40);
    expect(found).toEqual([]);
  });
});

describe("S4: apiVersionOf selects a response shape and nothing else", () => {
  /**
   * File and handler pairs that may call apiVersionOf outside lib/api/v4. Empty
   * today. Adding one needs an owner-approved entry in lib/api/v4/operations.ts.
   */
  const RESPONSE_SHAPE_USES: Record<string, string[]> = {};
  const ALLOWED_PREFIXES = ["lib/api/v4/"];
  const FORBIDDEN_PLACES = [
    "lib/auth/",
    "lib/rate-limiting/",
    "lib/api/api-keys.ts",
  ];

  function callsOf(text: string, name: string): string[] {
    const file = parse(text);
    const handlers: string[] = [];
    visit(file, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name
      ) {
        handlers.push(handlerOf(node));
      }
    });
    return handlers;
  }

  it("names the handler that makes a call, and ignores comments and strings", () => {
    const text = [
      "// apiVersionOf(request)",
      'const doc = "apiVersionOf(request)";',
      "export const GET = withErrorHandling(async (request) => { return apiVersionOf(request); });",
      "export function POST(request) { apiVersionOf(request); }",
    ].join("\n");
    expect(callsOf(text, "apiVersionOf")).toEqual(["GET", "POST"]);
  });

  it("is never called where a decision about who may do something is made", () => {
    const offenders: string[] = [];
    for (const [file, text] of sources()) {
      if (!text.includes("apiVersionOf(")) continue;
      if (!FORBIDDEN_PLACES.some((place) => file.startsWith(place))) continue;
      if (callsOf(text, "apiVersionOf").length > 0) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("is called only in allow-listed places, keyed by file and handler", () => {
    const offenders: string[] = [];
    for (const [file, text] of sources()) {
      if (!text.includes("apiVersionOf(")) continue;
      if (file === "lib/api/versions.ts") continue;
      if (ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
      for (const handler of callsOf(text, "apiVersionOf")) {
        if (!RESPONSE_SHAPE_USES[file]?.includes(handler)) {
          offenders.push(`${file} ${handler}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the allow-list out of the places it must never reach", () => {
    for (const file of Object.keys(RESPONSE_SHAPE_USES)) {
      expect(
        FORBIDDEN_PLACES.some((place) => file.startsWith(place)),
        file,
      ).toBe(false);
    }
  });
});

describe("S11: NextResponse.rewrite has exactly one call site", () => {
  function rewriteCalls(text: string): number {
    const file = parse(text);
    let count = 0;
    visit(file, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "rewrite" &&
        node.expression.expression.getText(file) === "NextResponse"
      ) {
        count++;
      }
    });
    return count;
  }

  it("counts calls and not mentions", () => {
    expect(rewriteCalls("NextResponse.rewrite(url, init);")).toBe(1);
    expect(
      rewriteCalls(
        "// NextResponse.rewrite(url)\nconst s = 'NextResponse.rewrite(url)';",
      ),
    ).toBe(0);
    expect(rewriteCalls("NextResponse.next(); NextResponse.redirect(u);")).toBe(
      0,
    );
  });

  it("is called only from lib/api/rewrite.ts, once", () => {
    const calls: string[] = [];
    for (const [file, text] of sources()) {
      if (!text.includes("rewrite(")) continue;
      for (let i = 0; i < rewriteCalls(text); i++) calls.push(file);
    }
    expect(calls).toEqual(["lib/api/rewrite.ts"]);
  });
});
