/**
 * Route-level tests for GET /api/v3/ai/context?cmd=legal (new /legal slash
 * command, lib/ai/commands.ts). The other cmd values (docs, changelog,
 * checks, history, me, finding, stats) already existed before this and are
 * not covered here -- this file only pins the new case's contract: auth
 * required, reads the real compiled knowledge file, and degrades to an
 * actionable message (not a crash) when that file is missing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockCanMakeRequest = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  canMakeRequest: (...args: unknown[]) => mockCanMakeRequest(...args),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

const { GET } = await import("@/app/api/v3/ai/context/route");
const { __resetKnowledgeCacheForTests } =
  await import("@/lib/ai/knowledge-files");

function getRequest(cmd: string) {
  return new NextRequest(
    `http://localhost/api/v3/ai/context?cmd=${encodeURIComponent(cmd)}`,
  );
}

beforeEach(() => {
  // The knowledge files are build artifacts, so the reader caches each one for
  // the life of the process (they used to be readFileSync'd on every request,
  // ~1MB synchronously per hit). Clear it between cases so each one exercises
  // its own present/missing fixture.
  __resetKnowledgeCacheForTests();
  mockGetSession.mockReset();
  mockQuery.mockReset();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockCanMakeRequest.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
  mockCanMakeRequest.mockResolvedValue({
    allowed: true,
    used: 3,
    limit: 25,
    remaining: 22,
    resetsAt: "2026-09-17T00:00:00.000Z",
  });
});

function getRequestWithId(cmd: string, id: string) {
  return new NextRequest(
    `http://localhost/api/v3/ai/context?cmd=${encodeURIComponent(cmd)}&id=${encodeURIComponent(id)}`,
  );
}

/** One row as scan_history hands it back, with a findings array. */
function scanRow(findings: unknown[]) {
  return {
    rows: [
      {
        id: 42,
        url: "https://example.com",
        summary: { critical: 1, high: 1, info: 1, total: 3 },
        findings,
        findings_count: Array.isArray(findings) ? findings.length : 0,
        duration: 2841,
        scanned_at: "2026-09-15T10:00:00.000Z",
        source: "web",
      },
    ],
  };
}

const FINDING = (id: string, severity: string) => ({
  id,
  title: `Title for ${id}`,
  severity,
  category: "headers",
});

describe("GET /api/v3/ai/context?cmd=me", () => {
  it("reports today's usage, not just the daily cap", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          name: "Ada",
          email: "ada@example.com",
          plan: "free",
          role: "user",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const json = await (await GET(getRequest("me"))).json();

    // The cap alone was all this used to carry, and it cannot answer "why
    // can't I scan right now".
    expect(json.content).toContain("**Daily scan limit:** 25");
    expect(json.content).toContain("**Scans used today:** 3 of 25");
    expect(json.content).toContain("**Remaining today:** 22");
    expect(json.content).toContain("**Quota resets:**");
    // The remainder reaches the person directly, not only the model.
    expect(json.summary).toContain("22 of 25 scans left today");
  });

  it("does not invent a cap or a remainder for an unlimited plan", async () => {
    mockCanMakeRequest.mockResolvedValue({
      allowed: true,
      used: 9,
      limit: -1, // canMakeRequest reports unlimited as -1, not Infinity
      remaining: 0,
      resetsAt: "2026-09-17T00:00:00.000Z",
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          name: "Ada",
          email: "ada@example.com",
          plan: "elite_supporter",
          role: "user",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const json = await (await GET(getRequest("me"))).json();

    expect(json.content).toContain("**Daily scan limit:** Unlimited");
    expect(json.content).toContain("no daily cap");
    // remaining is 0 on an unlimited plan, and printing it would read as
    // "you have none left", which is the opposite of true.
    expect(json.content).not.toContain("**Remaining today:**");
    expect(json.content).not.toContain("-1");
  });
});

describe("GET /api/v3/ai/context?cmd=history&id=N", () => {
  it("lists the findings, worst first", async () => {
    mockQuery.mockResolvedValueOnce(
      scanRow([
        FINDING("info-thing", "info"),
        FINDING("crit-thing", "critical"),
        FINDING("high-thing", "high"),
      ]),
    );

    const json = await (await GET(getRequestWithId("history", "42"))).json();

    expect(json.content).toContain("## Findings");
    expect(json.content).toContain("crit-thing");
    expect(json.content).toContain("high-thing");
    // Ordered by SEVERITY_ORDER, not by the order the engine emitted them, so
    // a truncated list loses info-level noise rather than the critical.
    expect(json.content.indexOf("crit-thing")).toBeLessThan(
      json.content.indexOf("high-thing"),
    );
    expect(json.content.indexOf("high-thing")).toBeLessThan(
      json.content.indexOf("info-thing"),
    );
  });

  it("selects the findings column at all", async () => {
    mockQuery.mockResolvedValueOnce(scanRow([FINDING("a", "low")]));
    await GET(getRequestWithId("history", "42"));
    const [sql] = mockQuery.mock.calls[0] as [string];
    // The whole bug was that this column existed and was never read.
    expect(sql).toContain("findings");
  });

  it("caps a large list and says that it did", async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      FINDING(`finding-${i}`, "medium"),
    );
    mockQuery.mockResolvedValueOnce(scanRow(many));

    const json = await (await GET(getRequestWithId("history", "42"))).json();

    expect(json.content).toContain("Showing the 40 most severe of 60");
    expect(json.content).not.toContain("finding-59");
  });

  it("omits the findings section entirely for a clean scan", async () => {
    mockQuery.mockResolvedValueOnce(scanRow([]));
    const json = await (await GET(getRequestWithId("history", "42"))).json();
    expect(json.content).not.toContain("## Findings");
  });

  it("survives a row whose findings column is not an array", async () => {
    mockQuery.mockResolvedValueOnce(scanRow(null as unknown as unknown[]));
    const res = await GET(getRequestWithId("history", "42"));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v3/ai/context?cmd=legal", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest("legal"));
    expect(res.status).toBe(401);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns the compiled legal-knowledge.md content when present", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "# VulnRadar Legal Pages: AI Knowledge\n\n## Terms of Service\n...",
    );

    const res = await GET(getRequest("legal"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cmd).toBe("legal");
    expect(body.label).toBe("Legal Pages");
    expect(body.content).toContain("Terms of Service");
    expect(body.summary).toMatch(/loaded/i);
  });

  it("degrades to an actionable message instead of crashing when the file is missing", async () => {
    mockExistsSync.mockReturnValue(false);

    const res = await GET(getRequest("legal"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content).toBe("");
    expect(body.summary).toContain("npm run build:knowledge");
  });

  it("reads each knowledge file from disk once, not on every request", async () => {
    // checks-knowledge.md is close to 1 MB and readFileSync blocks the whole
    // process, so re-reading it per request let any signed-in user stall the
    // event loop by looping this endpoint.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Legal\n\n## Terms of Service\n");

    await GET(getRequest("legal"));
    await GET(getRequest("legal"));
    await GET(getRequest("legal"));

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });

  it("resolves the session once per request instead of twice on the account commands", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await GET(getRequest("stats"));

    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });
});
