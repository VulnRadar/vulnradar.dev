/**
 * /login hands `?redirect=` to the sign-in forms, which `router.push` it once
 * the password (or the second factor) is accepted. Next resolves that href
 * with `new URL(href, location.href)`, and WHATWG URL parsing deletes every
 * ASCII tab and newline before it looks at the path. The page's old check
 * only looked at the first two characters, so `/<TAB>/evil.com` passed it as
 * a path and arrived at the router as `//evil.com`: a cross-origin hop that
 * lands the victim, freshly signed in, on a page the attacker styled as
 * "session expired".
 *
 * The page needs no DOM to prove this: the forms are replaced with stubs that
 * print the redirect they were given, and that value is resolved the way the
 * router resolves it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ORIGIN = "https://vulnradar.example";
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => search,
}));

vi.mock("@/components/auth", () => ({
  LoginForm: ({ redirectTo }: { redirectTo: string }) =>
    React.createElement("output", { "data-redirect": redirectTo }),
  Login2FAForm: ({ redirectTo }: { redirectTo: string }) =>
    React.createElement("output", { "data-redirect": redirectTo }),
}));

vi.mock("@/components/auth/auth-split-layout", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement("main", null, children),
}));

vi.mock("@/components/auth/auth-shell", () => ({
  AuthHeading: () => null,
  AuthSteps: () => null,
}));

const { default: LoginPage } = await import("@/app/login/page");

function redirectFor(query: string): string {
  search = new URLSearchParams(query);
  const html = renderToStaticMarkup(React.createElement(LoginPage));
  const match = html.match(/data-redirect="([^"]*)"/);
  if (!match) throw new Error(`no form rendered for ?${query}`);
  return match[1].replace(/&amp;/g, "&");
}

/** Where `router.push(redirectTo)` would actually take the browser. */
function landing(redirectTo: string): URL {
  return new URL(redirectTo, `${ORIGIN}/login`);
}

describe("/login ?redirect=", () => {
  beforeEach(() => {
    search = new URLSearchParams();
  });

  it.each([
    ["a tab", "%2F%09%2Fevil.com"],
    ["a line feed", "%2F%0A%2Fevil.com"],
    ["a carriage return", "%2F%0D%2Fevil.com"],
    ["a slash then a backslash", "%2F%5Cevil.com"],
    ["a protocol-relative URL", "%2F%2Fevil.com"],
    ["a dot segment before a double slash", "%2F..%2F%2Fevil.com"],
    ["an absolute URL", "https%3A%2F%2Fevil.com"],
    ["a javascript: URL", "javascript%3Aalert(1)"],
  ])("never leaves the origin after sign-in, given %s", (_label, raw) => {
    const to = redirectFor(`redirect=${raw}`);
    expect(landing(to).origin).toBe(ORIGIN);
    expect(to).toBe("/dashboard");
  });

  it("keeps the 2FA step on the same check", () => {
    const to = redirectFor("redirect=%2F%09%2Fevil.com&oauth_2fa=pending");
    expect(landing(to).origin).toBe(ORIGIN);
    expect(to).toBe("/dashboard");
  });

  it("still sends a user back to the page they came from", () => {
    expect(redirectFor("redirect=%2Fhistory%3Fpage%3D2%23scan-9")).toBe(
      "/history?page=2#scan-9",
    );
  });

  it("falls back to the dashboard with no redirect", () => {
    expect(redirectFor("")).toBe("/dashboard");
  });
});
