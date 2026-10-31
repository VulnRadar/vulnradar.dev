import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * DocsSteps is an <ol> and nothing else: no state, no effect, no handler. It
 * carried a "use client" it never needed, which made it a client boundary on
 * every docs page that renders it (/docs and /docs/extension are server
 * components), so its markup and the module behind it shipped as script.
 *
 * Only this component. The rest of components/docs was left alone until each
 * one is measured; some of them do use hooks.
 */

const ROOT = path.resolve(__dirname, "../../..");
const FILE = "components/docs/docs-steps.tsx";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("DocsSteps", () => {
  const raw = read(FILE);
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("has no client directive", () => {
    expect(raw).not.toMatch(/^\s*["']use client["']/m);
  });

  it("uses nothing that needs one", () => {
    expect(code).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(code).not.toMatch(/\bon[A-Z]\w*=\{/);
    expect(code).not.toMatch(/from\s+["'](react|next\/navigation)["']/);
    expect(code).not.toMatch(/\b(window|document|localStorage)\b/);
  });

  it("is still a real ordered list", () => {
    expect(code).toContain("<ol");
    expect(code).toContain("<li");
  });

  it("is rendered only by pages that are server components", () => {
    // If one of these ever becomes a client component the directive is moot,
    // but the file would then be bundled there; keep the claim honest.
    for (const page of ["app/docs/page.tsx", "app/docs/extension/page.tsx"]) {
      expect(read(page)).not.toMatch(/^\s*["']use client["']/m);
    }
  });
});
