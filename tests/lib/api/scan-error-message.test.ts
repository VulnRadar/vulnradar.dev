import { describe, it, expect } from "vitest";
import {
  publicScanErrorMessage,
  failureKindMessage,
  GENERIC_SCAN_ERROR,
} from "@/lib/api/scan-error-message";
import { FAILURE_KINDS } from "@/lib/scanner/failure-kinds";
import {
  API_KEY_LIMIT_MESSAGE,
  BULK_STOPPED_MESSAGE,
  DAILY_LIMIT_MESSAGE,
  SCAN_ADMIN_CANCELLED_MESSAGE,
  SCAN_STALE_MESSAGE,
  bulkDeadlineMessage,
} from "@/lib/scanner/failure-messages";

/**
 * The scan pipeline persists any thrown error's raw `.message` into
 * scan_history.error_message, and GET /api/v3/scan/status/[id] used to hand
 * that string straight to the browser. These tests pin the two halves of the
 * boundary: the reasons the pipeline writes deliberately still reach the
 * user, and anything carrying infrastructure detail never does.
 */
describe("publicScanErrorMessage", () => {
  it("passes through the fixed reasons the pipeline writes for the user", () => {
    for (const message of [
      "Cancelled",
      "Scan failed to start.",
      "An unexpected error occurred during the scan.",
      "An unexpected error occurred during the crawl scan.",
      "Scan interrupted by a server restart. Please run it again.",
      "Scan exceeded the 120s time limit.",
      "Crawl scan exceeded the 300s time limit.",
      SCAN_ADMIN_CANCELLED_MESSAGE,
      SCAN_STALE_MESSAGE,
      DAILY_LIMIT_MESSAGE,
      API_KEY_LIMIT_MESSAGE,
      BULK_STOPPED_MESSAGE,
      bulkDeadlineMessage(1800),
    ]) {
      expect(publicScanErrorMessage(message)).toBe(message);
    }
  });

  it("never leaks an internal host, IP, port or table name", () => {
    const leaky = [
      'relation "scan_tags" does not exist',
      "connect ECONNREFUSED 10.0.0.5:5432",
      "getaddrinfo ENOTFOUND vulnradar-db.internal",
      "Client has encountered a connection error and is not queryable",
      "column sh.foo does not exist at character 42",
    ];
    for (const message of leaky) {
      const out = publicScanErrorMessage(message);
      expect(out).not.toContain("scan_tags");
      expect(out).not.toContain("10.0.0.5");
      expect(out).not.toContain("5432");
      expect(out).not.toContain("vulnradar-db.internal");
      expect(out).not.toContain("sh.foo");
    }
  });

  it("classifies the common transport failures into fixed sentences", () => {
    expect(publicScanErrorMessage("getaddrinfo ENOTFOUND example.test")).toBe(
      "The target's hostname could not be resolved.",
    );
    expect(publicScanErrorMessage("connect ETIMEDOUT 203.0.113.7:443")).toBe(
      "The target did not respond in time.",
    );
    expect(publicScanErrorMessage("connect ECONNREFUSED 203.0.113.7:443")).toBe(
      "The target refused the connection or closed it early.",
    );
    expect(
      publicScanErrorMessage("unable to verify the first certificate"),
    ).toBe("The target's TLS certificate could not be validated.");
  });

  it("collapses anything unrecognised to the generic message", () => {
    expect(publicScanErrorMessage('relation "scan_tags" does not exist')).toBe(
      GENERIC_SCAN_ERROR,
    );
    expect(publicScanErrorMessage("Cannot read properties of undefined")).toBe(
      GENERIC_SCAN_ERROR,
    );
  });

  it("falls back to a plain failure line for a null or blank column", () => {
    expect(publicScanErrorMessage(null)).toBe("The scan failed.");
    expect(publicScanErrorMessage("   ")).toBe("The scan failed.");
  });
});

/**
 * A database fault that borrows the transport words. pg-pool says
 * "timeout exceeded when trying to connect" when its own pool runs dry, and a
 * refused connection to Postgres says ECONNREFUSED: both used to match the
 * target classifiers, so the person who ran the scan was told their site did
 * not respond when the platform's database was the thing that was struggling.
 */
describe("publicScanErrorMessage, database failures", () => {
  it.each([
    "timeout exceeded when trying to connect",
    "Connection terminated unexpectedly",
    "canceling statement due to statement timeout",
    "sorry, too many clients already",
    "deadlock detected",
    'duplicate key value violates unique constraint "scan_tags_pkey"',
    'relation "scan_tags" does not exist',
    "the database system is starting up",
  ])("is internal, not a target problem: %s", (message) => {
    expect(publicScanErrorMessage(message)).toBe(GENERIC_SCAN_ERROR);
  });

  it("still blames the target for a genuine target timeout", () => {
    expect(publicScanErrorMessage("connect ETIMEDOUT 203.0.113.7:443")).toBe(
      "The target did not respond in time.",
    );
  });
});

/**
 * The failure kind is recorded where the throw happens, which is the only
 * place the truth is known. Reading it first is what stops a target problem
 * from falling through to "an internal error" and a database problem from
 * being blamed on the target.
 */
describe("publicScanErrorMessage with a failure kind", () => {
  it("has a sentence for every kind there is", () => {
    for (const kind of FAILURE_KINDS) {
      const sentence = failureKindMessage(kind);
      expect(sentence.length).toBeGreaterThan(5);
      // Copy rule: no em dashes in anything a user reads.
      expect(sentence).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it.each([
    ["target_unreachable", /could not be reached/i],
    ["target_timeout", /did not respond in time/i],
    ["target_tls", /TLS certificate/i],
    ["target_redirect_offhost", /different host/i],
    ["target_blocked", /not allowed to reach/i],
    ["quota_refused", /limit was reached/i],
    ["not_run", /did not run/i],
    ["stale", /stopped responding/i],
    ["timeout", /time limit/i],
  ] as const)("answers a %s row with its own sentence", (kind, expected) => {
    // The stored text is raw operator detail and must not decide the answer.
    expect(publicScanErrorMessage("some raw driver text", kind)).toMatch(
      expected,
    );
  });

  it("never lets the raw text through for a kind it recognises", () => {
    const out = publicScanErrorMessage(
      "Redirect to a different host (internal.corp.example) is not allowed.",
      "target_redirect_offhost",
    );
    expect(out).not.toContain("internal.corp.example");
  });

  it("answers an internal row generically even when its text says ECONNREFUSED", () => {
    // The pg-pool case: a message that reads like a refused connection to the
    // target, recorded against the engine.
    expect(
      publicScanErrorMessage("connect ECONNREFUSED 10.0.0.5:5432", "internal"),
    ).toBe(GENERIC_SCAN_ERROR);
  });

  it("keeps the deliberate wording over the generic sentence for its kind", () => {
    // It is the same fact with the number still in it.
    expect(
      publicScanErrorMessage("Scan exceeded the 300s time limit.", "timeout"),
    ).toBe("Scan exceeded the 300s time limit.");
    expect(publicScanErrorMessage("Cancelled", "cancelled")).toBe("Cancelled");
    expect(publicScanErrorMessage(bulkDeadlineMessage(900), "not_run")).toBe(
      bulkDeadlineMessage(900),
    );
  });

  it("answers from the kind when the stored text is blank", () => {
    expect(publicScanErrorMessage(null, "target_timeout")).toBe(
      "The target did not respond in time.",
    );
  });

  it("treats an unknown or null kind as absent and falls back to the text", () => {
    expect(
      publicScanErrorMessage("connect ETIMEDOUT 203.0.113.7:443", null),
    ).toBe("The target did not respond in time.");
    expect(
      publicScanErrorMessage(
        "connect ETIMEDOUT 203.0.113.7:443",
        "a_kind_from_a_newer_build",
      ),
    ).toBe("The target did not respond in time.");
  });
});
