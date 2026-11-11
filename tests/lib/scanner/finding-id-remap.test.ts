/**
 * The carry-over of feedback and remediation rows to the finding ids the
 * scanner now produces. The key arithmetic is pure and tested against the
 * real engine output; the table walk is tested with a faked pool for what it
 * sends, and against Postgres in tests/integration/scan-scoring.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

vi.mock("@/lib/logging/log", () => ({ logError: vi.fn() }));

const { legacyFindingId, generateId } = await import("@/lib/scanner/_helpers");
const { runSyncChecks } = await import("@/lib/scanner/engine");
const { remapFindingKey, needsStoredHit, remapLegacyFindingIds } =
  await import("@/lib/scanner/finding-id-remap");

const LIBRARY = "page-outdated-vulnerable-library";
const JQUERY = `<html><head><script src="https://code.jquery.com/jquery-1.12.4.min.js"></script></head><body>ok</body></html>`;

function libraryFinding(url: string) {
  const finding = runSyncChecks(
    url,
    new Headers({ "content-type": "text/html" }),
    JQUERY,
  ).findings.find((f) => f.id.startsWith(`${LIBRARY}--`));
  if (!finding) throw new Error("fixture produced no library finding");
  return finding;
}

describe("remapFindingKey", () => {
  it("moves a single-hit id stored under a bare URL to the canonical one", () => {
    const old = legacyFindingId("csp-missing", "https://example.com");
    expect(remapFindingKey(old, "https://example.com")).toEqual({
      findingId: generateId("csp-missing", "https://example.com/"),
      findingUrl: "https://example.com/",
    });
  });

  it("leaves a row that is already canonical alone", () => {
    const id = generateId("csp-missing", "https://example.com/");
    expect(remapFindingKey(id, "https://example.com/")).toBeNull();
  });

  it("gives a lone library hit the id the engine now gives it", () => {
    const now = libraryFinding("https://example.com/");
    // What the engine stored for one library before it always folded the
    // hit in: the plain <checkId>--<urlHash> id.
    const old = legacyFindingId(LIBRARY, "https://example.com/");
    expect(old).not.toBe(now.id);
    expect(needsStoredHit(old, "https://example.com/")).toBe(true);

    expect(
      remapFindingKey(old, "https://example.com/", {
        evidence: now.evidence,
        evidenceExcerpts: now.evidenceExcerpts,
      }),
    ).toEqual({ findingId: now.id, findingUrl: "https://example.com/" });
  });

  it("re-spells a distinguished id whose URL changed spelling", () => {
    const now = libraryFinding("https://example.com/shop/");
    const oldUrl = "https://example.com/shop/";
    const hit = {
      evidence: now.evidence,
      evidenceExcerpts: now.evidenceExcerpts,
    };
    const dist = now
      .evidenceExcerpts!.map((e) => `${e.label}:${e.value}`)
      .join("|");
    const old = legacyFindingId(LIBRARY, oldUrl, dist);
    expect(needsStoredHit(old, oldUrl)).toBe(true);
    expect(remapFindingKey(old, oldUrl, hit)).toEqual({
      findingId: now.id,
      findingUrl: "https://example.com/shop",
    });
  });

  it("gives up on an id it cannot reproduce rather than guess", () => {
    expect(remapFindingKey("csp-missing--zzzz", "https://example.com")).toBe(
      null,
    );
  });
});

describe("remapLegacyFindingIds", () => {
  const query = vi.fn();
  const pool = { query } as unknown as Pool;

  beforeEach(() => {
    query.mockReset();
  });

  it("copies a moved feedback row under its new key and keeps the original", async () => {
    const old = legacyFindingId("csp-missing", "https://example.com");
    query.mockImplementation(async (sql: string) => {
      if (
        sql.includes("FROM scan_finding_feedback") &&
        sql.includes("ORDER BY id")
      ) {
        return {
          rows:
            query.mock.calls.filter(([s]) => s === sql).length === 1
              ? [
                  {
                    id: 9,
                    user_id: 4,
                    scan_history_id: 70,
                    finding_id: old,
                    finding_url: "https://example.com",
                  },
                ]
              : [],
        };
      }
      if (sql.startsWith("INSERT")) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });

    const counts = await remapLegacyFindingIds(pool);

    expect(counts).toEqual({ feedback: 1, remediation: 0 });
    const insert = query.mock.calls.find(([sql]) =>
      (sql as string).startsWith("INSERT INTO scan_finding_feedback"),
    );
    expect(insert?.[0]).toContain(
      "ON CONFLICT (user_id, finding_id, finding_url) DO NOTHING",
    );
    expect(insert?.[1]).toEqual([
      9,
      generateId("csp-missing", "https://example.com/"),
      "https://example.com/",
    ]);
    expect(
      query.mock.calls.some(([sql]) => /\bDELETE\b|\bUPDATE\b/.test(sql)),
    ).toBe(false);
  });

  it("never throws, and reports what it managed", async () => {
    query.mockRejectedValue(new Error("db down"));
    await expect(remapLegacyFindingIds(pool)).resolves.toEqual({
      feedback: 0,
      remediation: 0,
    });
  });
});
