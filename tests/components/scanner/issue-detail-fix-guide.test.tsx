/**
 * The fix section of a finding links to the guide for that finding's check,
 * and only when the guide exists. The old link was a bare /checks for every
 * finding, which left someone holding a missing-SPF finding to find the right
 * page in a list of 800.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Vulnerability } from "@/lib/scanner/types";

vi.mock("@/components/scanner/use-teammates", () => ({
  useTeammates: () => ({ teammates: [], loading: false }),
}));

const { IssueDetail } = await import("@/components/scanner/issue-detail");

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "hsts-missing--abc123",
    title: "Missing HSTS Header",
    severity: "medium",
    category: "headers",
    description: "No Strict-Transport-Security header.",
    evidence: "No header present.",
    riskImpact: "Downgrade attacks.",
    explanation: "HSTS pins HTTPS.",
    fixSteps: ["Add the header."],
    codeExamples: [],
    ...overrides,
  };
}

function render(issue: Vulnerability): string {
  return renderToStaticMarkup(<IssueDetail issue={issue} onBack={() => {}} />);
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
}

describe("IssueDetail fix guide link", () => {
  it("links the guide for the finding's own check", () => {
    const html = render(finding());

    expect(hrefs(html)).toContain("/checks/hsts-missing");
    expect(html).toContain("Read the full fix guide for this check");
  });

  it("links an async finding to the write-up for its check", () => {
    const html = render(
      finding({
        id: "async-missing-spf-record--k3j9x1",
        title: "Missing SPF Record",
        category: "configuration",
      }),
    );

    expect(hrefs(html)).toContain("/checks/spf-record");
  });

  it("falls back to the bare index when the check has no guide", () => {
    const html = render(finding({ id: "page-no-such-check--k3j9x1" }));

    expect(html).not.toContain("Read the full fix guide for this check");
    expect(hrefs(html).filter((h) => h.startsWith("/checks"))).toEqual([
      "/checks",
    ]);
  });

  it("always keeps the way to the whole index", () => {
    expect(hrefs(render(finding()))).toContain("/checks");
  });
});
