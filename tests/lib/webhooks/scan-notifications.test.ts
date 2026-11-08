/**
 * Tests for the shared scan notification tail
 * (lib/webhooks/scan-notifications.ts): the one block every scan path runs
 * once its result is persisted.
 *
 * Mocked at the boundaries only. The database is the mocked `pool.query`, so
 * the regression diff (lib/scanner/regression-alert.ts) runs for real against
 * whatever "previous scan" the mock hands back rather than being stubbed out
 * one layer above the thing under test. `deliverWebhook` is mocked because
 * the HTTP attempt, signing and retry policy inside it are covered by
 * tests/lib/webhooks/delivery.test.ts; what matters here is which events go
 * out, to which webhooks, carrying what.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

vi.mock("@/lib/email/email", () => ({
  scanCompleteEmail: (url: string) => ({ subject: `complete ${url}` }),
  criticalFindingsEmail: (url: string) => ({ subject: `critical ${url}` }),
}));

const mockDeliverWebhook = vi.fn();
vi.mock("@/lib/webhooks/delivery", () => ({
  deliverWebhook: (...args: unknown[]) => mockDeliverWebhook(...args),
}));

const {
  notifyScanComplete,
  buildScanCompletedBody,
  buildScanRegressedBody,
  SCAN_COMPLETED_EVENT,
  SCAN_REGRESSED_EVENT,
} = await import("@/lib/webhooks/scan-notifications");

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: "check-1--hash",
    title: "Critical issue",
    description: "d",
    severity: "critical",
    category: "configuration",
    evidence: "",
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
    ...overrides,
  } as never;
}

const SUMMARY = {
  critical: 1,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
  total: 1,
};

const EMPTY_SUMMARY = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
  total: 0,
};

/**
 * Routes queries by statement shape. `webhooks` is the registered webhook
 * set, `previousFindings` is what the last completed scan of the same target
 * found (the baseline the regression diff runs against).
 */
function installQueryMock(
  opts: {
    webhooks?: {
      id: number;
      url: string;
      type: string;
      secret: string | null;
    }[];
    previousFindings?: unknown[] | null;
    userEmail?: string | null;
  } = {},
) {
  const {
    webhooks = [],
    previousFindings = null,
    userEmail = "owner@example.com",
  } = opts;
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT email FROM users")) {
      return userEmail === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ email: userEmail }], rowCount: 1 };
    }
    if (sql.includes("FROM webhooks")) {
      return { rows: webhooks, rowCount: webhooks.length };
    }
    if (sql.includes("SELECT findings FROM scan_history")) {
      return previousFindings === null
        ? { rows: [] }
        : { rows: [{ findings: JSON.stringify(previousFindings) }] };
    }
    if (
      sql.includes("scan_finding_feedback") ||
      sql.includes("finding_remediation")
    ) {
      return { rows: [] };
    }
    return { rows: [], rowCount: 0 };
  });
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    userId: 42,
    scanId: 7,
    target: { kind: "url" as const, value: "https://example.com/" },
    summary: EMPTY_SUMMARY,
    findings: [],
    duration: 1423,
    scannedAt: "2026-03-10T15:30:00.000Z",
    ...overrides,
  } as Parameters<typeof notifyScanComplete>[0];
}

beforeEach(() => {
  mockQuery.mockReset();
  mockSendNotificationEmail.mockReset();
  mockDeliverWebhook.mockReset();
  mockDeliverWebhook.mockResolvedValue(undefined);
  installQueryMock();
});

describe("notifyScanComplete: delivery fan-out", () => {
  it("delivers scan.completed to every active webhook and sends the scan-complete email", async () => {
    installQueryMock({
      webhooks: [
        { id: 1, url: "https://hook.example/a", type: "generic", secret: "s1" },
        { id: 2, url: "https://hook.example/b", type: "discord", secret: null },
      ],
    });

    await notifyScanComplete(baseParams());

    expect(mockDeliverWebhook).toHaveBeenCalledTimes(2);
    for (const call of mockDeliverWebhook.mock.calls) {
      expect(call[1]).toBe(SCAN_COMPLETED_EVENT);
    }
    expect(mockDeliverWebhook.mock.calls[0][0]).toEqual({
      id: 1,
      userId: 42,
      url: "https://hook.example/a",
      type: "generic",
      secret: "s1",
    });
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ type: "scan_complete" }),
    );
  });

  it("suppresses only the routine email when silenceRoutineEmail is set, never the webhook", async () => {
    installQueryMock({
      webhooks: [
        { id: 1, url: "https://hook.example/a", type: "generic", secret: null },
      ],
    });

    await notifyScanComplete(baseParams({ silenceRoutineEmail: true }));

    expect(mockSendNotificationEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "scan_complete" }),
    );
    expect(mockDeliverWebhook).toHaveBeenCalledTimes(1);
  });
});

/**
 * Discord's /slack and /github endpoints sit under a Discord webhook's path,
 * so they were taken as Discord and sent an embed. /slack reads a Slack
 * payload and ignores embeds; /github reads a GitHub event. A row saved
 * before the detector knew this is still stored as discord, which is why
 * these go through the whole send path rather than the body builders alone.
 */
describe("notifyScanComplete: Discord's compatibility endpoints", () => {
  const SLACK_COMPAT = "https://discord.com/api/webhooks/1/x/slack";
  const GITHUB_COMPAT = "https://discord.com/api/v10/webhooks/1/x/github";

  async function bodiesFor(
    webhooks: { id: number; url: string; type: string }[],
  ): Promise<Map<string, Record<string, unknown>>> {
    installQueryMock({
      webhooks: webhooks.map((w) => ({ ...w, secret: null })),
    });
    await notifyScanComplete(baseParams());
    return new Map(
      mockDeliverWebhook.mock.calls.map((call) => [
        (call[0] as { url: string }).url,
        JSON.parse(call[2] as string) as Record<string, unknown>,
      ]),
    );
  }

  it("sends /slack a Slack payload with a text fallback, whether stored as discord or slack", async () => {
    const legacy = await bodiesFor([
      { id: 1, url: SLACK_COMPAT, type: "discord" },
    ]);
    mockDeliverWebhook.mockClear();
    const detected = await bodiesFor([
      { id: 1, url: SLACK_COMPAT, type: "slack" },
    ]);

    for (const body of [legacy.get(SLACK_COMPAT), detected.get(SLACK_COMPAT)]) {
      expect(body).not.toHaveProperty("embeds");
      expect(Array.isArray(body?.blocks)).toBe(true);
      // Discord's Slack endpoint renders `text` and attachments, not Block
      // Kit, so a blocks-only body arrives as an empty message.
      expect(typeof body?.text).toBe("string");
      expect(body?.text).toContain("Scan Complete");
      expect(body?.text).toContain("https://example.com/");
    }
  });

  it("sends /github the generic JSON body, since there is no GitHub format", async () => {
    const bodies = await bodiesFor([
      { id: 1, url: GITHUB_COMPAT, type: "discord" },
    ]);
    const body = bodies.get(GITHUB_COMPAT);
    expect(body).not.toHaveProperty("embeds");
    expect(body?.event).toBe(SCAN_COMPLETED_EVENT);
  });

  it("still sends an ordinary Discord webhook an embed", async () => {
    const url = "https://discord.com/api/webhooks/1/x";
    const bodies = await bodiesFor([{ id: 1, url, type: "discord" }]);
    expect(Array.isArray(bodies.get(url)?.embeds)).toBe(true);
  });

  it("does not treat a lookalike host's /slack path as Discord's", async () => {
    const lookalike = "https://discord.com.evil.example/api/webhooks/1/x/slack";
    const bodies = await bodiesFor([
      { id: 1, url: lookalike, type: "generic" },
      { id: 2, url: `${lookalike}/`, type: "discord" },
    ]);
    expect(bodies.get(lookalike)?.event).toBe(SCAN_COMPLETED_EVENT);
    // A type pinned on a host that is not Discord's is the caller's choice.
    expect(Array.isArray(bodies.get(`${lookalike}/`)?.embeds)).toBe(true);
  });

  it("gives the Slack regression alert the same text fallback", () => {
    const body = JSON.parse(
      buildScanRegressedBody("slack", baseParams(), {
        hasNewCriticalOrHigh: true,
        newFindings: [finding()],
        outstandingFindings: [],
      } as never),
    );
    expect(body.text).toContain("1 new critical or high finding");
    expect(body.text).toContain("https://example.com/");
  });

  // Discord posts the /slack endpoint's `text` as message content, where
  // @everyone and @here ping the whole channel, and a scanned URL's path can
  // carry either. The blocks are not posted there, so they keep the target
  // as it is.
  it("does not let a target in the text fallback ping the channel", async () => {
    const value = "https://social.test/@everyone/@here";
    const params = baseParams({ target: { kind: "url", value } });
    installQueryMock({
      webhooks: [{ id: 1, url: SLACK_COMPAT, type: "discord", secret: null }],
    });
    await notifyScanComplete(params);
    const completed = JSON.parse(mockDeliverWebhook.mock.calls[0][2] as string);
    const regressed = JSON.parse(
      buildScanRegressedBody("slack", params, {
        hasNewCriticalOrHigh: true,
        newFindings: [finding()],
        outstandingFindings: [],
      } as never),
    );

    for (const text of [completed.text, regressed.text] as string[]) {
      expect(text).not.toMatch(/@(?:everyone|here)/);
      expect(text.split(String.fromCharCode(0x200b)).join("")).toContain(value);
    }
    expect(JSON.stringify(completed.blocks)).toContain(value);
  });
});

describe("notifyScanComplete: a failed notification never fails the scan", () => {
  it("resolves when a webhook delivery throws", async () => {
    installQueryMock({
      webhooks: [
        { id: 1, url: "https://hook.example/a", type: "generic", secret: null },
      ],
    });
    mockDeliverWebhook.mockRejectedValue(new Error("receiver returned 500"));

    await expect(notifyScanComplete(baseParams())).resolves.toBeUndefined();
  });

  it("resolves when the email transport throws, and still delivers the webhook", async () => {
    installQueryMock({
      webhooks: [
        { id: 1, url: "https://hook.example/a", type: "generic", secret: null },
      ],
    });
    mockSendNotificationEmail.mockRejectedValue(new Error("SMTP timeout"));

    await expect(notifyScanComplete(baseParams())).resolves.toBeUndefined();
    expect(mockDeliverWebhook).toHaveBeenCalledTimes(1);
  });

  it("resolves when the webhook lookup itself throws", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM webhooks")) throw new Error("pool exhausted");
      if (sql.includes("SELECT email FROM users")) {
        return { rows: [{ email: "owner@example.com" }] };
      }
      return { rows: [] };
    });

    await expect(notifyScanComplete(baseParams())).resolves.toBeUndefined();
  });
});

describe("notifyScanComplete: scan.regressed", () => {
  it("fires after scan.completed when the diff turns up a new critical finding", async () => {
    installQueryMock({
      webhooks: [
        { id: 1, url: "https://hook.example/a", type: "generic", secret: null },
      ],
      previousFindings: [],
    });

    await notifyScanComplete(
      baseParams({ summary: SUMMARY, findings: [finding()] }),
    );

    const events = mockDeliverWebhook.mock.calls.map((c) => c[1]);
    expect(events).toEqual([SCAN_COMPLETED_EVENT, SCAN_REGRESSED_EVENT]);
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ type: "severity_alerts" }),
    );
  });

  it("does not fire when the same critical finding was already in the previous scan", async () => {
    installQueryMock({
      webhooks: [
        { id: 1, url: "https://hook.example/a", type: "generic", secret: null },
      ],
      previousFindings: [finding()],
    });

    await notifyScanComplete(
      baseParams({ summary: SUMMARY, findings: [finding()] }),
    );

    const events = mockDeliverWebhook.mock.calls.map((c) => c[1]);
    expect(events).toEqual([SCAN_COMPLETED_EVENT]);
    expect(mockSendNotificationEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "severity_alerts" }),
    );
  });

  it("carries the findings themselves, so a receiver can route without a second API call", async () => {
    const body = JSON.parse(
      buildScanRegressedBody(
        "generic",
        baseParams({ summary: SUMMARY, findings: [finding()] }),
        {
          hasNewCriticalOrHigh: true,
          newFindings: [finding()],
          outstandingFindings: [],
        },
      ),
    );

    expect(body.event).toBe(SCAN_REGRESSED_EVENT);
    expect(body.data.new_findings_count).toBe(1);
    expect(body.data.new_findings[0]).toEqual({
      id: "check-1--hash",
      title: "Critical issue",
      severity: "critical",
      category: "configuration",
    });
  });
});

describe("buildScanCompletedBody: reports what the path can actually report", () => {
  it("a URL target carries both the documented url key and the historical normalizedUrl alias", () => {
    const body = JSON.parse(buildScanCompletedBody("generic", baseParams()));

    expect(body.event).toBe(SCAN_COMPLETED_EVENT);
    expect(body.data.url).toBe("https://example.com/");
    expect(body.data.normalizedUrl).toBe("https://example.com/");
    expect(body.data).not.toHaveProperty("repository");
  });

  it("a repository target carries repository and never invents a url", () => {
    const body = JSON.parse(
      buildScanCompletedBody(
        "generic",
        baseParams({ target: { kind: "repository", value: "acme/widgets" } }),
      ),
    );

    expect(body.data.repository).toBe("acme/widgets");
    expect(body.data).not.toHaveProperty("url");
    expect(body.data).not.toHaveProperty("normalizedUrl");
  });

  it("an incomplete scan is reported as incomplete, not as a clean zero-finding scan", () => {
    const params = baseParams({
      summary: EMPTY_SUMMARY,
      findings: [],
      incomplete: ["dns", "tls"],
    });

    const generic = JSON.parse(buildScanCompletedBody("generic", params));
    expect(generic.data.findings_count).toBe(0);
    expect(generic.data.incomplete).toEqual(["dns", "tls"]);

    // The two rich formats have no `incomplete` key to read, so the fact has
    // to survive as visible text or a human sees "0 findings" and reads it as
    // clean.
    const discord = JSON.parse(buildScanCompletedBody("discord", params));
    const coverage = discord.embeds[0].fields.find(
      (f: { name: string }) => f.name === "Coverage",
    );
    expect(coverage.value).toContain("dns, tls");

    const slack = buildScanCompletedBody("slack", params);
    expect(slack).toContain("dns, tls");
  });

  it("omits the incomplete key entirely when every branch finished", () => {
    const body = JSON.parse(buildScanCompletedBody("generic", baseParams()));
    expect(body.data).not.toHaveProperty("incomplete");

    const discord = JSON.parse(buildScanCompletedBody("discord", baseParams()));
    expect(
      discord.embeds[0].fields.some(
        (f: { name: string }) => f.name === "Coverage",
      ),
    ).toBe(false);
  });

  it("labels a repository target as a repository in the Slack block, not as a URL", () => {
    const slack = buildScanCompletedBody(
      "slack",
      baseParams({ target: { kind: "repository", value: "acme/widgets" } }),
    );
    expect(slack).toContain("*Repository:* acme/widgets");
    expect(slack).not.toContain("*URL:*");
  });
});
