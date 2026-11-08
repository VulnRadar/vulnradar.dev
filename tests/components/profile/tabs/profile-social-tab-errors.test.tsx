// @vitest-environment jsdom
/**
 * The OAuth callbacks land on /profile?tab=social with an error code. The tab
 * used to print ?message= for any ?error=, so a link to the real profile page
 * could put a sentence in the product's voice in front of a signed-in user.
 * The URL may only ever pick one of the sentences below.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import "../../../_helpers/dom";

vi.mock("@/lib/hooks/use-oauth-providers", () => ({
  useOAuthProviders: () => ({}),
}));
vi.mock("@/components/providers/auth-provider", () => ({
  refreshAuthCache: vi.fn(),
}));

import { ProfileSocialTab } from "@/components/profile/tabs/profile-social-tab";
import type { ProfileTabProps } from "@/components/profile/types";

const setError = vi.fn();
const setSuccess = vi.fn();

const FALLBACK = "We could not complete that connection. Try again.";

function visit(query: string) {
  window.history.replaceState({}, "", `/profile?${query}`);
  const props = {
    user: null,
    loading: false,
    error: null,
    success: null,
    setError,
    setSuccess,
  } as unknown as ProfileTabProps;
  render(<ProfileSocialTab {...props} />);
}

describe("the Social tab's connection errors", () => {
  beforeEach(() => {
    setError.mockClear();
    setSuccess.mockClear();
  });

  it("shows only the fixed copy, whatever the link says", () => {
    visit("tab=social&error=x&message=Call%20555");

    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith(FALLBACK);
  });

  it("ignores ?message= on a code it does know", () => {
    visit("tab=social&error=oauth_already_linked&message=Call%20555");

    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError.mock.calls[0]?.[0]).toBe(
      "That account is already connected to a different VulnRadar account.",
    );
  });

  it.each([
    ["oauth_impersonation_blocked", /admin/i],
    ["discord_impersonation_blocked", /admin/i],
    ["oauth_already_linked", /different/i],
    ["discord_already_linked", /Discord account is already connected/i],
    ["oauth_creating_identity", /uses its email address/i],
    ["discord_creating_identity", /created with Discord/i],
    ["oauth_email_unverified", /verified email/i],
    ["oauth_session_expired", /sign in again/i],
  ])("has its own sentence for %s", (code, sentence) => {
    visit(`tab=social&error=${code}`);

    expect(setError.mock.calls[0]?.[0]).toMatch(sentence);
  });

  it("does not find a function on the map for a code chosen by the link", () => {
    visit("tab=social&error=constructor");

    expect(setError).toHaveBeenCalledWith(FALLBACK);
  });

  it("takes the code out of the URL so a refresh does not repeat it", () => {
    visit("tab=social&error=oauth_failed");

    expect(new URLSearchParams(window.location.search).has("error")).toBe(
      false,
    );
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "social",
    );
  });

  it("still reports a connected Google account", () => {
    visit("tab=social&google_connected=true");

    expect(setSuccess).toHaveBeenCalledWith("Google account connected.");
    expect(setError).not.toHaveBeenCalled();
  });
});
