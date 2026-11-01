import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Server code does not read the build-time app URL.
 *
 * Next.js replaces `process.env.NEXT_PUBLIC_APP_URL` with the value it had at
 * `next build`, in server bundles as well as browser ones, and the APP_URL
 * export of lib/config/client-constants.ts is built from it. The published
 * image is built with the upstream origin, so on a self-hosted instance every
 * server-side reader of either one sent links to https://vulnradar.dev: a
 * password-reset or verification email handed its live token to a domain the
 * operator does not own. Server code asks serverAppUrl()
 * (lib/config/server-app-url.ts) instead, which reads the saved setting and
 * the environment of the running process.
 *
 * Covers lib/, app/api/ and instrumentation.ts. Pages and components are not
 * scanned: what they render is built for the browser, where the build value is
 * the only one there is.
 *
 * Parsed with the TypeScript compiler, so a comment that names the variable is
 * not a read. A read is a `process.env.NEXT_PUBLIC_APP_URL` access, or the
 * APP_URL binding taken from either constants module (a named import, a
 * re-export, a namespace member or a destructured dynamic import).
 *
 * DEBT is every file that read it before this test, with how many reads. It is
 * keyed by file, so a read added to a file that is not listed fails even when
 * its neighbours are, and the count is exact, so moving one read of a file to
 * serverAppUrl() means lowering its number and the list only shrinks. Nothing
 * is added to it to make a new read pass.
 */

const ROOT = path.resolve(__dirname, "../..");

const SCAN_DIRS = ["lib", "app/api"];
const SCAN_FILES = ["instrumentation.ts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "tests"]);
const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(?:test|spec)\./;

/** The modules whose job is to hold one of the two values. */
const HOMES: Record<string, string> = {
  "lib/config/client-constants.ts": "defines the build-time APP_URL",
  "lib/config/server-app-url.ts": "reads the variables at runtime",
};

/** Reads that predate this test, by file. Lower a count as reads move. */
const DEBT: Record<string, number> = {
  "app/api/security-txt/route.ts": 1,
  "app/api/v3/admin/route.ts": 1,
  "app/api/v3/admin/staff-invites/route.ts": 1,
  "app/api/v3/openapi.json/route.ts": 1,
  "app/api/v3/scan/github-issue/route.ts": 1,
  "app/api/v3/stripe/setup-webhook/route.ts": 1,
  "app/api/v3/teams/members/route.ts": 1,
  "app/api/v3/whoami-ip/route.ts": 1,
  "lib/ai/system-prompt.ts": 1,
  "lib/ai/transport.ts": 1,
  "lib/billing/stripe-webhook-setup.ts": 1,
  // The import, and the re-export that hands it to every server module.
  "lib/config/constants.ts": 2,
  "lib/domains/reverify-worker.ts": 1,
  "lib/email/campaigns.ts": 1,
  "lib/email/email.ts": 1,
  "lib/reports/compliance-report.ts": 1,
  "lib/reports/markdown-report.ts": 1,
  "lib/reports/pdf-report.ts": 1,
  "lib/reports/sarif-report.ts": 1,
  "lib/scanner/user-agent.ts": 1,
  "lib/seo/metadata.ts": 1,
  "lib/support/ticket-notify.ts": 1,
  "lib/webhooks/delivery.ts": 1,
};

const CONSTANTS_MODULE = /(?:^|\/)(?:client-)?constants$/;
const QUICK_FILTER = /NEXT_PUBLIC_APP_URL|\bAPP_URL\b/;

interface Read {
  line: number;
  what: string;
}

function isProcessEnv(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

function isConstantsSpecifier(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    ts.isStringLiteralLike(node) &&
    CONSTANTS_MODULE.test(node.text)
  );
}

/** Every read of the build-time app URL in `source`. */
function buildTimeAppUrlReads(source: string, fileName: string): Read[] {
  const kind = /\.(?:tsx|jsx)$/.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.(?:js|mjs|cjs)$/.test(fileName)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const reads: Read[] = [];
  const namespaces = new Set<string>();
  const add = (node: ts.Node, what: string) =>
    reads.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      what,
    });

  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "NEXT_PUBLIC_APP_URL" &&
      isProcessEnv(node.expression)
    ) {
      add(node, "process.env.NEXT_PUBLIC_APP_URL");
    } else if (
      ts.isElementAccessExpression(node) &&
      isProcessEnv(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "NEXT_PUBLIC_APP_URL"
    ) {
      add(node, 'process.env["NEXT_PUBLIC_APP_URL"]');
    } else if (
      ts.isImportDeclaration(node) &&
      isConstantsSpecifier(node.moduleSpecifier)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const spec of bindings.elements) {
          if ((spec.propertyName ?? spec.name).text === "APP_URL") {
            add(spec, "import { APP_URL }");
          }
        }
      }
    } else if (
      ts.isExportDeclaration(node) &&
      isConstantsSpecifier(node.moduleSpecifier) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const spec of node.exportClause.elements) {
        if ((spec.propertyName ?? spec.name).text === "APP_URL") {
          add(spec, "export { APP_URL } from");
        }
      }
    } else if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "APP_URL" &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text)
    ) {
      add(node, `${node.expression.text}.APP_URL`);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      importsConstants(node.initializer)
    ) {
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key) && key.text === "APP_URL") {
          add(el, "{ APP_URL } = await import()");
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  // Namespace imports are hoisted, so collect them before the member reads.
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      isConstantsSpecifier(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings &&
      ts.isNamespaceImport(stmt.importClause.namedBindings)
    ) {
      namespaces.add(stmt.importClause.namedBindings.name.text);
    }
  }
  visit(sf);
  return reads;
}

/** `import("…/constants")`, possibly awaited. */
function importsConstants(node: ts.Expression): boolean {
  const inner = ts.isAwaitExpression(node) ? node.expression : node;
  return (
    ts.isCallExpression(inner) &&
    inner.expression.kind === ts.SyntaxKind.ImportKeyword &&
    isConstantsSpecifier(inner.arguments[0])
  );
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(rel, out);
    } else if (SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(rel);
    }
  }
}

let scanned: { files: string[]; reads: Map<string, Read[]> } | null = null;

function scan() {
  if (scanned) return scanned;
  const files: string[] = [];
  for (const dir of SCAN_DIRS) walk(dir, files);
  for (const file of SCAN_FILES) {
    if (fs.existsSync(path.join(ROOT, file))) files.push(file);
  }
  files.sort();
  const reads = new Map<string, Read[]>();
  for (const file of files) {
    if (file in HOMES) continue;
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (!QUICK_FILTER.test(text)) continue;
    const found = buildTimeAppUrlReads(text, file);
    if (found.length > 0) reads.set(file, found);
  }
  scanned = { files, reads };
  return scanned;
}

describe("buildTimeAppUrlReads", () => {
  it("flags the inlined variable however it is spelled", () => {
    expect(
      buildTimeAppUrlReads(
        [
          "const a = process.env.NEXT_PUBLIC_APP_URL;",
          'const b = process.env["NEXT_PUBLIC_APP_URL"];',
        ].join("\n"),
        "a.ts",
      ).map((r) => r.line),
    ).toEqual([1, 2]);
  });

  it("flags the constant from either constants module", () => {
    for (const from of [
      "@/lib/config/constants",
      "@/lib/config/client-constants",
      "./client-constants",
    ]) {
      expect(
        buildTimeAppUrlReads(`import { X, APP_URL } from "${from}";`, "a.ts"),
        from,
      ).toEqual([{ line: 1, what: "import { APP_URL }" }]);
    }
    expect(
      buildTimeAppUrlReads(
        `import { APP_URL as base } from "@/lib/config/constants";`,
        "a.ts",
      ),
    ).toHaveLength(1);
  });

  it("flags a re-export, a namespace member and a dynamic import", () => {
    expect(
      buildTimeAppUrlReads(
        `export { APP_URL } from "./client-constants";`,
        "a.ts",
      ),
    ).toHaveLength(1);
    expect(
      buildTimeAppUrlReads(
        [
          "const u = C.APP_URL;",
          'import * as C from "@/lib/config/constants";',
        ].join("\n"),
        "a.ts",
      ),
    ).toEqual([{ line: 1, what: "C.APP_URL" }]);
    expect(
      buildTimeAppUrlReads(
        `async function f() { const { APP_URL } = await import("@/lib/config/constants"); }`,
        "a.ts",
      ),
    ).toHaveLength(1);
  });

  it("leaves comments, runtime reads and other modules alone", () => {
    expect(
      buildTimeAppUrlReads(
        [
          "// falls back to NEXT_PUBLIC_APP_URL, then APP_URL",
          "const a = process.env.APP_URL;",
          "const b = process.env[name];",
          'import { APP_URL } from "@/lib/somewhere-else";',
          'import { APP_NAME } from "@/lib/config/constants";',
          "const c = settings.APP_URL;",
          'const d = await getSetting("APP_URL");',
        ].join("\n"),
        "a.ts",
      ),
    ).toEqual([]);
  });
});

describe("no server code reads the build-time app URL", () => {
  // Reads every source file under lib/ and app/api/, so it is I/O bound and
  // the default 5 s limit is tight on a busy machine.
  const SLOW = { timeout: 30_000 };

  it("finds files to check", SLOW, () => {
    expect(scan().files.length).toBeGreaterThan(500);
  });

  it("outside the debt list", SLOW, () => {
    const over = [...scan().reads]
      .filter(([file, found]) => found.length > (DEBT[file] ?? 0))
      .flatMap(([file, found]) =>
        found.map((r) => `${file}:${r.line}  ${r.what}`),
      );
    expect(
      over,
      "build the link from await serverAppUrl() (lib/config/server-app-url.ts)",
    ).toEqual([]);
  });

  it("keeps the debt list honest", SLOW, () => {
    const { reads } = scan();
    const stale = Object.entries(DEBT)
      .filter(([file, count]) => (reads.get(file)?.length ?? 0) < count)
      .map(
        ([file, count]) =>
          `${file}: listed ${count}, reads ${reads.get(file)?.length ?? 0}`,
      );
    expect(
      stale,
      "these files read it fewer times now: lower or delete their entry",
    ).toEqual([]);
  });

  it("keeps the homes out of the debt list", () => {
    expect(Object.keys(DEBT).filter((file) => file in HOMES)).toEqual([]);
  });
});
