/**
 * The social cards for a shared report and a host report, rendered for real
 * through next/og, not read as source.
 *
 * Production (v3.9.1) answers both with a Cloudflare 502 for every report that
 * has a summary. The cause is the severity row: each count went in as a
 * number, satori rejects a number child ("Expected <div> to have explicit
 * display: flex ... more than one child node"), and it throws while the body
 * streams, after next/og has already sent 200 and image/png. The origin then
 * drops the connection mid-response, which Cloudflare reports as 502. The fix
 * (84191900) passes String(count); nothing tested it, because tests could not
 * import a .tsx module until vitest.config.ts compiled JSX.
 *
 * The stream is consumed in full on purpose: the status and headers look fine
 * on the broken version, and only reading the body surfaces the failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImageResponse } from "next/og";
import { OG_LIVE_DATA_HEADERS } from "@/app/_og/cache";

const shareSummary = vi.hoisted(() => ({ value: null as unknown }));
const hostSummary = vi.hoisted(() => ({ value: null as unknown }));

// The host card's headline helper reaches lib/scanner/host-reputation, which
// imports the pool. Nothing here should touch a database.
vi.mock("@/lib/database/db", () => ({
  default: {
    query: () => {
      throw new Error("no database in this test");
    },
  },
}));
vi.mock("@/app/shared/[token]/share-summary", () => ({
  getShareSummary: async () => shareSummary.value,
}));
vi.mock("@/app/host/[hostname]/host-summary", () => ({
  getHostSummary: async () => hostSummary.value,
  decodeHostParam: (raw: string) => raw,
}));

/** Read the whole body and return its PNG width and height. */
async function renderedSize(res: Response): Promise<[number, number]> {
  const png = Buffer.from(await res.arrayBuffer());
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

// One, two and three digits, plus zero: the shapes a real report has.
const COUNTS = { critical: 0, high: 12, medium: 125, low: 3, info: 40 };

describe("shared report card", () => {
  beforeEach(() => {
    shareSummary.value = null;
  });

  it("renders a report with real severity counts", async () => {
    shareSummary.value = {
      hostname: "example.com",
      url: "https://example.com/",
      ...COUNTS,
      total: 180,
      scannedAt: new Date("2026-10-20T12:00:00Z"),
    };
    const { default: card } =
      await import("@/app/shared/[token]/opengraph-image");
    const res = await card({
      params: Promise.resolve({ token: "t".repeat(64) }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      OG_LIVE_DATA_HEADERS["cache-control"],
    );
    expect(await renderedSize(res)).toEqual([1200, 630]);
  }, 30_000);

  it("renders the generic card for a revoked or unknown link", async () => {
    const { default: card } =
      await import("@/app/shared/[token]/opengraph-image");
    const res = await card({
      params: Promise.resolve({ token: "0".repeat(64) }),
    });
    expect(await renderedSize(res)).toEqual([1200, 630]);
  }, 30_000);
});

describe("host report card", () => {
  beforeEach(() => {
    hostSummary.value = null;
  });

  it.each([7, null])(
    "renders a host with real severity counts and a risk score of %s",
    async (dangerScore) => {
      hostSummary.value = {
        host: "example.com",
        dangerScore,
        ...COUNTS,
        lastScannedAt: new Date("2026-10-20T12:00:00Z"),
      };
      const { default: card } =
        await import("@/app/host/[hostname]/opengraph-image");
      const res = await card({
        params: Promise.resolve({ hostname: "example.com" }),
      });
      expect(res.status).toBe(200);
      expect(await renderedSize(res)).toEqual([1200, 630]);
    },
    30_000,
  );

  it("renders the generic card for a host with no public scan", async () => {
    const { default: card } =
      await import("@/app/host/[hostname]/opengraph-image");
    const res = await card({
      params: Promise.resolve({ hostname: "never-scanned.example" }),
    });
    expect(await renderedSize(res)).toEqual([1200, 630]);
  }, 30_000);
});

describe("why the counts are strings", () => {
  // If this starts passing, satori accepts number children and the String()
  // in app/_og/card.tsx is no longer needed. Until then it is the whole fix.
  it("still fails the stream on a number child, after a 200 has been sent", async () => {
    const res = new ImageResponse(
      <div style={{ display: "flex" }}>
        <div style={{ fontSize: 28 }}>{12}</div>
      </div>,
      { width: 200, height: 100 },
    );
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow(/display/);
  }, 30_000);
});
