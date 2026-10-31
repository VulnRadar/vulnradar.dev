import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A route's loading.tsx is the first thing a navigation shows, and it arrives
 * before the page's own code. Three of them reached their skeleton through a
 * barrel or through the page's client module, so the placeholder cost as much
 * to load as the thing it stood in for:
 *
 *   - /admin/scans/[id] imported its skeleton from scan-inspector.tsx, a client
 *     module holding the fetch, the status pill and the admin shared barrel.
 *   - /teams and /shares imported theirs from the folder index, which
 *     re-exports every list, dialog and form beside it.
 *
 * Source-text assertions, like the rest of tests/components: tsconfig keeps
 * `jsx: preserve`, so a .tsx component cannot be imported into a test.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the scan inspector's route fallback", () => {
  const skeleton = "components/admin/scans/scan-inspector-skeleton.tsx";

  it("lives in a module with no client directive, so the fallback ships no script", () => {
    expect(read(skeleton)).not.toMatch(/^\s*["']use client["']/m);
  });

  it("does not pull in the inspector, the admin barrel or any hook", () => {
    const src = code(skeleton);
    expect(src).not.toContain('scan-inspector"');
    expect(src).not.toContain("@/components/admin/shared");
    expect(src).not.toMatch(/\buse(State|Effect|Ref|Memo|Callback)\b/);
    expect(src).not.toContain("useAuth");
  });

  it("exports the header and the skeleton the route and the page share", () => {
    const src = code(skeleton);
    expect(src).toContain("export function ScanInspectorHeader");
    expect(src).toContain("export function ScanInspectorSkeleton");
  });

  it("is imported by the route fallback and by the inspector, from the same place", () => {
    for (const file of [
      "app/admin/scans/[id]/loading.tsx",
      "components/admin/scans/scan-inspector.tsx",
    ]) {
      expect(code(file)).toContain(
        'from "@/components/admin/scans/scan-inspector-skeleton"',
      );
    }
    // The loading file no longer reaches into the client module at all.
    expect(code("app/admin/scans/[id]/loading.tsx")).not.toMatch(
      /from\s+["']@\/components\/admin\/scans\/scan-inspector["']/,
    );
  });

  it("is not defined a second time in the inspector", () => {
    const src = code("components/admin/scans/scan-inspector.tsx");
    expect(src).not.toContain("export function ScanInspectorHeader");
    expect(src).not.toContain("export function ScanInspectorSkeleton");
  });
});

describe("route fallbacks that import their skeleton from its own file", () => {
  it.each([
    ["app/teams/loading.tsx", "@/components/teams/teams-skeleton"],
    ["app/shares/loading.tsx", "@/components/shares/shares-skeleton"],
    ["app/history/loading.tsx", "@/components/history/history-skeleton"],
  ])("%s", (file, target) => {
    const src = code(file);
    expect(src).toContain(`from "${target}"`);
    expect(src).not.toMatch(
      /from\s+["']@\/components\/(teams|shares|history)["']/,
    );
  });
});
