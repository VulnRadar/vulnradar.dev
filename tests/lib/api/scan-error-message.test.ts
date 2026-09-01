import { describe, it, expect } from "vitest";
import {
  publicScanErrorMessage,
  GENERIC_SCAN_ERROR,
} from "@/lib/api/scan-error-message";

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
    expect(publicScanErrorMessage("connect ECONNREFUSED 10.0.0.5:5432")).toBe(
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
