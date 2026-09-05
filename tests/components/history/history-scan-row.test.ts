/**
 * The one rule this suite exists for: a scan that failed, or that was
 * abandoned before it finished, must never be treated in History as a clean
 * result.
 *
 * A scan_history row is inserted as 'pending' with summary '{}',
 * findings_count 0 and duration 0 BEFORE any work starts, and
 * components/history/history-scan-row.tsx derived its verdict from
 * `findings_count === 0` alone, so a dead scan drew a green shield and the
 * word "Clean". The list API has projected sh.status since the server half of
 * this fix shipped (see the comment above the SELECT in
 * app/api/v3/history/route.ts); nothing on the client read it.
 *
 * Asserted against scanRowState rather than rendered markup because that is
 * the whole decision: the row and the stats strip both branch on nothing else,
 * and the vitest config here compiles TypeScript but not JSX (no jsx runtime,
 * no jsdom), so a .tsx component cannot be imported into a suite at all.
 */
import { describe, it, expect } from "vitest";
import { scanRowState } from "@/components/history/history-types";

describe("scanRowState", () => {
  it("only calls a scan clean when it completed with nothing found", () => {
    expect(scanRowState({ status: "completed", findings_count: 0 })).toBe(
      "clean",
    );
    expect(scanRowState({ status: "completed", findings_count: 2 })).toBe(
      "findings",
    );
  });

  it("treats a row with no status at all as completed", () => {
    // Read-only surfaces (/host, the public-scans row) reuse ScanRecord with
    // their own column list, and every row predating the column has no status
    // either. Neither is a failed scan, so neither may lose its verdict.
    expect(scanRowState({ findings_count: 0 })).toBe("clean");
    expect(scanRowState({ findings_count: 4 })).toBe("findings");
  });

  it("never calls a failed scan clean, whatever its findings_count says", () => {
    expect(scanRowState({ status: "failed", findings_count: 0 })).toBe(
      "unfinished",
    );
    // finalizeScanFailure drops partialFindings, so a failed row's count is
    // normally 0 -- but a partial count must not promote it to a real result
    // either.
    expect(scanRowState({ status: "failed", findings_count: 5 })).toBe(
      "unfinished",
    );
  });

  it("never calls an abandoned or in-flight scan clean", () => {
    // "Abandoned" is exactly this state: a row left 'pending' because the user
    // navigated away, until the watchdog or the boot sweep fails it.
    expect(scanRowState({ status: "pending", findings_count: 0 })).toBe(
      "running",
    );
    expect(scanRowState({ status: "running", findings_count: 0 })).toBe(
      "running",
    );
  });

  it("treats an unrecognised status as completed rather than as a non-result", () => {
    // A status this client does not know is not evidence the scan died, and
    // failing the other way would blank out every row on a schema change.
    expect(scanRowState({ status: "queued", findings_count: 0 })).toBe("clean");
    expect(scanRowState({ status: "queued", findings_count: 1 })).toBe(
      "findings",
    );
  });
});
