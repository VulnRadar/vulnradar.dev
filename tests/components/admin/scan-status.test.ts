import { describe, it, expect } from "vitest";
import { scanStatusPill } from "@/components/admin/scans/scan-status";
import {
  FAILURE_KINDS,
  FAILURE_KIND_LABELS,
} from "@/lib/scanner/failure-kinds";

describe("scanStatusPill", () => {
  it("names in-flight and finished scans", () => {
    expect(scanStatusPill({ status: "pending" })).toEqual({
      tone: "info",
      label: "Queued",
    });
    expect(scanStatusPill({ status: "running" })).toEqual({
      tone: "info",
      label: "Running",
    });
    expect(scanStatusPill({ status: "completed" })).toEqual({
      tone: "ok",
      label: "Completed",
    });
  });

  // The reason this exists: a failed scan has 0 findings exactly like a clean
  // one, and the user panel printed "0 findings" for both.
  it("separates an engine failure from a down target from a cancel", () => {
    expect(
      scanStatusPill({ status: "failed", failure_kind: "internal" }).tone,
    ).toBe("crit");
    expect(
      scanStatusPill({ status: "failed", failure_kind: "timeout" }).tone,
    ).toBe("crit");
    expect(
      scanStatusPill({ status: "failed", failure_kind: "target_tls" }).tone,
    ).toBe("warn");
    expect(
      scanStatusPill({ status: "failed", failure_kind: "cancelled" }).tone,
    ).toBe("neutral");
    expect(
      scanStatusPill({ status: "failed", failure_kind: "quota_refused" }).tone,
    ).toBe("neutral");
  });

  it("labels a failed scan with its reason", () => {
    for (const kind of FAILURE_KINDS) {
      expect(
        scanStatusPill({ status: "failed", failure_kind: kind }).label,
      ).toBe(FAILURE_KIND_LABELS[kind]);
    }
  });

  // A NULL kind is a row the backfill has not reached; undercounting real
  // failures is the worse mistake, so it reads as an engine failure.
  it("treats a failed scan with no recorded reason as an engine failure", () => {
    expect(scanStatusPill({ status: "failed", failure_kind: null })).toEqual({
      tone: "crit",
      label: "Failed",
    });
    expect(scanStatusPill({ status: "failed" })).toEqual({
      tone: "crit",
      label: "Failed",
    });
  });

  it("falls back to the raw status for one it does not know", () => {
    expect(scanStatusPill({ status: "archived" })).toEqual({
      tone: "neutral",
      label: "archived",
    });
  });
});
