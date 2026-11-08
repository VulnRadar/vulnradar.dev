import { beforeEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * auth-shell.tsx carried a private useFocusOnMount that focused its heading
 * unconditionally. lib/hooks/use-focus-on-mount.ts is the shared one, and it
 * adds the rule that matters: focus is only taken when the control the person
 * was on has gone and left it on <body>, never from an element they moved to
 * themselves.
 *
 * The source-text assertions are for what a file imports. The hook's
 * behaviour is covered in tests/lib/hooks/use-focus-on-mount.test.ts.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

let search = new URLSearchParams();
const useFocusOnMount = vi.hoisted(() => vi.fn(() => ({ current: null })));

vi.mock("@/lib/hooks/use-focus-on-mount", () => ({ useFocusOnMount }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => search,
}));
vi.mock("@/components/auth/auth-split-layout", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement("main", null, children),
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

const { default: LoginPage } = await import("@/app/login/page");

function twoFactorStep(): string {
  search = new URLSearchParams("oauth_2fa=pending");
  return renderToStaticMarkup(React.createElement(LoginPage));
}

describe("auth-shell focus", () => {
  const src = code("components/auth/auth-shell.tsx");

  it("imports the shared hook and defines no local copy", () => {
    expect(src).toContain(
      'import { useFocusOnMount } from "@/lib/hooks/use-focus-on-mount";',
    );
    expect(src).not.toMatch(/function useFocusOnMount\b/);
  });

  it("no longer needs its own effect or ref", () => {
    expect(src).not.toMatch(/\buseEffect\b/);
    expect(src).not.toMatch(/\buseRef\b/);
  });

  it("AuthOutcome always focuses its heading", () => {
    expect(src).toMatch(/useFocusOnMount<HTMLHeadingElement>\(\)/);
  });
});

/**
 * The code input autofocuses, so a heading that also asks for focus on arrival
 * never gets it: the hook refuses because focus is already on a real element.
 * What a screen reader needs is the step's name, and it hears that from the
 * input it landed on.
 */
describe("login 2FA step focus", () => {
  beforeEach(() => useFocusOnMount.mockClear());

  function codeInput(html: string): string {
    const input = html.match(/<input[^>]*id="totp-code"[^>]*>/);
    if (!input) throw new Error("the code input did not render");
    return input[0];
  }

  it("describes the code input with the step heading", () => {
    const html = twoFactorStep();
    const named = codeInput(html).match(/aria-describedby="([^"]+)"/);
    expect(named).not.toBeNull();
    const heading = html.match(new RegExp(`<h1[^>]*id="${named![1]}"[^>]*>`));
    expect(heading).not.toBeNull();
    expect(html).toContain("Confirm it is you");
  });

  it("leaves focus on the code input", () => {
    expect(codeInput(twoFactorStep())).toContain("autofocus");
  });

  it("never asks to move focus to the heading", () => {
    twoFactorStep();
    expect(useFocusOnMount).not.toHaveBeenCalled();
  });
});
