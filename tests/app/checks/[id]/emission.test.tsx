/**
 * What a check page promises about its id depends on what a scan reports.
 *
 * An entry in dns.json, email.json or tls.json can be write-up for findings
 * that carry another id (`async-<title slug>`), and one of those pages used to
 * say "the check id is spf-record, stable across every scan" about an id no
 * scan has ever reported. These render the page and read the sentence.
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("check page: an id a scan reports", () => {
  it("keeps the stable-id sentence for a check reported under its own id", async () => {
    const page = await renderText("hsts-missing");

    expect(page).toContain("The check id is hsts-missing, stable across every");
    expect(page).toContain("under the check id hsts-missing");
  });
});

describe("check page: write-up for findings with another id", () => {
  it("names the async id prefix instead of promising the page id is stable", async () => {
    const page = await renderText("spf-record");

    expect(page).toContain(
      "A finding from this check carries an id starting async-missing-spf-record, followed by a hash of the scanned URL",
    );
    expect(page).not.toContain("The check id is spf-record");
    expect(page).not.toContain("under the check id spf-record");
  });

  it("answers the FAQ with the prefix, not the page id", async () => {
    const page = await renderText("spf-record");

    expect(page).toContain("Does VulnRadar check for this automatically?");
    expect(page).toContain(
      "A finding from it carries an id starting async-missing-spf-record",
    );
  });

  it("lists every prefix when one write-up covers several findings", async () => {
    const page = await renderText("tls-certificate-expiry");

    expect(page).toContain(
      "starting async-expired-tls-certificate, async-tls-certificate-expiring-soon or async-tls-certificate-expiring-within-30-days, followed by",
    );
  });
});
