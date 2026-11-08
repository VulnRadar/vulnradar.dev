// @vitest-environment jsdom
/**
 * A team invite or an emailed scan link sends a new person through signup, and
 * the only thing that gets them back to it afterwards is a target carried
 * across a verification email opened from their inbox. The cookie that holds
 * it is client-writable, so what comes back out is judged again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { submitForm } from "../../_helpers/dom";

vi.mock("@/lib/hooks/use-oauth-providers", () => ({
  useOAuthProviders: () => ({}),
}));
vi.mock("@/components/shared/turnstile-widget", () => ({
  TurnstileWidget: () => null,
}));

import {
  readPostVerifyRedirect,
  rememberPostVerifyRedirect,
  withRedirect,
} from "@/components/auth/redirect-target";
import { SignupForm } from "@/components/auth/signup-form";
import { SignupSuccess } from "@/components/auth/signup-success";
import { VerifyEmailSuccess } from "@/components/auth/verify-email-success";

function at(pathname: string): void {
  window.history.pushState({}, "", pathname);
}

function plant(value: string): void {
  at("/verify-email");
  document.cookie = `post_verify_redirect=${value}; Path=/verify-email`;
}

function clearCookie(): void {
  document.cookie = "post_verify_redirect=; Max-Age=0; Path=/verify-email";
}

afterEach(() => {
  clearCookie();
  at("/");
  vi.unstubAllGlobals();
});

describe("withRedirect", () => {
  it("adds a checked path to a bare link", () => {
    expect(withRedirect("/signup", "/history?scan=abc")).toBe(
      "/signup?redirect=%2Fhistory%3Fscan%3Dabc",
    );
  });

  it("joins an href that already has a query", () => {
    expect(withRedirect("/start?intent=login", "/teams")).toBe(
      "/start?intent=login&redirect=%2Fteams",
    );
  });

  it.each([
    ["nothing", undefined],
    ["the default landing page", "/dashboard"],
    ["a protocol-relative URL", "//evil.example"],
  ])("leaves the link alone for %s", (_label, value) => {
    expect(withRedirect("/signup", value)).toBe("/signup");
  });
});

describe("the post-verify cookie", () => {
  it("round-trips a path, scoped to the verify page", () => {
    at("/signup");
    rememberPostVerifyRedirect("/history?scan=abc");
    // Path-scoped, so it is invisible anywhere but the page that reads it.
    expect(readPostVerifyRedirect("/dashboard")).toBe("/dashboard");
    at("/verify-email?token=x");
    expect(readPostVerifyRedirect("/dashboard")).toBe("/history?scan=abc");
  });

  it("refuses to store a hostile target", () => {
    at("/verify-email");
    rememberPostVerifyRedirect("//evil.example");
    expect(document.cookie).not.toContain("post_verify_redirect");
  });

  it("clears an older signup's target", () => {
    at("/verify-email");
    rememberPostVerifyRedirect("/teams");
    rememberPostVerifyRedirect("");
    expect(document.cookie).not.toContain("post_verify_redirect");
  });

  it.each([
    ["a protocol-relative URL", encodeURIComponent("//evil.example")],
    ["an absolute URL", encodeURIComponent("https://evil.example")],
    ["a tab inside a double slash", encodeURIComponent("/\t/evil.example")],
    ["broken percent-encoding", "100%"],
  ])("falls back when the cookie holds %s", (_label, value) => {
    plant(value);
    expect(readPostVerifyRedirect("/dashboard")).toBe("/dashboard");
  });
});

describe("VerifyEmailSuccess button", () => {
  const button = () =>
    screen.getByRole("link", {
      name: /dashboard|left off/i,
    }) as HTMLAnchorElement;

  it("goes to the dashboard with nothing stored", () => {
    render(<VerifyEmailSuccess message="Done." />);
    expect(button().getAttribute("href")).toBe("/dashboard");
    expect(button().textContent).toBe("Go to the dashboard");
  });

  it("goes to the stored path", () => {
    plant(encodeURIComponent("/history?scan=abc"));
    render(<VerifyEmailSuccess message="Done." />);
    expect(button().getAttribute("href")).toBe("/history?scan=abc");
    expect(button().textContent).toBe("Continue where you left off");
  });

  it("ignores a hostile stored target", () => {
    plant(encodeURIComponent("//evil.example"));
    render(<VerifyEmailSuccess message="Done." />);
    expect(button().getAttribute("href")).toBe("/dashboard");
  });
});

describe("SignupForm", () => {
  const STRONG = "correct-Horse-battery-9-staple";

  function fill(label: RegExp, value: string): void {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it("links sign-in with the target and stores it on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    at("/signup");
    const onSuccess = vi.fn();
    const { container } = render(
      <SignupForm onSuccess={onSuccess} redirectTo="/history?scan=abc" />,
    );
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/login?redirect=%2Fhistory%3Fscan%3Dabc");

    fill(/your name/i, "Ada");
    fill(/^email/i, "ada@example.com");
    fill(/^password/i, STRONG);
    fill(/retype password/i, STRONG);
    submitForm(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    at("/verify-email?token=x");
    expect(readPostVerifyRedirect("/dashboard")).toBe("/history?scan=abc");
  });
});

describe("SignupSuccess", () => {
  it("keeps the target on its way back to sign-in", () => {
    render(<SignupSuccess email="a@example.com" redirectTo="/teams/join" />);
    expect(
      screen
        .getByRole("link", { name: "Back to sign in" })
        .getAttribute("href"),
    ).toBe("/login?redirect=%2Fteams%2Fjoin");
  });
});
