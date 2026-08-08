/**
 * lib/scanner/protocols/https.ts is pure config/filtering logic (check-id
 * lists and a filter function) — no network I/O, no boundary to mock.
 */
import { describe, it, expect } from "vitest";
import {
  filterHttpsChecks,
  isHttpsCheck,
  HTTPS_CHECK_IDS,
  HTTPS_ONLY_CHECK_IDS,
  HTTPS_CATEGORIES,
} from "@/lib/scanner/protocols/https";

describe("isHttpsCheck", () => {
  it("recognizes every declared HTTPS/HTTP check id", () => {
    for (const id of HTTPS_CHECK_IDS) {
      expect(isHttpsCheck(id)).toBe(true);
    }
  });

  it("rejects a check id belonging to another protocol", () => {
    expect(isHttpsCheck("ftp-anonymous-access")).toBe(false);
    expect(isHttpsCheck("not-a-real-check")).toBe(false);
  });
});

describe("filterHttpsChecks", () => {
  it("drops check ids that are not HTTPS/HTTP checks at all", () => {
    const filtered = filterHttpsChecks(
      ["hsts-missing", "ftp-anonymous-access", "not-a-check"],
      true,
    );
    expect(filtered).toEqual(["hsts-missing"]);
  });

  it("keeps HTTPS-only checks when isSecure is true", () => {
    const filtered = filterHttpsChecks(HTTPS_ONLY_CHECK_IDS, true);
    expect(filtered).toEqual(HTTPS_ONLY_CHECK_IDS);
  });

  it("strips every HTTPS-only check when isSecure is false", () => {
    const filtered = filterHttpsChecks(HTTPS_ONLY_CHECK_IDS, false);
    expect(filtered).toEqual([]);
  });

  it("keeps a check that is not HTTPS-only regardless of isSecure", () => {
    expect(filterHttpsChecks(["csp-missing"], true)).toEqual(["csp-missing"]);
    expect(filterHttpsChecks(["csp-missing"], false)).toEqual(["csp-missing"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(filterHttpsChecks([], true)).toEqual([]);
  });

  it("mixed input over HTTP keeps non-HTTPS-only checks and drops HTTPS-only ones", () => {
    const filtered = filterHttpsChecks(
      ["hsts-missing", "cookie-httponly-missing", "csp-missing"],
      false,
    );
    expect(filtered).toEqual(["cookie-httponly-missing", "csp-missing"]);
  });
});

describe("HTTPS_CATEGORIES / check-id list sanity", () => {
  it("every HTTPS_ONLY_CHECK_IDS entry is itself a member of HTTPS_CHECK_IDS", () => {
    for (const id of HTTPS_ONLY_CHECK_IDS) {
      expect(HTTPS_CHECK_IDS).toContain(id);
    }
  });

  it("declares the expected category set", () => {
    expect(HTTPS_CATEGORIES).toContain("headers");
    expect(HTTPS_CATEGORIES).toContain("ssl");
    expect(HTTPS_CATEGORIES).toContain("cookies");
  });
});
