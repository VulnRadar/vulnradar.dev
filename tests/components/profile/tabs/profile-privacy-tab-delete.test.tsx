// @vitest-environment jsdom
/**
 * Deleting the account from the Privacy tab. A password account re-enters its
 * password. An account created through Google, GitHub or Discord has none,
 * and the route used to delete it on its session alone, so a stolen session
 * cookie could permanently destroy it. The route now asks such an account for
 * the code mailed to it (lib/auth/reauth.ts), and the dialog puts the mailed
 * step-up where the password field would be and holds the delete until it is
 * in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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
const { ProfilePrivacyTab } =
  await import("@/components/profile/tabs/profile-privacy-tab");

const mockFetch = vi.fn();

function reply(body: unknown, statusCode = 200) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "content-type": "application/json" },
  });
}

function renderTab(hasPassword: boolean) {
  render(
    <ProfilePrivacyTab
      user={{ userId: 7, email: "oa@example.com", name: null, hasPassword }}
      loading={false}
      error={null}
      success={null}
      setError={() => undefined}
      setSuccess={() => undefined}
      onTabChange={() => undefined}
      pendingChanges={{}}
      setPendingChanges={() => undefined}
      preloadedDataReqInfo={{ hasData: false, canDownloadNew: true }}
      preloadedScansPrivateByDefault={false}
      preloadedSharePubliclyListedByDefault={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Delete account/ }));
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
    target: { value: "DELETE" },
  });
}

function deleteButton() {
  return screen.getByRole("button", {
    name: "Permanently delete account",
  }) as HTMLButtonElement;
}

function accountCalls() {
  return mockFetch.mock.calls.filter(([url]) => url === API.ACCOUNT);
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  clientConfig.value = { emailConfigured: true };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the delete account dialog, for an account with no password", () => {
  it("asks for the mailed code, not a password, and holds the delete until it is in", () => {
    renderTab(false);

    expect(
      screen.getByRole("button", { name: "Email me a code" }),
    ).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(deleteButton().disabled).toBe(true);
  });

  it("deletes only after the code is confirmed, and sends no password", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === API.AUTH.TWO_FA.EMAIL_SEND) {
        return reply({ maskedEmail: "oa***@example.com" });
      }
      if (url === API.AUTH.TWO_FA.VERIFY) return reply({ success: true });
      return reply({ error: "Not this time." }, 500);
    });
    renderTab(false);

    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    fireEvent.change(await screen.findByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(deleteButton().disabled).toBe(false));

    fireEvent.click(deleteButton());
    await waitFor(() => expect(accountCalls()).toHaveLength(1));
    expect(JSON.parse(String(accountCalls()[0][1].body))).toEqual({});
  });

  it("offers a new code when the server says the confirmation ran out", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === API.AUTH.TWO_FA.EMAIL_SEND) return reply({});
      if (url === API.AUTH.TWO_FA.VERIFY) return reply({ success: true });
      return reply(
        {
          error: "Confirm it is you with a code from your email first.",
          stepUp: true,
        },
        403,
      );
    });
    renderTab(false);

    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    fireEvent.change(await screen.findByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(deleteButton().disabled).toBe(false));
    fireEvent.click(deleteButton());

    expect(
      await screen.findByText(
        "Confirm it is you with a code from your email first.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Email me a code" }),
    ).toBeTruthy();
    expect(deleteButton().disabled).toBe(true);
  });

  it("lets the server decide on a deployment that cannot send mail", () => {
    clientConfig.value = { emailConfigured: false };
    renderTab(false);

    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
    expect(deleteButton().disabled).toBe(false);
  });
});

describe("the delete account dialog, for an account with a password", () => {
  it("asks for the password and sends it", async () => {
    mockFetch.mockResolvedValue(
      reply({ error: "Password is incorrect." }, 400),
    );
    renderTab(true);

    expect(
      screen.queryByRole("button", { name: "Email me a code" }),
    ).toBeNull();
    expect(deleteButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: " pw with spaces " },
    });
    fireEvent.click(deleteButton());

    expect(await screen.findByText("Password is incorrect.")).toBeTruthy();
    expect(JSON.parse(String(accountCalls()[0][1].body))).toEqual({
      currentPassword: " pw with spaces ",
    });
  });
});
