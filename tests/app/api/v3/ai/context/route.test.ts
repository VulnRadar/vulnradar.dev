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
  mockGetSession.mockResolvedValue({ userId: 7 });
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
