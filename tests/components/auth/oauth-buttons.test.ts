/**
 * A provider button is a full-page navigation to the start route, so anything
 * that should survive the round trip has to be on that URL. Without
 * `&redirect=` every Google, GitHub or Discord sign-in landed on the dashboard
 * no matter which invitation or report sent the person to /login.
 *
 * OAuthButtons holds no state, so it can be called as a function and the real
 * click handler taken off the element it returns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type React from "react";

vi.mock("@/lib/hooks/use-oauth-providers", () => ({
  useOAuthProviders: () => ({ github: true }),
}));

import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { API } from "@/lib/config/client-constants";

type ButtonElement = React.ReactElement<{ onStart: (id: string) => void }>;

function startHref(redirectTo?: string): string {
  const location = { href: "" };
  vi.stubGlobal("window", { location });
  const tree = OAuthButtons({
    actionLabel: "Sign in",
    intent: "login",
    redirectTo,
  }) as React.ReactElement<{ children: React.ReactNode[] }>;
  const button = tree.props.children.find(
    (child) => (child as ButtonElement | null)?.props?.onStart,
  ) as ButtonElement;
  button.props.onStart("github");
  return location.href;
}

const BARE = `${API.AUTH.OAUTH_START("github")}?intent=login`;

describe("OAuthButtons start href", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("appends a path on this site", () => {
    expect(startHref("/history?scan=abc")).toBe(
      `${BARE}&redirect=%2Fhistory%3Fscan%3Dabc`,
    );
  });

  it.each([
    ["no target", undefined],
    ["the default landing page", "/dashboard"],
    ["a protocol-relative URL", "//evil.example"],
    ["an absolute URL", "https://evil.example"],
    ["a tab inside a double slash", "/\t/evil.example"],
  ])("adds nothing for %s", (_label, value) => {
    expect(startHref(value)).toBe(BARE);
  });
});
