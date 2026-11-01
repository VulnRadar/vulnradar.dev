import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * A scanned site's response body is read through safeReadBody, never with
 * `.text()`, `.json()` or another Body method that reads the whole stream.
 *
 * They buffer the entire body before the caller gets to slice it, so
 * `(await res.text()).slice(0, 4096)` reads a 4 GB robots.txt (or a gzip bomb
 * that inflates to one) into the heap first. The site decides how big that
 * is, any visitor can point the anonymous demo scan at it, and the process
 * that runs out of memory is the one running everyone else's scans.
 * safeReadBody stops at its byte cap and its timeout, whichever comes first,
 * and cancels the stream.
 *
 * Whether a response is the target's cannot be read off the syntax, so the
 * calls that remain are listed below by file and enclosing function, each
 * with the reason it is there. A new call fails this test until it either
 * goes through safeReadBody or is added here with a reason someone can
 * check. An entry whose calls are gone fails too, so the list only shrinks.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SCANNER = "lib/scanner";
const READER = "lib/scanner/read-bounded-body.ts";

type Allowance = { count: number; why: string };

const THIRD_PARTY_API =
  "Answer from a fixed third-party API, not from the scanned site.";
const NULL_BODY_FALLBACK =
  "Only reached when the response has no body stream (a 204 or a test double), so there is nothing to buffer.";
const LATER_WAVE =
  "Target-facing and still uncapped: the active probes move to safeReadBody with the rest of the scanner-body-caps work.";

const ALLOWED: Record<string, Allowance> = {
  // DNS-over-HTTPS lookups against dns.google and cloudflare-dns.com.
  "lib/scanner/async-checks.ts#checkDNSSEC": { count: 2, why: THIRD_PARTY_API },
  "lib/scanner/async-checks.ts#dohQuery": { count: 2, why: THIRD_PARTY_API },
  "lib/scanner/async-checks.ts#dohAnswersWithoutValidation": {
    count: 2,
    why: THIRD_PARTY_API,
  },
  "lib/scanner/checks/dns.ts#dohAnswers": { count: 2, why: THIRD_PARTY_API },
  "lib/scanner/checks/dns.ts#dohResponse": { count: 2, why: THIRD_PARTY_API },
  // CISA KEV, FIRST EPSS, OSV.dev, Google Web Risk, URLhaus and NVD.
  "lib/scanner/cve-enrichment.ts#fetchKevCatalog": {
    count: 1,
    why: THIRD_PARTY_API,
  },
  "lib/scanner/cve-enrichment.ts#fetchEpssScores": {
    count: 1,
    why: THIRD_PARTY_API,
  },
  "lib/scanner/osv-lookup.ts#queryOsv": { count: 1, why: THIRD_PARTY_API },
  "lib/scanner/reputation-lookup.ts#queryWebRisk": {
    count: 1,
    why: THIRD_PARTY_API,
  },
  "lib/scanner/reputation-lookup.ts#queryUrlhausUncached": {
    count: 1,
    why: THIRD_PARTY_API,
  },
  "lib/scanner/software-inventory.ts#correlateViaNvd": {
    count: 1,
    why: THIRD_PARTY_API,
  },
  "lib/scanner/auth/login.ts#readCappedBody": {
    count: 1,
    why: NULL_BODY_FALLBACK,
  },
  "lib/scanner/subdomain-discovery-engine.ts#readPassiveJson": {
    count: 1,
    why: NULL_BODY_FALLBACK,
  },
  "lib/scanner/subdomain-discovery-engine.ts#readPassiveText": {
    count: 1,
    why: NULL_BODY_FALLBACK,
  },
  "lib/scanner/active-probes/command-injection.ts#checkCommandInjectionProbe": {
    count: 1,
    why: LATER_WAVE,
  },
  "lib/scanner/active-probes/open-redirect.ts#checkOpenRedirectProbe": {
    count: 1,
    why: LATER_WAVE,
  },
  "lib/scanner/active-probes/shared.ts#discoverProbableForms": {
    count: 1,
    why: LATER_WAVE,
  },
  "lib/scanner/active-probes/sqli-error-based.ts#checkSqlInjectionProbe": {
    count: 1,
    why: LATER_WAVE,
  },
  "lib/scanner/active-probes/ssti.ts#checkSstiProbe": {
    count: 1,
    why: LATER_WAVE,
  },
  "lib/scanner/active-probes/xss-canary.ts#checkActiveProbes": {
    count: 1,
    why: LATER_WAVE,
  },
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out;
}

function nameOf(node: ts.Node): string | null {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (
      (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) &&
      parent.name
    ) {
      return parent.name.getText();
    }
  }
  return null;
}

/** The nearest named function around `node`, skipping anonymous callbacks. */
function enclosingFunction(node: ts.Node): string {
  for (let cur = node.parent; cur; cur = cur.parent) {
    const name = nameOf(cur);
    if (name) return name;
  }
  return "<module>";
}

// Every Body method that buffers the whole stream, not only the two in use
// today: `Buffer.from(await res.arrayBuffer())` is the same read as text().
const WHOLE_BODY_READS = new Set([
  "text",
  "json",
  "arrayBuffer",
  "blob",
  "formData",
  "bytes",
]);

/** The method a zero-argument call names, as `res.text()` or `res["text"]()`. */
function calledMethod(node: ts.CallExpression): string | null {
  if (node.arguments.length !== 0) return null;
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (
    ts.isElementAccessExpression(callee) &&
    ts.isStringLiteralLike(callee.argumentExpression)
  ) {
    return callee.argumentExpression.text;
  }
  return null;
}

/** `file#function -> number of unbounded body reads` in one source file. */
function readsIn(file: string, text: string): Map<string, number> {
  const found = new Map<string, number>();
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const method = calledMethod(node);
      if (method && WHOLE_BODY_READS.has(method)) {
        const key = `${file}#${enclosingFunction(node)}`;
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** `key -> number of unbounded body reads` across lib/scanner. */
function unboundedReads(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of sourceFiles(SCANNER)) {
    if (file === READER) continue;
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const [key, count] of readsIn(file, text)) found.set(key, count);
  }
  return found;
}

describe("the unbounded-read detector", () => {
  it("sees every spelling of a whole-body read, keyed by the named function", () => {
    const found = readsIn(
      "lib/scanner/example.ts",
      [
        "export async function viaDot(res: Response) { return res.text(); }",
        'export async function viaBracket(res: Response) { return res["json"](); }',
        "export async function viaBuffer(res: Response) {",
        "  return Buffer.from(await res.arrayBuffer());",
        "}",
        "export const viaThen = (p: Promise<Response>) => p.then((r) => r.blob());",
        "export async function bounded(res: Response, max: number) {",
        "  return safeReadBody(res, max, 5000);",
        "}",
      ].join("\n"),
    );
    expect(Object.fromEntries(found)).toEqual({
      "lib/scanner/example.ts#viaDot": 1,
      "lib/scanner/example.ts#viaBracket": 1,
      "lib/scanner/example.ts#viaBuffer": 1,
      "lib/scanner/example.ts#viaThen": 1,
    });
  });
});

describe("bounded reads of response bodies in lib/scanner", () => {
  const found = unboundedReads();

  it("reads no whole body (.text(), .json() and the like) outside the listed exceptions", () => {
    const unlisted = [...found]
      .filter(([key, count]) => count > (ALLOWED[key]?.count ?? 0))
      .map(
        ([key, count]) =>
          `${key}: ${count} call(s), ${ALLOWED[key]?.count ?? 0} allowed. Read it with safeReadBody(res, maxBytes, timeoutMs).`,
      );
    expect(unlisted).toEqual([]);
  });

  it("lists no exception that the code no longer needs", () => {
    const stale = Object.entries(ALLOWED)
      .filter(([key, { count }]) => (found.get(key) ?? 0) < count)
      .map(
        ([key, { count }]) =>
          `${key}: ${found.get(key) ?? 0} call(s), ${count} listed. Lower or remove the entry.`,
      );
    expect(stale).toEqual([]);
  });

  it("gives every exception a reason", () => {
    for (const { why } of Object.values(ALLOWED)) {
      expect(why.length).toBeGreaterThan(20);
    }
  });
});
