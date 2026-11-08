import { describe, it, expect, vi } from "vitest";
import { checkOgImagePath } from "@/app/_og/check-card";
import { getAllChecks, getCheckById } from "@/lib/seo/checks-content";

vi.mock("next/headers", () => ({
  headers: async () => new Map(),
}));

const base = getCheckById("cors-origin-reflection")!;
const version = (path: string) =>
  new URL(path, "https://x.test").searchParams.get("v");

describe("checkOgImagePath", () => {
  it("points at the check's own card and carries a version", () => {
    const path = checkOgImagePath(base);
    expect(path.split("?")[0]).toBe(`/checks/${base.id}/opengraph-image`);
    expect(version(path)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable for the same content", () => {
    expect(checkOgImagePath(base)).toBe(checkOgImagePath({ ...base }));
  });

  it.each([
    ["title", { title: `${base.title} changed` }],
    ["description", { description: `${base.description} changed` }],
    ["severity", { severity: base.severity === "low" ? "high" : "low" }],
    ["category", { category: "api" }],
  ] as const)("changes when the %s changes", (_name, change) => {
    expect(checkOgImagePath({ ...base, ...change })).not.toBe(
      checkOgImagePath(base),
    );
  });

  it("does not change for a field the card does not draw", () => {
    expect(checkOgImagePath({ ...base, riskImpact: "other" })).toBe(
      checkOgImagePath(base),
    );
  });

  it("cannot be confused by moving text between two fields", () => {
    const a = { ...base, title: "ab", description: "c" };
    const b = { ...base, title: "a", description: "bc" };
    expect(checkOgImagePath(a)).not.toBe(checkOgImagePath(b));
  });

  it("gives every check its own URL", () => {
    const all = getAllChecks();
    expect(new Set(all.map(checkOgImagePath)).size).toBe(all.length);
  });

  it("is what the page publishes", async () => {
    const { generateMetadata } = await import("@/app/checks/[id]/page");
    const meta = await generateMetadata({
      params: Promise.resolve({ id: base.id }),
    });
    const images = meta.openGraph?.images as { url: string }[];
    expect(images[0]?.url).toBe(checkOgImagePath(base));
  });
});
