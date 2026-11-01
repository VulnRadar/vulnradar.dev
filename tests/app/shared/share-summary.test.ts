/**
 * A global badge can resolve to a public scan someone else ran. That row's
 * stored summary is rewritten by its owner's false-positive marks, so reading
 * it published one stranger's verdicts as the site's numbers in the share
 * page's description and social card, while the page body (which the API
 * route recounts) showed the real findings. These pin the head and the card
 * to the same recount the route does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/database/db", () => ({ default: { query } }));

// The card is inspected by its props, not rendered: the rendering itself is
// covered by tests/app/_og/card-render.test.tsx.
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(
      public element: { props: Record<string, unknown> },
      public options: unknown,
    ) {}
  },
}));

const { getShareSummary } = await import("@/app/shared/[token]/share-summary");
const { generateMetadata } = await import("@/app/shared/[token]/layout");
const { default: OpengraphImage } =
  await import("@/app/shared/[token]/opengraph-image");

const TOKEN = "a".repeat(64);
const params = Promise.resolve({ token: TOKEN });

const findings = [
  { id: "a", severity: "critical" },
  { id: "b", severity: "high" },
  { id: "c", severity: "high" },
  { id: "d", severity: "low" },
];

// What the scanning account's false-positive marks leave on the row.
const clearedSummary = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 1,
  info: 0,
  total: 1,
};

function badgeRow(overrides: Record<string, unknown>) {
  return {
    url: "https://example.com/",
    summary: clearedSummary,
    findings,
    scanned_at: "2026-10-20T12:00:00Z",
    user_id: 7,
    badge_owner_id: 7,
    ...overrides,
  };
}

/** No snapshot share matches, then the badge lookup answers with `row`. */
function resolveBadgeTo(row: Record<string, unknown>) {
  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({ rows: [row] });
}

describe("getShareSummary for a global badge", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("recounts a foreign scan from its findings, not its stored summary", async () => {
    resolveBadgeTo(badgeRow({ user_id: 99, badge_owner_id: 7 }));
    const summary = await getShareSummary(TOKEN);
    expect(summary).toMatchObject({
      critical: 1,
      high: 2,
      medium: 0,
      low: 1,
      info: 0,
      total: 4,
    });
    const sql = String(query.mock.calls[1][0]);
    expect(sql).toContain("sh.findings");
    expect(sql).toContain("badge_owner_id");
  });

  it("keeps the badge owner's own stored summary", async () => {
    resolveBadgeTo(badgeRow({}));
    const summary = await getShareSummary(TOKEN);
    expect(summary).toMatchObject(clearedSummary);
  });

  it("keeps the stored summary on a per-scan share link", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com/",
          summary: clearedSummary,
          scanned_at: "2026-10-20T12:00:00Z",
        },
      ],
    });
    const summary = await getShareSummary(TOKEN);
    expect(summary).toMatchObject(clearedSummary);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("share page head and card for a foreign scan", () => {
  beforeEach(() => {
    query.mockReset();
    resolveBadgeTo(badgeRow({ user_id: 99, badge_owner_id: 7 }));
  });

  it("describes the recounted findings, not the stranger's verdicts", async () => {
    const metadata = await generateMetadata({ params });
    const description = String(metadata.description);
    expect(description).toContain("1 critical, 2 high findings on example.com");
    expect(description).not.toContain("No critical, high or medium");
    expect(String(metadata.openGraph?.description)).not.toContain(
      "No critical, high or medium",
    );
  });

  it("puts the recounted numbers on the social card", async () => {
    const card = (await OpengraphImage({ params })) as unknown as {
      element: { props: Record<string, unknown> };
    };
    expect(String(card.element.props.subline)).toMatch(/^4 findings/);
    const row = card.element.props.severities as Array<{
      label: string;
      count: number;
    }>;
    expect(Object.fromEntries(row.map((s) => [s.label, s.count]))).toEqual({
      Critical: 1,
      High: 2,
      Medium: 0,
      Low: 1,
      Info: 0,
    });
  });
});
