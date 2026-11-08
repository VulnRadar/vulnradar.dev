// @vitest-environment jsdom
/**
 * The second factor is a step on the same page, so `?redirect=` has to survive
 * both ways out of it: finishing the challenge, and "start over", which used
 * to be a push to a bare /login that threw the target away. The whole page is
 * rendered here with the real forms.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { submitForm } from "../../_helpers/dom";

const push = vi.hoisted(() => vi.fn());
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => search,
}));
vi.mock("@/components/auth/auth-split-layout", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
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

import LoginPage from "@/app/login/page";

const TARGET = "redirect=%2Fhistory%3Fscan%3Dabc";

function form(): HTMLFormElement {
  return document.querySelector("form") as HTMLFormElement;
}

describe("/login 2FA hop", () => {
  beforeEach(() => push.mockClear());

  it("lands on the target after a password login that needed 2FA", async () => {
    search = new URLSearchParams(TARGET);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ requires2FA: true, userId: 7 }),
        })
        .mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    render(<LoginPage />);
    submitForm(form());
    await screen.findByLabelText("6-digit code");
    submitForm(form());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/history?scan=abc"));
  });

  it("keeps the target when a third-party challenge starts over", () => {
    search = new URLSearchParams(`${TARGET}&oauth_2fa=pending`);
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Start over with a different account"));
    expect(push).toHaveBeenCalledWith(`/login?${TARGET}`);
  });

  it("starts over at a clean /login with no target", () => {
    search = new URLSearchParams("oauth_2fa=pending");
    render(<LoginPage />);
    fireEvent.click(screen.getByText("Start over with a different account"));
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("links signup with the target", () => {
    search = new URLSearchParams(TARGET);
    render(<LoginPage />);
    expect(
      screen.getByRole("link", { name: "Create one" }).getAttribute("href"),
    ).toBe(`/signup?${TARGET}`);
  });

  it("links a clean /signup with no target", () => {
    search = new URLSearchParams();
    render(<LoginPage />);
    expect(
      screen.getByRole("link", { name: "Create one" }).getAttribute("href"),
    ).toBe("/signup");
  });
});
