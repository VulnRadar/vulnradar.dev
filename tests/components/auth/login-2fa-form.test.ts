import { describe, it, expect } from "vitest";
import { fetchCalls } from "@/tests/components/_fetch-calls";

/**
 * The email-method step of the 2FA login asks for a fresh code through the API
 * map, not through a path typed into the handler. The component needs a DOM to
 * click, so this reads its requests from the syntax tree.
 */
describe("login-2fa-form requests", () => {
  const calls = fetchCalls("components/auth/login-2fa-form.tsx");

  it("posts the resend to API.AUTH.TWO_FA.EMAIL_SEND", () => {
    const resend = calls.filter(
      (c) => c.target === "API.AUTH.TWO_FA.EMAIL_SEND",
    );
    expect(resend).toHaveLength(1);
    expect(resend[0].options).toContain('method: "POST"');
  });

  it("verifies the code through API.AUTH.TWO_FA.VERIFY", () => {
    expect(calls.map((c) => c.target)).toContain("API.AUTH.TWO_FA.VERIFY");
  });

  it("builds every request from the API map", () => {
    for (const call of calls) expect(call.target).toMatch(/^API\./);
  });
});
