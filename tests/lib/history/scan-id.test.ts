import { afterEach, describe, it, expect, vi } from "vitest";
import { API } from "@/lib/config/client-constants";
import {
  historyItemPath,
  parseScanId,
  type ScanHistoryRoute,
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

  // Each route comes from its own API entry, never from text appended to the
  // scan's path: the entries do not share one prefix once the API moves.
  it.each<[ScanHistoryRoute, (id: string) => string]>([
    ["item", API.HISTORY_ITEM],
    ["share", API.HISTORY_SHARE],
    ["summary", API.HISTORY_SUMMARY],
    ["delete", API.HISTORY_DELETE],
  ])("builds the %s route from its API entry", (route, entry) => {
    expect(historyItemPath(id, route)).toBe(entry(id));
  });

  it("defaults to the scan itself", () => {
    expect(historyItemPath(id)).toBe(API.HISTORY_ITEM(id));
  });

  // Every entry sits under the scan's own path today, so a suffix appended to
  // HISTORY_ITEM gives the same strings as the entries and the cases above
  // cannot tell the two apart. Entries that share no prefix can.
  describe("when the entries no longer share the scan's prefix", () => {
    afterEach(() => {
      vi.doUnmock("@/lib/config/client-constants");
      vi.resetModules();
    });

    it("still reaches each route through its own entry", async () => {
      vi.resetModules();
      vi.doMock("@/lib/config/client-constants", () => ({
        API: {
          HISTORY_ITEM: (v: string) => `/api/v4/history/${v}`,
          HISTORY_SHARE: (v: string) => `/api/internal/shares/${v}`,
          HISTORY_SUMMARY: (v: string) => `/api/v4/summaries/${v}`,
          HISTORY_DELETE: (v: string) => `/api/internal/deletions/${v}`,
        },
      }));
      const split = (await import("@/lib/history/scan-id")).historyItemPath;
      expect(split(id)).toBe(`/api/v4/history/${id}`);
      expect(split(id, "share")).toBe(`/api/internal/shares/${id}`);
      expect(split(id, "summary")).toBe(`/api/v4/summaries/${id}`);
      expect(split(id, "delete")).toBe(`/api/internal/deletions/${id}`);
    });
  });

  it("encodes the id, so a slash in a value that skipped validation stays inside one segment", () => {
    const forged = "../keys/5/revoke?" as ScanId;
    const [prefix, rest] = API.HISTORY_SHARE("ID").split("ID");
    const path = resolve(historyItemPath(forged, "share"));
    expect(path.startsWith(prefix)).toBe(true);
    expect(path.endsWith(rest)).toBe(true);
    expect(path.slice(prefix.length, path.length - rest.length)).not.toContain(
      "/",
    );
  });
});
