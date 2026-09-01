/**
 * Route-level tests for GET /api/v3/health, the readiness endpoint a
 * container HEALTHCHECK / load balancer polls. Only the database boundary
 * (pool.connect -> client.query/release) is mocked; the real schema-version
 * comparison and required-table gap detection run against it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { REQUIRED_TABLES } from "@/lib/database/required-tables";

const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();
const mockGetPoolStats = vi.fn();

vi.mock("@/lib/database/db", () => ({
  default: { connect: (...args: unknown[]) => mockConnect(...args) },
  getPoolStats: (...args: unknown[]) => mockGetPoolStats(...args),
}));

const { GET } = await import("@/app/api/v3/health/route");

/** REQUIRED_TABLES from lib/database/required-tables.ts, minus none present. */
function tablesRows(present: string[]) {
  return { rows: present.map((table_name) => ({ table_name })) };
}

// Imported, not restated. This used to be a hardcoded copy of the list, so
// adding a table to REQUIRED_TABLES (AUDIT-013#schema-06 added seven) made
// the suite fail against a fix rather than confirm it. Reading the real list
// means the next addition is covered automatically.
const ALL_REQUIRED = [...REQUIRED_TABLES];

beforeEach(() => {
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockReset();
  mockGetPoolStats.mockReset();
  mockGetPoolStats.mockReturnValue({ total: 1, idle: 1, waiting: 0, max: 10 });
  mockConnect.mockResolvedValue({
    query: (...args: unknown[]) => mockClientQuery(...args),
    release: (...args: unknown[]) => mockRelease(...args),
  });
});

describe("GET /api/v3/health", () => {
  it("returns 200/ok when connected, schema is current, and every required table exists", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ schema_version: "3.0.0" }] })
      .mockResolvedValueOnce(tablesRows(ALL_REQUIRED));

    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.database.connected).toBe(true);
    expect(json.database.schema_ok).toBe(true);
    expect(json.database.missing_tables).toEqual([]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("returns 503/degraded when the schema version is older than required", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ schema_version: "2.0.0" }] })
      .mockResolvedValueOnce(tablesRows(ALL_REQUIRED));

    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe("degraded");
    expect(json.database.schema_ok).toBe(false);
  });

  it("returns 503/degraded when schema_version is missing entirely", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(tablesRows(ALL_REQUIRED));

    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.database.schema_version).toBeNull();
    expect(json.database.schema_ok).toBe(false);
  });

  it("returns 503/degraded when the schema version claims readiness but a required table is missing (AUDIT-010, production-readiness #3)", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ schema_version: "3.0.0" }] })
      .mockResolvedValueOnce(
        tablesRows(ALL_REQUIRED.filter((t) => t !== "host_badges")),
      );

    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe("degraded");
    expect(json.database.schema_ok).toBe(true);
    expect(json.database.missing_tables).toEqual(["host_badges"]);
  });

  it("lists every missing table, not just the first one found", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ schema_version: "3.0.0" }] })
      .mockResolvedValueOnce(tablesRows(["users", "scan_history"]));

    const res = await GET();

    const json = await res.json();
    expect(json.database.missing_tables).toEqual(
      expect.arrayContaining([
        "api_keys",
        "host_reputation",
        "host_badges",
        "webhooks",
        "scan_finding_feedback",
        "system_error_logs",
      ]),
    );
    // Everything except the two seeded as present.
    expect(json.database.missing_tables).toHaveLength(ALL_REQUIRED.length - 2);
  });

  it("returns 503/unhealthy when the database connection fails, without leaking the driver error", async () => {
    mockConnect.mockRejectedValue(new Error("password authentication failed"));

    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe("unhealthy");
    expect(json.database.connected).toBe(false);
    expect(JSON.stringify(json)).not.toContain("password authentication");
  });

  it("releases the client even when the table-presence query throws", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ schema_version: "3.0.0" }] })
      .mockRejectedValueOnce(new Error("query timeout"));

    const res = await GET();

    expect(res.status).toBe(503);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
