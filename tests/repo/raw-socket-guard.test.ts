import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * A file under lib/ that opens a raw TCP or TLS socket also asks the
 * private-address guard about the address it dials.
 *
 * The scanner's HTTP requests are request-forgery sinks to CodeQL, which is
 * why they carry its suppressions and why a new unguarded fetch gets flagged
 * on the pull request. net.createConnection, net.connect, tls.connect and
 * new net.Socket are not sinks to it, so a port probe, a banner grab, a TLS
 * handshake or the zone-transfer probe that stopped checking its address
 * would pass every check while aiming the scanner at 10.0.0.5 or
 * 169.254.169.254. The addresses those probes dial come from the target:
 * its DNS answers, its NS records, the host the user typed.
 *
 * The guard is resolveSafePublicIp, validateScanTarget or isPrivateIP, called
 * (not merely named in a comment) somewhere in the same file. That is a
 * floor, not a proof the right address is checked; the per-probe tests
 * (zone-transfer, port-scan, banner, tls-handshake) prove that. A file that
 * opens a socket for another reason goes in ALLOWED with the reason, and an
 * entry whose sockets are gone fails, so the list only shrinks.
 */

const ROOT = path.resolve(__dirname, "..", "..");

const SOCKET_MODULES = new Set(["net", "node:net", "tls", "node:tls"]);
const SOCKET_FUNCTIONS = new Set(["createConnection", "connect"]);
const SOCKET_CLASSES = new Set(["Socket", "TLSSocket"]);
const GUARDS = new Set([
  "resolveSafePublicIp",
  "validateScanTarget",
  "isPrivateIP",
]);

/** File -> why it may open a socket without calling a guard. */
const ALLOWED: Record<string, string> = {};

/** The files the detector has to keep seeing, so it cannot go blind quietly. */
const KNOWN_SOCKET_FILES = [
  "lib/scanner/async-checks.ts",
  "lib/scanner/checks/tls.ts",
  "lib/scanner/port-scan.ts",
  "lib/scanner/protocols/banner.ts",
  "lib/scanner/tls-handshake.ts",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (
      /\.(tsx?|mts|cts|mjs|cjs|js)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(rel);
    }
  }
  return out;
}

/** The module specifier of `require("x")`, `import("x")` or `await` of one. */
function loadedModule(expr: ts.Expression | undefined): string | null {
  let cur = expr;
  while (
    cur &&
    (ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur))
  ) {
    cur = cur.expression;
  }
  if (!cur || !ts.isCallExpression(cur)) return null;
  const isRequire =
    ts.isIdentifier(cur.expression) && cur.expression.text === "require";
  const isImport = cur.expression.kind === ts.SyntaxKind.ImportKeyword;
  const arg = cur.arguments[0];
  if ((isRequire || isImport) && arg && ts.isStringLiteralLike(arg)) {
    return arg.text;
  }
  return null;
}

interface Bindings {
  /** Local names bound to the whole net or tls module. */
  namespaces: Set<string>;
  /** Local name -> the net/tls export it is bound to. */
  named: Map<string, string>;
}

function collectBindings(source: ts.SourceFile): Bindings {
  const namespaces = new Set<string>();
  const named = new Map<string, string>();
  const bindObjectPattern = (pattern: ts.ObjectBindingPattern) => {
    for (const el of pattern.elements) {
      if (!ts.isIdentifier(el.name)) continue;
      const imported = el.propertyName?.getText(source) ?? el.name.text;
      named.set(el.name.text, imported);
    }
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      SOCKET_MODULES.has(node.moduleSpecifier.text) &&
      node.importClause &&
      !node.importClause.isTypeOnly
    ) {
      const clause = node.importClause;
      if (clause.name) namespaces.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (el.isTypeOnly) continue;
          named.set(el.name.text, (el.propertyName ?? el.name).text);
        }
      }
    }
    if (ts.isVariableDeclaration(node)) {
      const mod = loadedModule(node.initializer);
      if (mod && SOCKET_MODULES.has(mod)) {
        if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
        else if (ts.isObjectBindingPattern(node.name)) {
          bindObjectPattern(node.name);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { namespaces, named };
}

/** `ns.member` where ns is bound to net or tls, or `ns.default.member`. */
function namespaceMember(
  expr: ts.Expression,
  namespaces: Set<string>,
): string | null {
  if (!ts.isPropertyAccessExpression(expr)) return null;
  let target = expr.expression;
  if (ts.isPropertyAccessExpression(target) && target.name.text === "default") {
    target = target.expression;
  }
  if (ts.isIdentifier(target) && namespaces.has(target.text)) {
    return expr.name.text;
  }
  return null;
}

interface FileReport {
  /** Each socket-opening call, as `line: text`. */
  sockets: string[];
  guarded: boolean;
}

function scan(file: string, text: string): FileReport {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const { namespaces, named } = collectBindings(source);
  const sockets: string[] = [];
  let guarded = false;
  const record = (node: ts.Node) => {
    const line =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    sockets.push(`${line}: ${node.getText(source).split("\n")[0]}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const member = namespaceMember(callee, namespaces);
      if (member && SOCKET_FUNCTIONS.has(member)) record(node);
      if (ts.isIdentifier(callee)) {
        const imported = named.get(callee.text);
        if (imported && SOCKET_FUNCTIONS.has(imported)) record(node);
        if (GUARDS.has(callee.text)) guarded = true;
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        GUARDS.has(callee.name.text)
      ) {
        guarded = true;
      }
    }
    if (ts.isNewExpression(node)) {
      const callee = node.expression;
      const member = namespaceMember(callee, namespaces);
      if (member && SOCKET_CLASSES.has(member)) record(node);
      if (ts.isIdentifier(callee)) {
        const imported = named.get(callee.text);
        if (imported && SOCKET_CLASSES.has(imported)) record(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { sockets, guarded };
}

function socketFiles(): Map<string, FileReport> {
  const found = new Map<string, FileReport>();
  for (const file of sourceFiles("lib")) {
    const report = scan(file, readFileSync(path.join(ROOT, file), "utf8"));
    if (report.sockets.length > 0) found.set(file, report);
  }
  return found;
}

describe("the raw-socket detector", () => {
  it("reports a createConnection call in a file with no guard", () => {
    const report = scan(
      "lib/scanner/example.ts",
      [
        'import { createConnection } from "net";',
        "// isPrivateIP(ip) is only named in this comment",
        "export function dial(host: string) {",
        "  return createConnection({ host, port: 53 });",
        "}",
      ].join("\n"),
    );
    expect(report.sockets).toEqual(["4: createConnection({ host, port: 53 })"]);
    expect(report.guarded).toBe(false);
  });

  it("sees every spelling of a socket open", () => {
    const report = scan(
      "lib/scanner/example.ts",
      [
        'import * as net from "node:net";',
        'import tls, { connect as tlsDial, TLSSocket } from "tls";',
        'import { createConnection as dial, Socket } from "net";',
        "export async function all(host: string) {",
        "  net.createConnection({ host, port: 1 });",
        "  net.connect(1, host);",
        "  tls.connect({ host, port: 2 });",
        "  tls.default.connect({ host, port: 3 });",
        "  tlsDial({ host, port: 4 });",
        "  dial({ host, port: 5 });",
        "  new net.Socket();",
        "  new Socket();",
        "  new TLSSocket(new Socket());",
        '  const lazy = await import("node:net");',
        "  lazy.connect(6, host);",
        '  const { createConnection: req } = require("tls");',
        "  req({ host, port: 7 });",
        "}",
      ].join("\n"),
    );
    expect(report.sockets.map((s) => Number(s.split(":")[0]))).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 15, 17,
    ]);
  });

  it("counts a call to a guard, and ignores sockets it is not given", () => {
    const report = scan(
      "lib/scanner/example.ts",
      [
        'import * as net from "net";',
        'import { isPrivateIP } from "@/lib/scanner/safe-fetch";',
        "export async function probe(ip: string, pool: { connect(): void }) {",
        "  pool.connect();",
        "  if (isPrivateIP(ip)) return;",
        "  net.connect(53, ip);",
        "}",
      ].join("\n"),
    );
    expect(report.sockets).toEqual(["6: net.connect(53, ip)"]);
    expect(report.guarded).toBe(true);
  });

  it("does not treat a type-only import as a socket binding", () => {
    const report = scan(
      "lib/scanner/example.ts",
      [
        'import type { Socket } from "net";',
        "export function wrap(s: Socket) { return new Socket(); }",
      ].join("\n"),
    );
    expect(report.sockets).toEqual([]);
  });
});

describe("every raw socket under lib/ is behind the private-address guard", () => {
  const found = socketFiles();

  it("still finds the probes known to open sockets", () => {
    for (const file of KNOWN_SOCKET_FILES) {
      expect(found.has(file), `${file} opens a socket`).toBe(true);
    }
  });

  it("has a guard call in every file that opens one", () => {
    const unguarded = [...found]
      .filter(([file, report]) => !report.guarded && !(file in ALLOWED))
      .map(([file, report]) => `${file}\n    ${report.sockets.join("\n    ")}`);
    expect(
      unguarded,
      "Call resolveSafePublicIp, validateScanTarget or isPrivateIP on the address before dialling it, or add the file to ALLOWED with the reason",
    ).toEqual([]);
  });

  it("has no allow-list entry for a file that no longer opens a socket", () => {
    const stale = Object.keys(ALLOWED).filter((file) => !found.has(file));
    expect(stale).toEqual([]);
  });
});
