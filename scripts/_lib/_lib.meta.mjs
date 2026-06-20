/**
 * VulnRadar — Project metadata and formatting helpers.
 *
 * Reads package.json once and exposes simple formatters. No I/O beyond
 * the initial read.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./_lib.env.mjs";

// ── Project metadata (from package.json — single source of truth) ──────────
export function getProjectMeta() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
  return {
    name: pkg.name ?? "vulnradar",
    version: pkg.version ?? "0.0.0",
    description: pkg.description ?? "",
    node: pkg.engines?.node ?? ">=20",
  };
}

// ── Formatting helpers ─────────────────────────────────────────────────────
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
