// @vitest-environment jsdom
/**
 * Both sign-in forms `router.push` the target they are given once the
 * credentials are accepted. The page checks `?redirect=` before handing it
 * over, but the forms are where the navigation happens and neither of them
 * looked at what it was pushing, so the safety of a freshly signed-in victim
 * rested on every caller remembering. Each form is driven here through a real
 * submit, and what reached the router is what is asserted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { submitForm } from "../../_helpers/dom";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("@/components/providers/auth-provider", () => ({
  refreshAuthCache: vi.fn(),
}));
vi.mock("@/lib/hooks/use-oauth-providers", () => ({
  useOAuthProviders: () => ({}),
}));
vi.mock("@/lib/hooks/use-staff-oidc", () => ({
  useStaffOidcConfigured: () => false,
}));

import { LoginForm } from "@/components/auth/login-form";
import { Login2FAForm } from "@/components/auth/login-2fa-form";

/** What `?redirect=` holds once URLSearchParams has decoded the link. */
const fromLink = (raw: string): string =>
  new URLSearchParams(`redirect=${raw}`).get("redirect") as string;

const HOSTILE: [string, string][] = [
  ["an encoded tab inside a double slash", fromLink("/%09/evil.example")],
  ["a protocol-relative URL", "//evil.example"],
  ["an absolute URL", "https://evil.example"],
];

const forms: [string, (redirectTo: string) => React.ReactElement][] = [
  [
    "LoginForm",
    (redirectTo) => (
      <LoginForm redirectTo={redirectTo} onRequires2FA={vi.fn()} />
    ),
  ],
  [
    "Login2FAForm",
    (redirectTo) => (
      <Login2FAForm redirectTo={redirectTo} userId={7} method="app" />
    ),
  ],
];

describe.each(forms)("%s post-sign-in push", (_name, element) => {
  beforeEach(() => {
    push.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
  });

  async function pushedFor(redirectTo: string): Promise<string> {
    const { container } = render(element(redirectTo));
    submitForm(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    return push.mock.calls[0][0] as string;
  }

  it.each(HOSTILE)("sends %s to the dashboard", async (_label, value) => {
    await expect(pushedFor(value)).resolves.toBe("/dashboard");
  });

  it("passes a path on this site through", async () => {
    await expect(pushedFor("/history?scan=abc")).resolves.toBe(
      "/history?scan=abc",
    );
  });
});
