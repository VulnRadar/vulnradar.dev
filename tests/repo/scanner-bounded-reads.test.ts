import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * A scanned site's response body is read through safeReadBody, never with
 * `.text()` or `.json()`.
 *
 * Both buffer the entire body before the caller gets to slice it, so
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

/** `key -> number of unbounded body reads` across lib/scanner. */
function unboundedReads(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of sourceFiles(SCANNER)) {
    if (file === READER) continue;
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.arguments.length === 0 &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === "text" ||
          node.expression.name.text === "json")
      ) {
        const key = `${file}#${enclosingFunction(node)}`;
        found.set(key, (found.get(key) ?? 0) + 1);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe("bounded reads of response bodies in lib/scanner", () => {
  const found = unboundedReads();

  it("reads no body with .text() or .json() outside the listed exceptions", () => {
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
