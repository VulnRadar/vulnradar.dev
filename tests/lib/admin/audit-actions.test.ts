import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  KNOWN_AUDIT_ACTIONS,
  LEGACY_AUDIT_ACTIONS,
  auditActionsIn,
  isAuditAction,
} from "@/lib/admin/audit-actions";

/**
 * Every action name written to admin_audit_log is registered and categorised.
 *
 * logAuditAction's parameter is typed as AuditAction, so tsc already refuses
 * an unregistered literal. This is the second half: it reads the call sites
 * themselves, so it also covers what the type cannot (the maintenance scripts
 * that INSERT directly, an `as` cast, a test that mocks the module away) and
 * it names the file and line. Before the registry existed, 31 of the logged
 * names were in no audit-log filter at all, and choosing any filter hid them.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");

function sourceFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full, pattern));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

/** The argument list of the call whose `(` is at `open`, split on top-level commas. */
function callArguments(source: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += source[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) {
        if (current.trim()) args.push(current.trim());
        return args;
      }
      depth--;
    }
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  return args;
}

/** Plain string literals in an expression (a ternary of two names gives both). */
function stringLiterals(expression: string): string[] {
  return [...expression.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(
    (m) => m[2],
  );
}

interface CallSite {
  where: string;
  names: string[];
}

function auditCallSites(): CallSite[] {
  const files = ["app", "lib"].flatMap((dir) =>
    sourceFiles(path.join(ROOT, dir), /\.tsx?$/),
  );
  const sites: CallSite[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /\b(?:logAction|logAuditAction)\s*\(/g,
    )) {
      const lineStart = source.lastIndexOf("\n", match.index) + 1;
      const lineText = source.slice(lineStart, match.index).trimStart();
      // The definition, and prose that mentions the function.
      if (/^(\/\/|\*|\/\*)/.test(lineText)) continue;
      if (/function\s+$/.test(source.slice(lineStart, match.index))) continue;
      const args = callArguments(source, match.index + match[0].length - 1);
      // A docs page renders `logAuditAction()` as text; a real call has the
      // admin, the target and the action.
      if (args.length < 3) continue;
      const line = source.slice(0, match.index).split("\n").length;
      sites.push({
        where: `${path.relative(ROOT, file).replace(/\\/g, "/")}:${line}`,
        names: stringLiterals(args[2]),
      });
    }
  }
  return sites;
}

describe("audit action registry", () => {
  const sites = auditCallSites();

  it("finds the call sites it is supposed to be checking", () => {
    // A scan that silently matched nothing would pass every check below.
    expect(sites.length).toBeGreaterThan(60);
  });

  it("names a registered action at every logAction / logAuditAction call", () => {
    const unregistered = sites.flatMap((site) =>
      site.names
        .filter((name) => !isAuditAction(name))
        .map((name) => `${site.where} logs "${name}"`),
    );
    expect(unregistered).toEqual([]);
  });

  it("passes the action as a literal the scan can read", () => {
    // A computed name still has to be an AuditAction to compile, but this
    // test cannot see which one. A ternary of two literals is fine; anything
    // else should be rewritten as one, or narrowed with isAuditAction and
    // listed here with the reason.
    const opaque = sites
      .filter((site) => site.names.length === 0)
      .map((site) => site.where);
    expect(opaque).toEqual([]);
  });

  it("registers the names the maintenance scripts INSERT directly", () => {
    // db-repair and db-repair-2fa write admin_audit_log without going through
    // logAuditAction, so the type never sees them.
    const scripts = sourceFiles(
      path.join(ROOT, "scripts", "maintenance"),
      /\.mjs$/,
    );
    const names: string[] = [];
    for (const file of scripts) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/INSERT INTO admin_audit_log/g)) {
        const open = source.indexOf("[", m.index);
        const args = callArguments(source, open);
        names.push(...stringLiterals(args[2] ?? ""));
      }
    }
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !isAuditAction(name))).toEqual([]);
  });

  it("registers the actions the W1 clusters log, before they exist", () => {
    for (const name of [
      "view_ai_conversation",
      "view_scan",
      "admin_cancel_scan",
      "adjust_credits",
      "demote_ai_tag",
      "ticket_status_changed",
      "ticket_assigned",
    ]) {
      expect(isAuditAction(name), name).toBe(true);
    }
  });

  it("puts every known action in a real category with a label and a verb", () => {
    const categories = new Set<string>(AUDIT_CATEGORIES.map((c) => c.id));
    for (const [name, def] of Object.entries(KNOWN_AUDIT_ACTIONS)) {
      expect(categories.has(def.category), `${name}: ${def.category}`).toBe(
        true,
      );
      expect(def.label.trim(), name).not.toBe("");
      expect(def.verb.trim(), name).not.toBe("");
    }
  });

  it("leaves no category empty", () => {
    for (const category of AUDIT_CATEGORIES) {
      expect(auditActionsIn(category.id).length, category.id).toBeGreaterThan(
        0,
      );
    }
  });

  it("keeps legacy names out of what code may write", () => {
    // A legacy name is display-only: rows still carry it, nothing may log it.
    const overlap = Object.keys(LEGACY_AUDIT_ACTIONS).filter(
      (name) => name in AUDIT_ACTIONS,
    );
    expect(overlap).toEqual([]);
    for (const name of Object.keys(LEGACY_AUDIT_ACTIONS)) {
      expect(isAuditAction(name), name).toBe(false);
    }
  });

  it("does not treat inherited object keys as actions", () => {
    expect(isAuditAction("toString")).toBe(false);
    expect(isAuditAction("constructor")).toBe(false);
  });
});
