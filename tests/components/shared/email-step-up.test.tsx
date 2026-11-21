/**
 * EmailStepUp is what an account with no password shows where the password
 * field would be, before any security change (lib/auth/reauth.ts). Its
 * session alone used to be accepted instead, so a stolen session cookie could
 * change the email, set a password and switch two-step off.
 *
 * No DOM here: each phase's markup comes from renderToStaticMarkup on the
 * stateless view, and the two requests are driven with a stubbed fetch.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/providers/auth-provider", () => ({
  clearAuthCache: vi.fn(),
}));

const { API } = await import("@/lib/config/client-constants");
const {
  EmailStepUp,
  EmailStepUpView,
  confirmStepUpCode,
  requestStepUpCode,
  stepUpCanSave,
} = await import("@/components/shared/email-step-up");
type ViewProps = Parameters<typeof EmailStepUpView>[0];

const SOURCE = readFileSync(
  path.resolve(__dirname, "../../../components/shared/email-step-up.tsx"),
  "utf8",
);

function view(over: Partial<ViewProps> = {}) {
  return renderToStaticMarkup(
    <EmailStepUpView
      phase="start"
      idPrefix="t"
      code=""
      maskedEmail={null}
      busy={false}
      error={null}
      onSend={() => {}}
      onCodeChange={() => {}}
      onConfirm={() => {}}
      onSignInAgain={() => {}}
      {...over}
    />,
  );
}

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EmailStepUp", () => {
  it("starts by offering to email a code, with no password input at all", () => {
    const html = renderToStaticMarkup(<EmailStepUp onReady={() => {}} />);
    expect(html).toContain(">Email me a code<");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("<input");
  });

  it("offers a fresh sign-in instead on a server that cannot send mail", () => {
    const html = renderToStaticMarkup(
      <EmailStepUp emailConfigured={false} onReady={() => {}} />,
    );
    expect(html).toContain(">Sign in again<");
    expect(html).not.toContain(">Email me a code<");
  });
});

describe("EmailStepUp as a second factor", () => {
  // A password account that signs in with email codes, in front of an update
  // or an impersonation (lib/auth/staff-step-up.ts): the same send and verify,
  // but the code is its second factor, not a stand-in for a password it has.
  it("explains the code as the account's two-step sign-in, not a missing password", () => {
    const html = renderToStaticMarkup(
      <EmailStepUp mode="second-factor" onReady={() => {}} />,
    );
    expect(html).toContain(">Email me a code<");
    expect(html).toContain("uses email codes for two-step sign-in");
    expect(html).not.toContain("has no password");
  });

  it("never offers a fresh sign-in in its place, which is no second factor", () => {
    const html = renderToStaticMarkup(
      <EmailStepUp
        mode="second-factor"
        emailConfigured={false}
        onReady={() => {}}
      />,
    );
    expect(html).not.toContain(">Sign in again<");
  });

  it("keeps the no-password wording by default", () => {
    expect(view()).toContain("has no password");
    expect(view({ mode: "second-factor" })).not.toContain("has no password");
  });
});

describe("EmailStepUpView", () => {
  it("asks for the 6-digit code once it is sent, naming the masked address", () => {
    const html = view({ phase: "sent", maskedEmail: "oa***@example.com" });
    expect(html).toContain("oa***@example.com");
    expect(html).toMatch(/<input[^>]*id="t-code"/);
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain(">Confirm<");
    expect(html).toContain(">Send a new code<");
  });

  it("holds Confirm until six digits are typed", () => {
    expect(view({ phase: "sent", code: "123" })).toMatch(
      /<button[^>]*disabled=""[^>]*>Confirm<\/button>/,
    );
    expect(view({ phase: "sent", code: "123456" })).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Confirm<\/button>/,
    );
  });

  it("points the code input at a refusal", () => {
    const html = view({
      phase: "sent",
      code: "000000",
      error: "That code did not match.",
    });
    expect(html).toMatch(/aria-invalid="true"/);
    expect(html).toMatch(/aria-describedby="t-error"/);
    expect(html).toContain('id="t-error"');
    expect(html).toContain("That code did not match.");
  });

  it("says it is done, and for how long", () => {
    const html = view({ phase: "done" });
    expect(html).toContain("Confirmed. You have 10 minutes to finish.");
    expect(html).not.toContain("<input");
  });

  it("keeps every control a plain button, so it never submits the dialog around it", () => {
    for (const phase of ["start", "sent", "sign-in"] as const) {
      const html = view({ phase });
      expect(html).not.toMatch(/<button(?![^>]*type="button")[^>]*>/);
    }
  });
});

describe("requestStepUpCode", () => {
  it("posts purpose reauth to the email-send route and returns the masked address", async () => {
    const calls = stubFetch(200, { maskedEmail: "oa***@example.com" });
    expect(await requestStepUpCode()).toEqual({
      ok: true,
      maskedEmail: "oa***@example.com",
    });
    expect(calls[0].url).toBe(API.AUTH.TWO_FA.EMAIL_SEND);
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      purpose: "reauth",
    });
  });

  it("carries the server's word that it cannot send mail", async () => {
    stubFetch(409, { error: "Sign in again.", emailConfigured: false });
    expect(await requestStepUpCode()).toEqual({
      ok: false,
      error: "Sign in again.",
      emailConfigured: false,
    });
  });

  it("has a sentence for a refusal without one and for no network", async () => {
    stubFetch(429, {});
    const refused = await requestStepUpCode();
    expect(refused.ok).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await requestStepUpCode()).toEqual({
      ok: false,
      error:
        "We could not reach the server. Check your connection and try again.",
    });
  });
});

describe("confirmStepUpCode", () => {
  it("posts purpose reauth and the code to the verify route", async () => {
    const calls = stubFetch(200, { success: true });
    expect(await confirmStepUpCode("123456")).toBeNull();
    expect(calls[0].url).toBe(API.AUTH.TWO_FA.VERIFY);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      purpose: "reauth",
      code: "123456",
    });
  });

  it("returns the server's message on a refusal", async () => {
    stubFetch(400, { error: "That code did not match or has expired." });
    expect(await confirmStepUpCode("000000")).toBe(
      "That code did not match or has expired.",
    );
  });
});

describe("stepUpCanSave", () => {
  it("waits for the code where mail works, and lets the server judge where it does not", () => {
    expect(stepUpCanSave(true, false)).toBe(false);
    expect(stepUpCanSave(true, true)).toBe(true);
    expect(stepUpCanSave(false, false)).toBe(true);
  });
});

it("writes no em dash, en dash or middle dot into its copy", () => {
  expect(SOURCE).not.toMatch(/[—–·]/);
});
