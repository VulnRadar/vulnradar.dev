// @vitest-environment jsdom
/**
 * Linking a sign-in provider adds a permanent way into the account. An
 * account with a password confirms it first (ProviderReauthDialog); one
 * without used to go straight to the provider on its session alone, so a
 * stolen session could attach the attacker's own Google, GitHub or Discord
 * and keep access after the owner signed out everywhere. The Social tab now
 * puts the mailed step-up in front of Link and Connect for such an account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("@/lib/hooks/use-oauth-providers", () => ({
  useOAuthProviders: () => ({}),
}));
vi.mock("@/components/providers/auth-provider", () => ({
  refreshAuthCache: vi.fn(),
  clearAuthCache: vi.fn(),
}));
const clientConfig = vi.hoisted(() => ({
  value: { emailConfigured: true } as Record<string, unknown>,
}));
vi.mock("@/lib/hooks/use-client-config", () => ({
  useClientConfig: () => clientConfig.value,
}));

const { API } = await import("@/lib/config/client-constants");
const { ProviderStepUpDialog } =
  await import("@/components/profile/tabs/profile-social-tab");

const START = "/api/v3/auth/oauth/google?action=link";
const mockFetch = vi.fn();

function reply(body: unknown, statusCode = 200) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "content-type": "application/json" },
  });
}

function continueButton() {
  return screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  clientConfig.value = { emailConfigured: true };
  // jsdom reports window.location assignment as "not implemented".
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProviderStepUpDialog", () => {
  it("asks for the mailed code, not a password, and holds Continue until it is in", () => {
    render(
      <ProviderStepUpDialog
        label="Google"
        startUrl={START}
        onClose={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Email me a code" }),
    ).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(continueButton().disabled).toBe(true);
  });

  it("goes to the provider only after the code is confirmed, and sends no password", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === API.AUTH.TWO_FA.EMAIL_SEND) {
        return reply({ maskedEmail: "oa***@example.com" });
      }
      if (url === API.AUTH.TWO_FA.VERIFY) return reply({ success: true });
      return reply({ url: "https://accounts.google.com/o/oauth2/auth?x=1" });
    });
    const onStarted = vi.fn();

    render(
      <ProviderStepUpDialog
        label="Google"
        startUrl={START}
        onStarted={onStarted}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    fireEvent.change(await screen.findByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    expect(continueButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(continueButton().disabled).toBe(false));

    fireEvent.click(continueButton());
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));

    const urls = mockFetch.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      API.AUTH.TWO_FA.EMAIL_SEND,
      API.AUTH.TWO_FA.VERIFY,
      START,
    ]);
    const start = mockFetch.mock.calls[2][1] as RequestInit;
    expect(JSON.parse(String(start.body))).toEqual({});
  });

  it("keeps the dialog open with the route's refusal", async () => {
    clientConfig.value = { emailConfigured: false };
    mockFetch.mockResolvedValueOnce(
      reply({ error: "Sign in again to confirm it is you." }, 403),
    );
    const onStarted = vi.fn();

    render(
      <ProviderStepUpDialog
        label="Discord"
        startUrl={START}
        onStarted={onStarted}
        onClose={() => undefined}
      />,
    );
    // No mail on this server: a fresh sign-in is the step-up, and only the
    // server knows whether this session is one.
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
    fireEvent.click(continueButton());

    expect(
      await screen.findByText("Sign in again to confirm it is you."),
    ).toBeTruthy();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
