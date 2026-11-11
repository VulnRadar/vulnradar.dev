import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, routeFile } from "../_helpers/api-routes";

/**
 * Every 429 tells the client when to come back. The sites below predate that
 * rule, and the baseline only ever shrinks: a new 429 with no Retry-After
 * fails here, wherever it is. Counted per file and handler rather than by line
 * so an edit elsewhere in a file cannot trip it.
 *
 * The response helpers in lib/api/rate-limit-response.ts always send the
 * header and do not count as sites.
 */

/** Parsing the tree takes seconds, and longer on a loaded CI runner. */
const TREE_WALK_TIMEOUT_MS = 60_000;

const SOURCE_DIRS = ["app/api", "lib"];
const ROOT_FILES = ["middleware.ts"];

const posix = (path: string) => path.split(sep).join("/");

function walkSource(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkSource(full));
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
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

function topLevelOf(node: ts.Node): ts.Node {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent))
    current = current.parent;
  return current;
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => {
    if (!property.name) return false;
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
      return property.name.text.toLowerCase() === name.toLowerCase();
    }
    return false;
  });
}

function isLiteral429(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isNumericLiteral(node) && node.text === "429";
}

/** Whether a `{ status: 429, headers }` init sets Retry-After where it is built. */
function initSetsRetryAfter(init: ts.ObjectLiteralExpression): boolean {
  const headers = propertyNamed(init, "headers");
  if (!headers) return false;
  if (
    ts.isPropertyAssignment(headers) &&
    ts.isObjectLiteralExpression(headers.initializer)
  ) {
    return propertyNamed(headers.initializer, "Retry-After") !== undefined;
  }
  // A variable or a helper's result: the literal has to appear where the
  // handler builds it, or it is not going out with this response.
  return /["']Retry-After["']/i.test(topLevelOf(init).getText());
}

/** A response is often built first and given its header on the next line. */
function setsRetryAfterLater(node: ts.Node): boolean {
  return /headers\.set\(\s*["']Retry-After["']/i.test(
    topLevelOf(node).getText(),
  );
}

/** Handlers holding a 429 with no Retry-After, one entry per site. */
function sitesWithoutRetryAfter(text: string): string[] {
  const sites: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const args = node.arguments ?? ts.factory.createNodeArray();
      const callee = node.expression.getText();

      if (callee === "ApiResponse.tooManyRequests" && args.length < 2) {
        sites.push(handlerOf(node));
      } else if (callee === "ApiResponse.error" && isLiteral429(args[1])) {
        sites.push(handlerOf(node));
      } else if (
        callee === "NextResponse.json" ||
        callee === "Response.json" ||
        callee === "NextResponse" ||
        callee === "Response"
      ) {
        const init = args[1];
        if (init && ts.isObjectLiteralExpression(init)) {
          const status = propertyNamed(init, "status");
          if (
            status &&
            ts.isPropertyAssignment(status) &&
            isLiteral429(status.initializer) &&
            !initSetsRetryAfter(init) &&
            !setsRetryAfterLater(node)
          ) {
            sites.push(handlerOf(node));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return sites;
}

/**
 * Refusals that are not a rate window, so they stay without the header: a cap
 * that only frees when something else happens (an open ticket is answered, an
 * AI reservation settles, a running job ends) or a cooldown the sentence itself
 * already counts down. Keyed like BASELINE. Adding one needs a reason a client
 * could not be told any wait at all.
 */
const ALLOWED: Readonly<Record<string, number>> = {
  // Cooldowns.
  "billing/verify/send::POST": 1,
  "data-request::POST": 1,
  // The open-ticket cap.
  "support-tickets::POST": 1,
  // A repository review already running for this account.
  "scan/github::POST": 1,
  // The AI allowance reservation.
  "scan/verify::POST": 1,
  // The reservation, and the pass the allowance stopped: owner decision D18
  // keeps that second answer exactly as 3.9.1 sent it.
  "scan/verify-batch::POST": 2,
};

/**
 * Route tail (the directory under app/api/v3 before the move) and handler, to
 * the number of sites that still owe a Retry-After. Only ever comes down.
 */
const BASELINE: Readonly<Record<string, number>> = {
  "admin/features::POST": 1,
  "admin::PATCH": 1,
  "admin/updater/apply::POST": 1,
  "ai/chat::POST": 1,
  "ai/conversations::POST": 1,
  "ai/feedback::POST": 1,
  "billing/verify::POST": 1,
  "contact::POST": 1,
  "domains::POST": 1,
  "domains/[id]/block::POST": 1,
  "domains/[id]/scans::PATCH": 1,
  "domains/[id]/verify::POST": 1,
  "scan/github::POST": 1,
  "teams/members::POST": 1,
};

/** Rekeys a table on the file that serves each tail now, so the move needs no edit here. */
function byCurrentFile(
  table: Readonly<Record<string, number>>,
): Map<string, number> {
  return new Map(
    Object.entries(table).map(([key, count]) => {
      const [tail, handler] = key.split("::");
      return [`${routeFile(tail)}::${handler}`, count];
    }),
  );
}

let cachedCounts: Map<string, number> | undefined;

function currentCounts(): Map<string, number> {
  if (cachedCounts) return cachedCounts;
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => walkSource(join(REPO_ROOT, dir))),
    ...ROOT_FILES.map((file) => join(REPO_ROOT, file)).filter(existsSync),
  ];
  const counts = new Map<string, number>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("429") && !text.includes("tooManyRequests")) continue;
    for (const handler of sitesWithoutRetryAfter(text)) {
      const key = `${posix(relative(REPO_ROOT, file))}::${handler}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  cachedCounts = counts;
  return counts;
}

describe("Retry-After ratchet", () => {
  it("names the handler of each kind of 429 site", () => {
    const text = `
      export const GET = withErrorHandling(async () => {
        return NextResponse.json({ error: "x" }, { status: 429 });
      });
      export async function POST() {
        return ApiResponse.tooManyRequests("slow down");
      }
      async function helper() {
        return ApiResponse.error("slow down", 429);
      }
      const other = () => new NextResponse("x", { status: 429 });
    `;
    expect(sitesWithoutRetryAfter(text)).toEqual([
      "GET",
      "POST",
      "helper",
      "other",
    ]);
  });

  it("accepts every way of sending the header", () => {
    const text = `
      export async function A() {
        return NextResponse.json({}, { status: 429, headers: { "Retry-After": "5" } });
      }
      export async function B() {
        return ApiResponse.tooManyRequests("slow", 30);
      }
      export async function C() {
        const res = NextResponse.json({}, { status: 429 });
        res.headers.set("Retry-After", "1");
        return res;
      }
      export async function D() {
        const headers = { "Retry-After": "2" };
        return NextResponse.json({}, { status: 429, headers });
      }
      export async function E() {
        return NextResponse.json({}, { status: 400 });
      }
      export async function F() {
        return burstLimitedResponse(rl, "slow");
      }
    `;
    expect(sitesWithoutRetryAfter(text)).toEqual([]);
  });

  it("does not take other headers for Retry-After", () => {
    const text = `
      export async function A() {
        return NextResponse.json({}, { status: 429, headers: getRateLimitHeaders(q) });
      }
      export async function B() {
        return NextResponse.json({}, { status: 429, headers: { "X-RateLimit-Limit": "1" } });
      }
    `;
    expect(sitesWithoutRetryAfter(text)).toEqual(["A", "B"]);
  });

  it("ignores comments and strings", () => {
    const text = `
      // return NextResponse.json({}, { status: 429 });
      const doc = 'ApiResponse.tooManyRequests("x")';
    `;
    expect(sitesWithoutRetryAfter(text)).toEqual([]);
  });

  it(
    "finds no new 429 without a Retry-After",
    () => {
      const baseline = byCurrentFile(BASELINE);
      const allowed = byCurrentFile(ALLOWED);
      const added: string[] = [];
      for (const [key, count] of currentCounts()) {
        const known = (baseline.get(key) ?? 0) + (allowed.get(key) ?? 0);
        if (count > known) added.push(`${key} (${count}, baseline ${known})`);
      }
      expect(added).toEqual([]);
    },
    TREE_WALK_TIMEOUT_MS,
  );

  it(
    "is still looking at the real tree",
    () => {
      // Allowed sites are permanent, so a walk that went blind finds fewer than
      // these and fails, however far the baseline has come down.
      const total = [...currentCounts().values()].reduce((a, b) => a + b, 0);
      const permanent = Object.values(ALLOWED).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(permanent);
    },
    TREE_WALK_TIMEOUT_MS,
  );
});
