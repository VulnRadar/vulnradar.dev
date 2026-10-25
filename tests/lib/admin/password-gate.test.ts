import { describe, it, expect } from "vitest";
import { isPasswordGatedAction } from "@/lib/admin/password-gate";
import { PASSWORD_GATED_ACTIONS } from "@/components/admin/config";

describe("isPasswordGatedAction", () => {
  it("keeps every action the shared set already gates", () => {
    for (const action of PASSWORD_GATED_ACTIONS) {
      expect(isPasswordGatedAction(action), action).toBe(true);
    }
  });

  // Removing credit is as capable of damage as granting it (zeroing a
  // customer's paid balance), so a hijacked session must not be able to do
  // either without the password.
  it("gates both directions of a credit balance change", () => {
    expect(isPasswordGatedAction("grant_credits")).toBe(true);
    expect(isPasswordGatedAction("adjust_credits")).toBe(true);
  });

  it("does not gate the harmless actions", () => {
    for (const action of ["add_note", "reset_daily_limit", "award_badge"]) {
      expect(isPasswordGatedAction(action), action).toBe(false);
    }
  });
});
