import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What the scan actions menu is allowed to put in the chunk of every page that
 * shows a report.
 *
 * The menu is on the dashboard result, /history/[id], /compare and the host
 * pages. It used to import all five report writers (the PDF one is 800 lines)
 * and three modals statically, so a reader who never exported anything still
 * downloaded and parsed them. Each writer is now imported when its format is
 * picked, and each modal is mounted only after it has been opened.
 *
 * Source-text assertions, like the rest of tests/components: tsconfig keeps
 * `jsx: preserve`, so a .tsx component cannot be imported into a test.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MENU = "components/scanner/scan-actions-menu.tsx";

describe("the scan actions menu", () => {
  const src = code(MENU);

  it.each([
    ["pdf-report", "generatePdfReport"],
    ["sarif-report", "generateSarifReport"],
    ["markdown-report", "generateMarkdownReport"],
    ["csv-report", "generateCsvReport"],
    ["compliance-report", "generateComplianceReport"],
  ])("loads %s only when its format is picked", (file, fn) => {
    expect(src).not.toMatch(
      new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from`),
    );
    expect(src).toContain(`await import("@/lib/reports/${file}")`);
  });

  it("awaits the generator, so a chunk that fails to load is reported as a failed export", () => {
    const run = src.slice(src.indexOf("async function runExport"));
    const tryBlock = run.slice(0, run.indexOf("finally"));
    expect(tryBlock).toContain("await generate()");
    expect(tryBlock).toContain('title: "Export failed"');
  });

  it.each([
    ["ShareModal", "./share-modal"],
    ["AiVerifyResultModal", "./ai-verify-result-modal"],
    ["AiSummaryModal", "./ai-summary-modal"],
  ])("loads %s through next/dynamic, with a loading option", (name, file) => {
    expect(src).not.toMatch(
      new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`),
    );
    const decl = src.slice(src.indexOf(`const ${name} = dynamic(`));
    const block = decl.slice(0, decl.indexOf(");") + 2);
    expect(block).toContain(`import("${file}")`);
    // Without a `loading` option next/dynamic suspends the nearest ancestor
    // boundary, which replays the route skeleton over a finished report.
    expect(block).toContain("loading:");
  });

  it("imports next/dynamic", () => {
    expect(src).toContain('import dynamic from "next/dynamic"');
  });

  it("mounts the two AI modals only after they have been opened", () => {
    expect(src).toContain("useOpenedOnce(verifyModalOpen)");
    expect(src).toContain("useOpenedOnce(summaryModalOpen)");
    expect(src).toMatch(/\{verifyModalMounted && \(\s*<AiVerifyResultModal/);
    expect(src).toMatch(/\{summaryModalMounted && \(\s*<AiSummaryModal/);
  });

  it("keeps a modal mounted once opened, so it can play its close animation", () => {
    const hook = src.slice(src.indexOf("function useOpenedOnce"));
    const body = hook.slice(0, hook.indexOf("\n}\n"));
    expect(body).toContain("if (open && !opened) setOpened(true)");
    expect(body).not.toContain("setOpened(false)");
  });
});

describe("pages that only need one piece of a barrel", () => {
  // components/history/index.ts and components/shared/index.ts re-export every
  // sibling. A named import from the barrel is a value import of the whole
  // module graph behind it, so /attack-surface, /assets and /public-scans each
  // carried the history list, filters and skeleton to draw a row of tabs.
  const FROM_HISTORY_BARREL = /from\s+["']@\/components\/history["']/;
  const FROM_SHARED_BARREL = /from\s+["']@\/components\/shared["']/;

  it.each([
    "app/attack-surface/page.tsx",
    "app/assets/page.tsx",
    "app/public-scans/page.tsx",
  ])("%s imports the tab strip from its own file", (file) => {
    const src = code(file);
    expect(src).not.toMatch(FROM_HISTORY_BARREL);
    expect(src).toContain(
      'import { HistoryViewTabs } from "@/components/history/history-view-tabs"',
    );
  });

  it("draws the history route skeleton from its own file", () => {
    const src = code("app/history/loading.tsx");
    expect(src).not.toMatch(FROM_HISTORY_BARREL);
    expect(src).toContain('from "@/components/history/history-skeleton"');
  });

  it.each([
    MENU,
    "components/compare/compare-actions-menu.tsx",
    "components/admin/features/engine-feedback-manager.tsx",
  ])("%s imports the page actions menu from its own file", (file) => {
    const src = code(file);
    expect(src).not.toMatch(FROM_SHARED_BARREL);
    expect(src).toContain('from "@/components/shared/page-actions-menu"');
  });
});
