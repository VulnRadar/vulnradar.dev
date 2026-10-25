import { describe, it, expect } from "vitest";
import {
  ENGINE_FAILURE_KINDS,
  FAILURE_KINDS,
  FAILURE_KIND_LABELS,
  isEngineFailure,
  isFailureKind,
} from "@/lib/scanner/failure-kinds";
import { SCHEMA_STEPS } from "@/lib/database/schema/index.mjs";
import { VALUE_SET_CHECKS } from "@/lib/database/schema/04-constraints.mjs";

/**
 * FAILURE_KINDS is restated in SQL three times, by files that cannot import
 * TypeScript: the boot ALTER that adds the column, the VALUE_SET_CHECKS entry,
 * and the migration's addColumns definition. A kind added here and not there
 * is an INSERT the database refuses, on whichever path a deployment took, and
 * only when that kind is first written. These hold all three to the array.
 */
const migration = await import("@/scripts/migrate/versions/2.0.0-to-3.0.0.mjs");

function inList(sql: string): string[] {
  const match = /failure_kind IN \(([^)]*)\)/.exec(sql);
  if (!match) throw new Error(`no failure_kind IN list in: ${sql}`);
  return match[1]
    .split(",")
    .map((v) => v.trim().replace(/^'|'$/g, ""))
    .sort();
}

const expected = [...FAILURE_KINDS].sort();

describe("FAILURE_KINDS and the SQL that restates it", () => {
  it("matches the boot ALTER", () => {
    const step = SCHEMA_STEPS.find(
      (s: { id: string }) => s.id === "scan-history-failure-kind",
    );
    expect(step, "boot step scan-history-failure-kind").toBeDefined();
    expect(inList(String(step!.sql))).toEqual(expected);
  });

  it("matches VALUE_SET_CHECKS", () => {
    const check = (
      VALUE_SET_CHECKS as Array<{ name: string; expr: string }>
    ).find((c) => c.name === "scan_history_failure_kind_check");
    expect(check).toBeDefined();
    expect(inList(check!.expr)).toEqual(expected);
  });

  it("matches the migration's addColumns definition", () => {
    const column = (
      migration.upgrade.addColumns as Array<{
        table: string;
        column: string;
        definition: string;
      }>
    ).find((c) => c.table === "scan_history" && c.column === "failure_kind");
    expect(column).toBeDefined();
    expect(inList(column!.definition)).toEqual(expected);
  });

  it("only backfills kinds the CHECK allows", () => {
    // The backfill writes literals of its own; one outside the list would
    // abort that boot step on the first matching row.
    const step = SCHEMA_STEPS.find(
      (s: { id: string }) => s.id === "scan-history-failure-kind-backfill",
    );
    expect(step).toBeDefined();
    const written = [
      ...String(step!.sql).matchAll(/THEN '([a-z_]+)'|ELSE '([a-z_]+)'/g),
    ].map((m) => m[1] ?? m[2]);
    expect(written.length).toBeGreaterThan(5);
    expect(written.filter((kind) => !isFailureKind(kind))).toEqual([]);
  });
});

describe("failure kind helpers", () => {
  it("labels every kind", () => {
    for (const kind of FAILURE_KINDS) {
      expect(FAILURE_KIND_LABELS[kind], kind).toBeTruthy();
    }
  });

  it("counts only engine kinds as engine failures", () => {
    expect(ENGINE_FAILURE_KINDS.every((k) => isEngineFailure(k))).toBe(true);
    for (const kind of [
      "cancelled",
      "admin_cancelled",
      "quota_refused",
      "not_run",
      "target_unreachable",
      "target_tls",
    ]) {
      expect(isEngineFailure(kind), kind).toBe(false);
    }
  });

  it("counts a row the backfill has not reached as an engine failure", () => {
    // Undercounting real failures is the worse mistake for a health check.
    expect(isEngineFailure(null)).toBe(true);
    expect(isEngineFailure(undefined)).toBe(true);
  });

  it("narrows only known kinds", () => {
    expect(isFailureKind("timeout")).toBe(true);
    expect(isFailureKind("failed")).toBe(false);
    expect(isFailureKind(42)).toBe(false);
  });
});
