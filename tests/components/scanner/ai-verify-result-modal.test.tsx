/**
 * The verify result says why a pass stopped, not only that it did.
 *
 * A pass starts once the account can cover one finding against an empty
 * page, so an account with less left than the real page needs is let in and
 * stops before the first call with budgetExhausted set. The modal never read
 * that flag, so it reported the stop as the AI service not answering and said
 * to try again in a minute, which runs straight into the same stop.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Vulnerability } from "@/lib/scanner/types";
import type { AiVerificationOutcome } from "@/lib/ai/verify-findings";

// The dialog renders through a portal, which renderToStaticMarkup leaves
// empty; only the copy is under test here.
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});

const { AiVerifyResultModal } =
  await import("@/components/scanner/ai-verify-result-modal");

function finding(id: string, verdict?: "confirmed" | "uncertain") {
  return {
    id,
    title: `Finding ${id}`,
    severity: "low",
    ...(verdict ? { aiVerdict: verdict } : {}),
  } as unknown as Vulnerability;
}

function render(
  findings: Vulnerability[],
  outcome: AiVerificationOutcome,
): string {
  return renderToStaticMarkup(
    <AiVerifyResultModal
      open
      onOpenChange={() => {}}
      loading={false}
      error={null}
      findings={findings}
      pendingCount={findings.length}
      outcome={outcome}
    />,
  );
}

describe("AiVerifyResultModal: a pass the allowance stopped", () => {
  it("says the allowance ran out when it stopped before the first finding", () => {
    const html = render([finding("a"), finding("b")], {
      configured: true,
      verdicts: 0,
      attempted: 2,
      budgetExhausted: true,
    });

    expect(html).toContain("AI verification did not run");
    expect(html).toContain("Your AI allowance ran out");
    expect(html).not.toContain("did not answer");
    expect(html).not.toContain("Try again in a minute");
  });

  it("says how far it got when the allowance ran out part way", () => {
    const html = render([finding("a", "uncertain"), finding("b")], {
      configured: true,
      verdicts: 1,
      attempted: 2,
      budgetExhausted: true,
    });

    expect(html).toContain(
      "1 of 2 findings were checked before your AI allowance ran out. The rest have no AI verdict.",
    );
  });

  it("still reports an endpoint that answered nothing as an outage", () => {
    const html = render([finding("a")], {
      configured: true,
      verdicts: 0,
      attempted: 1,
    });

    expect(html).toContain("did not answer for any finding");
    expect(html).not.toContain("allowance");
  });
});
