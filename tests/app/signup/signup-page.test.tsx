/**
 * /signup printed `?message=` in its error alert the same way /login did, and
 * decoded it a second time, so `message=100%25` threw. It also dropped
 * `?redirect=`, which left an invitee with no way back to the invitation once
 * the account existed. The form is a stub that prints what the page hands it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
}));

vi.mock("@/components/auth/signup-form", () => ({
  SignupForm: ({
    initialError,
    redirectTo,
  }: {
    initialError?: string;
    redirectTo?: string;
  }) =>
    React.createElement("output", {
      "data-error": initialError,
      "data-redirect": redirectTo,
    }),
}));

vi.mock("@/components/auth/signup-success", () => ({
  SignupSuccess: () => null,
}));

vi.mock("@/components/auth/auth-split-layout", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement("main", null, children),
}));

vi.mock("@/components/auth/auth-shell", () => ({
  AuthHeading: () => null,
  AuthSteps: () => null,
}));

const { default: SignupPage } = await import("@/app/signup/page");

function attr(name: string, query: string): string {
  search = new URLSearchParams(query);
  const html = renderToStaticMarkup(React.createElement(SignupPage));
  const match = html.match(new RegExp(`data-${name}="([^"]*)"`));
  return match ? match[1].replace(/&amp;/g, "&") : "";
}

const FIXED =
  "You already have an account connected to that sign-in. Sign in instead.";

describe("/signup ?error= copy", () => {
  beforeEach(() => {
    search = new URLSearchParams();
  });

  it("shows the fixed sentence, never the link's own text", () => {
    const shown = attr(
      "error",
      "error=oauth_already_exists&message=Call%20555",
    );
    expect(shown).toBe(FIXED);
    expect(shown).not.toContain("555");
  });

  it("survives a message that is not valid percent-encoding", () => {
    expect(attr("error", "error=oauth_already_exists&message=100%25")).toBe(
      FIXED,
    );
  });

  it("names the provider only from the fixed list", () => {
    expect(attr("error", "error=oauth_already_exists&provider=google")).toBe(
      "A VulnRadar account already uses this Google account. Sign in with Google instead.",
    );
    expect(attr("error", "error=oauth_already_exists&provider=evil")).toBe(
      FIXED,
    );
  });

  it("explains a signup pause without repeating the link's text", () => {
    expect(attr("error", "error=signups_paused&message=Call%20555")).toBe(
      "Sign-ups are paused on this instance right now. Try again later.",
    );
  });

  it.each(["constructor", "__proto__", "made_up"])(
    "shows nothing for the unknown code %s",
    (code) => {
      expect(attr("error", `error=${code}&message=Call%20555`)).toBe("");
    },
  );
});

describe("/signup ?redirect=", () => {
  it("hands a path on this site to the form", () => {
    expect(attr("redirect", "redirect=%2Fhistory%3Fscan%3Dabc")).toBe(
      "/history?scan=abc",
    );
  });

  it.each([
    ["a tab", "%2F%09%2Fevil.example"],
    ["a protocol-relative URL", "%2F%2Fevil.example"],
    ["an absolute URL", "https%3A%2F%2Fevil.example"],
  ])("drops %s", (_label, raw) => {
    expect(attr("redirect", `redirect=${raw}`)).toBe("");
  });
});
