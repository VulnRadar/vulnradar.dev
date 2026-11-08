// @vitest-environment jsdom
/**
 * An invitee without an account used to be sent to a bare /signup and told to
 * dig the invitation out of their inbox again once they had verified. The link
 * carries the invitation now, the same way the sign-in button beside it does.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import "../../_helpers/dom";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("token=a%26b"),
}));
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me: null, isLoading: false }),
}));

import JoinTeamPage from "@/app/teams/join/page";

const BACK = encodeURIComponent("/teams/join?token=a%26b");

describe("/teams/join for someone signed out", () => {
  it.each([
    ["Sign in", "/login"],
    ["Create an account first", "/signup"],
  ])("%s carries the invitation", (name, path) => {
    render(<JoinTeamPage />);
    expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(
      `${path}?redirect=${BACK}`,
    );
  });

  it("no longer says the invitation has to be reopened from the email", () => {
    render(<JoinTeamPage />);
    expect(document.body.textContent).not.toContain(
      "invite link from your email",
    );
  });
});
