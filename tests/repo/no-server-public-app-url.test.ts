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
 * operator does not own. Server code asks lib/config/server-app-url.ts
 * instead, which reads the environment of the running process:
 * secretLinkAppUrl() for a link that carries a token, serverAppUrl() (which
 * prefers the setting only the super admin can save) for everything else.
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
 * the runtime readers means lowering its number and the list only shrinks.
 * Nothing is added to it to make a new read pass.
 *
 * The count is per import, not per use, so a file left in the list could
 * still build a new token link from its build-time APP_URL. The second half of
 * this file closes that: no link with a token in it, anywhere in the scanned
 * code, takes its origin from the build-time value or from the saved setting.
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
  "app/api/v3/openapi.json/route.ts": 1,
  "app/api/v3/scan/github-issue/route.ts": 1,
  "app/api/v3/stripe/setup-webhook/route.ts": 1,
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

function parseSource(source: string, fileName: string): ts.SourceFile {
  const kind = /\.(?:tsx|jsx)$/.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.(?:js|mjs|cjs)$/.test(fileName)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
}

/** Every read of the build-time app URL in `source`. */
function buildTimeAppUrlReads(source: string, fileName: string): Read[] {
  const sf = parseSource(source, fileName);
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

/**
 * Text that puts a secret in a link: a token parameter, or a path that takes
 * one (reset, verification, staff and team invites, unsubscribe).
 */
const SECRET_LINK =
  /[?&]token=|\/(?:reset-password|verify-email|staff-invite|teams\/join|unsubscribe)/;

/**
 * The helpers that prefer the saved APP_URL row. Only the super admin can
 * save it, and it feeds only the OAuth and staff sign-in redirects.
 */
const SAVED_ROW_READERS = new Set(["serverAppUrl", "resolveAppUrl"]);

function unwrapExpression(node: ts.Expression): ts.Expression {
  let inner = node;
  while (ts.isAwaitExpression(inner) || ts.isParenthesizedExpression(inner)) {
    inner = inner.expression;
  }
  return inner;
}

function callsSavedRowReader(node: ts.Expression): boolean {
  const inner = unwrapExpression(node);
  return (
    ts.isCallExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    SAVED_ROW_READERS.has(inner.expression.text)
  );
}

/**
 * Every origin in `source` that a link carrying a secret takes from somewhere
 * other than the environment: a call to serverAppUrl() or resolveAppUrl(), a
 * variable set from one, or the build-time APP_URL.
 */
function secretLinkOriginReads(source: string, fileName: string): Read[] {
  const sf = parseSource(source, fileName);
  const fromSavedRow = new Set<string>();
  const reads: Read[] = [];

  const collect = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      callsSavedRowReader(node.initializer)
    ) {
      fromSavedRow.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };

  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node)) {
      const text =
        node.head.text + node.templateSpans.map((s) => s.literal.text).join("");
      if (SECRET_LINK.test(text)) {
        for (const span of node.templateSpans) {
          const inner = unwrapExpression(span.expression);
          const name = ts.isIdentifier(inner) ? inner.text : undefined;
          if (
            callsSavedRowReader(inner) ||
            name === "APP_URL" ||
            (name !== undefined && fromSavedRow.has(name))
          ) {
            reads.push({
              line:
                sf.getLineAndCharacterOfPosition(span.expression.getStart(sf))
                  .line + 1,
              what: span.expression.getText(sf),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  collect(sf);
  visit(sf);
  return reads;
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

  // The runtime reader is exempt above only so it may name the variables. A
  // literal `process.env.NEXT_PUBLIC_APP_URL` there would be inlined like any
  // other, and serverAppUrl() would quietly return the build value again.
  it("keeps serverAppUrl() reading the variables by a computed name", () => {
    const file = "lib/config/server-app-url.ts";
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(buildTimeAppUrlReads(text, file)).toEqual([]);
  });
});

describe("secretLinkOriginReads", () => {
  it("flags a token link built from a helper that prefers the saved row", () => {
    expect(
      secretLinkOriginReads(
        [
          "const a = `${await serverAppUrl()}/reset-password?token=${t}`;",
          "const b = `${await resolveAppUrl(request)}/staff-invite/${t}`;",
          "const base = await serverAppUrl();",
          "const c = `${base}/verify-email?token=${t}`;",
        ].join("\n"),
        "a.ts",
      ).map((r) => r.line),
    ).toEqual([1, 2, 4]);
  });

  it("flags a token link built from the build-time constant", () => {
    expect(
      secretLinkOriginReads(
        [
          "const a = `${APP_URL}/teams/join?token=${t}`;",
          "const b = `Manage email preferences: ${APP_URL}/unsubscribe?token=${t}`;",
        ].join("\n"),
        "a.ts",
      ).map((r) => r.line),
    ).toEqual([1, 2]);
  });

  it("leaves environment origins, passed-in origins and plain links alone", () => {
    expect(
      secretLinkOriginReads(
        [
          "const a = `${secretLinkAppUrl()}/reset-password?token=${t}`;",
          "const b = `${origin}${FROZEN.UNSUBSCRIBE}?token=${t}&type=${c}`;",
          "const c = `${await serverAppUrl()}/dashboard`;",
          "const d = `${APP_URL}/history/${id}`;",
          "const e = new URL(`/verify-email?token=${t}`, request.url);",
          "// `${APP_URL}/reset-password?token=${t}` in a comment",
        ].join("\n"),
        "a.ts",
      ),
    ).toEqual([]);
  });
});

/**
 * A link that carries a secret takes its origin from the environment.
 *
 * serverAppUrl() and resolveAppUrl() prefer the APP_URL row saved in the
 * settings page. Only the super admin can save it, and it feeds only the OAuth
 * and staff sign-in redirects. A reset link built from either one would carry
 * its token to whatever domain was saved there, so one browser session could
 * save a domain it owns, ask the public forgot-password endpoint for any
 * address and collect the link. The build-time APP_URL sent the same tokens
 * to https://vulnradar.dev on every pulled image. Token links use
 * secretLinkAppUrl() instead, which reads only the process environment.
 */
describe("no link that carries a secret follows the saved or build-time URL", () => {
  const SLOW = { timeout: 30_000 };

  it("anywhere in the scanned code", SLOW, () => {
    const found: string[] = [];
    for (const file of scan().files) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      if (!SECRET_LINK.test(text)) continue;
      for (const r of secretLinkOriginReads(text, file)) {
        found.push(`${file}:${r.line}  ${r.what}`);
      }
    }
    expect(
      found,
      "build the link from secretLinkAppUrl() (lib/config/server-app-url.ts)",
    ).toEqual([]);
  });
});
