import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetClientIp = vi.fn();
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: () => mockGetClientIp(),
}));

const { readTeamAuditLabel, recordTeamAudit, teamAuditLabel } =
  await import("@/lib/teams/team-audit");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetClientIp.mockReset();
  mockGetClientIp.mockResolvedValue("203.0.113.9");
});

describe("recordTeamAudit", () => {
  it("hands the write the caller's IP", async () => {
    const write = vi.fn(async () => undefined);

    await recordTeamAudit(write);

    expect(write).toHaveBeenCalledWith("203.0.113.9");
  });

  it("passes undefined when the IP is unknown", async () => {
    mockGetClientIp.mockResolvedValue(null);
    const write = vi.fn(async () => undefined);

    await recordTeamAudit(write);

    expect(write).toHaveBeenCalledWith(undefined);
  });

  it("logs a failed write and does not throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordTeamAudit(async () => {
        throw new Error("connection terminated");
      }),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("the team label in an audit row", () => {
  it("carries the name and the id", () => {
    expect(teamAuditLabel(5, "Acme")).toBe('"Acme" (#5)');
  });

  it("falls back to the id when there is no name", () => {
    expect(teamAuditLabel(5, undefined)).toBe("#5");
    expect(teamAuditLabel(5, null)).toBe("#5");
  });

  it("reads the name when the route does not have it", async () => {
    mockQuery.mockResolvedValue({ rows: [{ name: "Acme" }] });

    await expect(readTeamAuditLabel(5)).resolves.toBe('"Acme" (#5)');
    expect(mockQuery.mock.calls[0][1]).toEqual([5]);
  });

  it("uses the id for a team that no longer exists", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(readTeamAuditLabel(5)).resolves.toBe("#5");
  });
});
