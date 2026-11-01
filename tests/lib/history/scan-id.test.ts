import { describe, it, expect } from "vitest";
import { API } from "@/lib/config/client-constants";
import {
  historyItemPath,
  parseScanId,
  type ScanHistorySubPath,
  type ScanId,
} from "@/lib/history/scan-id";

/**
 * A scan id read from ?scan= (or handed to the actions menu) used to be
 * dropped straight into `${API.HISTORY}/${id}`. The browser resolves dot
 * segments before it sends a request, so /history?scan=..%2Fkeys%2F5%2Frevoke%3F
 * turned the page-load GET (and every owner action after it) into a request
 * for /api/v3/keys/5/revoke, carrying the victim's cookie and a genuine
 * same-origin Origin header that the CSRF check accepts.
 */

const ORIGIN = "https://vulnradar.test";
const PUBLIC_ID = "0123456789abcdef0123456789abcdef";

function resolve(path: string): string {
  return new URL(path, ORIGIN).pathname;
}

describe("the attack this closes", () => {
  it("a raw id with dot segments escapes /history on the old path shape", () => {
    const raw = decodeURIComponent("..%2Fkeys%2F5%2Frevoke%3F");
    expect(resolve(`${API.HISTORY}/${raw}/share`)).toMatch(
      /^\/api\/v\d+\/keys\/5\/revoke$/,
    );
  });

  it("parseScanId refuses that value", () => {
    expect(
      parseScanId(decodeURIComponent("..%2Fkeys%2F5%2Frevoke%3F")),
    ).toBeNull();
  });
});

describe("parseScanId", () => {
  it("accepts the 32-hex public_id the database issues", () => {
    expect(parseScanId(PUBLIC_ID)).toBe(PUBLIC_ID);
  });

  it("accepts the legacy numeric id, as a string or a number", () => {
    expect(parseScanId("456")).toBe("456");
    expect(parseScanId(456)).toBe("456");
  });

  it.each([
    null,
    undefined,
    "",
    ".",
    "..",
    "%2e%2e",
    ".%2e",
    "../keys",
    "..\\keys",
    "456/share",
    "456?x=1",
    "456#x",
    " 456",
    "456 ",
    "-1",
    "1.5",
    "1e3",
    "12345678901",
    PUBLIC_ID.toUpperCase(),
    `${PUBLIC_ID}0`,
    PUBLIC_ID.slice(1),
    `${PUBLIC_ID.slice(0, 31)}g`,
    1.5,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    {},
    [],
  ])("refuses %j", (raw) => {
    expect(parseScanId(raw)).toBeNull();
  });
});

describe("historyItemPath", () => {
  const id = PUBLIC_ID as ScanId;

  it.each<ScanHistorySubPath>([
    "",
    "/share",
    "/share/publicly-listed",
    "/summary",
    "/delete",
  ])("builds the %j sub-path under one history segment", (sub) => {
    expect(resolve(historyItemPath(id, sub))).toBe(
      `${API.HISTORY}/${PUBLIC_ID}${sub}`,
    );
  });

  it("encodes the id, so a slash in a value that skipped validation stays inside one segment", () => {
    const forged = "../keys/5/revoke?" as ScanId;
    const path = resolve(historyItemPath(forged, "/share"));
    expect(path.startsWith(`${API.HISTORY}/`)).toBe(true);
    expect(path.endsWith("/share")).toBe(true);
    expect(path.split("/").length).toBe(API.HISTORY.split("/").length + 2);
  });
});
