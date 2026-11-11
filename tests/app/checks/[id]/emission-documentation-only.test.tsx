/**
 * A write-up that matches nothing a scan reports makes no promise about an id.
 * Only the two retired stubs in headers.json and content.json are marked
 * documentationOnly, and they have their own test, so this branch is exercised
 * on a dns.json entry with the emission lookup stubbed.
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/scanner/check-emission", () => ({
  getCheckEmission: () => ({
    emitted: false,
    emittedAs: [],
    documentationOnly: true,
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-nonce", "test-nonce"]]),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/components/landing/landing-nav", () => ({
  LandingNav: () => null,
}));
vi.mock("@/components/scanner/footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/scan-cta-form", () => ({
  ScanCtaForm: () => null,
}));
vi.mock("@/components/docs", () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
  InlineCode: ({ children }: { children: ReactNode }) => (
    <code>{children}</code>
  ),
}));

const { default: CheckPage } = await import("@/app/checks/[id]/page");

async function renderText(id: string): Promise<string> {
  const html = renderToStaticMarkup(
    await CheckPage({ params: Promise.resolve({ id }) }),
  );
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, " ")
    .replace(/<\/?(code|span)[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("check page: documentation only", () => {
  it("says no scan reports the id and drops the id-stability claim", async () => {
    const page = await renderText("spf-record");

    expect(page).toContain("No scan reports a finding under the id spf-record");
    expect(page).not.toContain("stable across every scan");
    expect(page).not.toContain("which stays the same between runs");
    expect(page).not.toContain("A finding from this check carries an id");
  });

  it("drops the automatic-detection FAQ answer but keeps the severity one", async () => {
    const page = await renderText("spf-record");

    expect(page).toContain("How severe is");
    expect(page).not.toContain("check for this automatically");
  });
});
