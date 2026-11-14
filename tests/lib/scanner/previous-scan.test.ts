/**
 * lib/scanner/previous-scan.ts: the one "previous scan" lookup the regression
 * alert and the stored diff share, and the id remap that makes a scan stored
 * before canonical URLs comparable with today's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { currentFindingId, getPreviousCompletedScan, urlForms } =
  await import("@/lib/scanner/previous-scan");
const { generateId, legacyFindingId } = await import("@/lib/scanner/_helpers");

const OLD_URL = "https://example.com";
const NEW_URL = "https://example.com/";

function finding(id: string): Vulnerability {
  return {
    id,
    title: "t",
    severity: "high",
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: [],
    codeExamples: [],
  };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("urlForms", () => {
  it("lists the canonical spelling first and the root without its slash", () => {
    expect(urlForms("example.com")).toEqual([NEW_URL, OLD_URL]);
  });

  it("falls back to the input when it is not a URL at all", () => {
    expect(urlForms("https://exa\tmple.com/")).toEqual([
      "https://exa\tmple.com/",
    ]);
  });
});

describe("currentFindingId", () => {
  it("gives an id hashed from the old spelling the id it has today", () => {
    expect(
      currentFindingId(
        finding(legacyFindingId("hsts-missing", OLD_URL)),
        OLD_URL,
      ),
    ).toBe(generateId("hsts-missing", NEW_URL));
  });

  it("leaves an id that is already today's alone", () => {
    const id = generateId("hsts-missing", NEW_URL);
    expect(currentFindingId(finding(id), NEW_URL)).toBe(id);
  });

  it("leaves a malformed stored finding's id as it is", () => {
    const odd = { ...finding("x"), id: 42 } as unknown as Vulnerability;
    expect(currentFindingId(odd, OLD_URL)).toBe(42);
    const noEvidence = {
      ...finding(legacyFindingId("hsts-missing", OLD_URL)),
      evidence: undefined,
      evidenceExcerpts: "not a list",
    } as unknown as Vulnerability;
    expect(currentFindingId(noEvidence, OLD_URL)).toBe(
      generateId("hsts-missing", NEW_URL),
    );
  });
});

describe("getPreviousCompletedScan", () => {
  it("matches every stored spelling, completed scans only, never the scan itself", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getPreviousCompletedScan(7, NEW_URL, 42)).toBeNull();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("url = ANY($2::text[])");
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("id != $3");
    expect(params).toEqual([7, [NEW_URL, OLD_URL], 42]);
  });

  it("returns the row's own url and its findings in today's ids", async () => {
    const old = finding(legacyFindingId("hsts-missing", OLD_URL));
    const current = finding(generateId("csp-missing", NEW_URL));
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 5, url: OLD_URL, findings: JSON.stringify([old, current, null]) },
      ],
    });
    const previous = await getPreviousCompletedScan(7, NEW_URL, 42);
    expect(previous?.id).toBe(5);
    expect(previous?.url).toBe(OLD_URL);
    expect(previous?.findings.map((f) => f?.id)).toEqual([
      generateId("hsts-missing", NEW_URL),
      current.id,
      undefined,
    ]);
  });

  it("reads a row with no findings array as one with no findings", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, url: NEW_URL, findings: { not: "a list" } }],
    });
    expect((await getPreviousCompletedScan(7, NEW_URL, 42))?.findings).toEqual(
      [],
    );
  });

  it("uses the looked-up url when the row does not say", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, findings: [finding("a--b")] }],
    });
    expect((await getPreviousCompletedScan(7, NEW_URL, 42))?.url).toBe(NEW_URL);
  });
});
