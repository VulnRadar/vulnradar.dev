/**
 * Which failure screen a scan_history.failure_kind gets
 * (components/scanner/scan-failure.ts).
 *
 * The status route started naming why a scan ended `failed`, and the dashboard
 * used to ignore it and guess from the sentence: a scan the user cancelled and
 * one that ran out of time both became "The scan did not finish". The mapping
 * is a Record over FAILURE_KINDS, so the build already fails when a kind has no
 * entry; what these pin is that every entry lands on a screen that exists, and
 * that the ones with a wrong-direction risk go the right way.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FAILURE_KINDS } from "@/lib/scanner/failure-kinds";
import { errorKindForFailure } from "@/components/scanner/scan-failure";

const ERROR_STATE = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../components/scanner/dashboard-error-state.tsx",
  ),
  "utf8",
);

describe("errorKindForFailure", () => {
  it("gives every failure kind a screen that exists", () => {
    for (const failureKind of FAILURE_KINDS) {
      const screen = errorKindForFailure(failureKind);
      expect(screen, `${failureKind} has no screen`).toBeDefined();
      expect(
        ERROR_STATE,
        `${failureKind} maps to ${screen}, which ERROR_META lacks`,
      ).toContain(`\n  ${screen}: {`);
    }
  });

  it("does not call a cancel a failure", () => {
    expect(errorKindForFailure("cancelled")).toBe("cancelled");
    expect(errorKindForFailure("admin_cancelled")).toBe("cancelled");
  });

  it("tells a timeout from a crash", () => {
    expect(errorKindForFailure("timeout")).toBe("timeout");
    expect(errorKindForFailure("internal")).toBe("server");
    expect(errorKindForFailure("interrupted")).toBe("server");
    expect(errorKindForFailure("stale")).toBe("server");
  });

  it("sends a quota refusal to the limit screen and a blocked target to the blocked one", () => {
    expect(errorKindForFailure("quota_refused")).toBe("rate_limit");
    expect(errorKindForFailure("target_blocked")).toBe("blocked");
  });

  it("leaves causes without a screen of their own to the screen that points at the message", () => {
    expect(errorKindForFailure("target_tls")).toBe("generic");
    expect(errorKindForFailure("target_redirect_offhost")).toBe("generic");
    expect(errorKindForFailure("not_run")).toBe("generic");
  });

  it("returns undefined for a missing or unknown kind so the caller can classify the message", () => {
    // A deployment that predates the field sends nothing; a newer one may send
    // a kind this build has never heard of. Neither may break the screen.
    for (const value of [undefined, null, "", "teapot", 3, {}]) {
      expect(errorKindForFailure(value)).toBeUndefined();
    }
  });
});
