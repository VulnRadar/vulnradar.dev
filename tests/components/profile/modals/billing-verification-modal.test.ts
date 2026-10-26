import { describe, it, expect } from "vitest";
import { fetchCalls } from "@/tests/components/_fetch-calls";

/**
 * The billing verification dialog sends the code (Continue and Resend) and
 * redeems it (Verify). It needs a DOM to click, so its requests are read from
 * the syntax tree: three calls, two endpoints, both from the API map.
 */
describe("billing-verification-modal requests", () => {
  const calls = fetchCalls(
    "components/profile/modals/billing-verification-modal.tsx",
  );

  it("sends the code from both Continue and Resend", () => {
    const send = calls.filter((c) => c.target === "API.BILLING_VERIFY_SEND");
    expect(send).toHaveLength(2);
    for (const call of send) expect(call.options).toContain('method: "POST"');
  });

  it("redeems the code with the code in the body", () => {
    const verify = calls.filter((c) => c.target === "API.BILLING_VERIFY");
    expect(verify).toHaveLength(1);
    expect(verify[0].options).toContain('method: "POST"');
    expect(verify[0].options).toContain("JSON.stringify({ code })");
  });

  it("makes no other request", () => {
    expect(calls).toHaveLength(3);
  });
});
