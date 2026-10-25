import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  termsGateOpen,
  tourWanted,
} from "@/components/shared/tour/tour-gating";

/**
 * When the product tour may start. The terms gate was always one of the
 * things it waits for; the backup-code reminder is the other. Both are modals
 * mounted in the root layout that inert the page, and the tour draws above
 * them (z-90 and z-100 against z-50), so a tour that started anyway pointed at
 * controls a dialog had made unreachable.
 */

const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-06-01T00:00:00.000Z";

function account(
  over: Partial<Parameters<typeof tourWanted>[0] & object> = {},
) {
  return {
    userId: 7,
    tosAcceptedAt: NEW,
    termsUpdatedAt: OLD,
    backupCodesInvalid: false,
    onboardingCompleted: false,
    ...over,
  };
}

describe("termsGateOpen", () => {
  it("is open for an account that has never accepted", () => {
    expect(termsGateOpen({ tosAcceptedAt: null, termsUpdatedAt: OLD })).toBe(
      true,
    );
  });

  it("is open when the terms changed after the account accepted", () => {
    expect(termsGateOpen({ tosAcceptedAt: OLD, termsUpdatedAt: NEW })).toBe(
      true,
    );
  });

  it("is shut once the account accepted the current terms", () => {
    expect(termsGateOpen({ tosAcceptedAt: NEW, termsUpdatedAt: OLD })).toBe(
      false,
    );
  });

  it("is shut when the deployment has no terms date to compare", () => {
    expect(termsGateOpen({ tosAcceptedAt: OLD, termsUpdatedAt: null })).toBe(
      false,
    );
  });
});

describe("tourWanted", () => {
  it("is wanted for a signed-in account that has not seen the tour", () => {
    expect(tourWanted(account(), false)).toBe(true);
  });

  it("is wanted for an account that has, when this tab has one half finished", () => {
    expect(tourWanted(account({ onboardingCompleted: true }), true)).toBe(true);
  });

  it("is not wanted when the tour is done and nothing is half finished", () => {
    expect(tourWanted(account({ onboardingCompleted: true }), false)).toBe(
      false,
    );
  });

  it("is not wanted when signed out, even with a stale half-finished tour", () => {
    expect(tourWanted(null, true)).toBe(false);
    expect(tourWanted(undefined, true)).toBe(false);
    expect(tourWanted(account({ userId: 0 }), true)).toBe(false);
  });

  it("waits while the terms gate is up", () => {
    expect(tourWanted(account({ tosAcceptedAt: null }), false)).toBe(false);
    expect(
      tourWanted(account({ tosAcceptedAt: OLD, termsUpdatedAt: NEW }), true),
    ).toBe(false);
  });

  it("waits while the backup codes need rotating, and not for that alone", () => {
    expect(tourWanted(account({ backupCodesInvalid: true }), false)).toBe(
      false,
    );
    // A restarted tour (onboarding_completed reset, or a session left in this
    // tab) is held back by it too.
    expect(
      tourWanted(
        account({ backupCodesInvalid: true, onboardingCompleted: true }),
        true,
      ),
    ).toBe(false);
    // Rotating the codes flips the flag and lets it through.
    expect(tourWanted(account({ backupCodesInvalid: false }), false)).toBe(
      true,
    );
  });
});

describe("TourMount asks tourWanted", () => {
  it("decides from the shared gate and loads through the lazy hook", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../components/shared/tour/tour-mount.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("tourWanted(me, resumable)");
    expect(src).toContain("<LazyMount");
    // It used to carry its own copy of the terms comparison.
    expect(src).not.toContain("function termsGateOpen");
  });
});
