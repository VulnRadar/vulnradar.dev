/**
 * Tests for the error-based SQL injection active probe.
 *
 * Mocks lib/scanner/safe-fetch.ts directly (same pattern as
 * tests/lib/scanner/execute-scan.test.ts) rather than global fetch, since
 * safeFetch itself does DNS resolution this check has no business
 * re-testing. findAllForms runs for real against realistic HTML fixtures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSafeFetch = vi.fn();
const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

import { checkSqlInjectionProbe } from "@/lib/scanner/active-probes/sqli-error-based";

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

const SEARCH_PAGE = `
<html><body>
<form action="/search" method="get">
  <input type="text" name="q">
  <button type="submit">Go</button>
</form>
</body></html>
`;

const CONTACT_PAGE = `
<html><body>
<form action="/contact" method="post">
  <input type="hidden" name="csrf" value="tok-123">
  <input type="text" name="name">
  <input type="email" name="email">
</form>
</body></html>
`;

// Two distinct forms (different field names) that happen to submit to the
// same action -- a header "quick search" widget and a body "advanced
// search" form both posting to /search is a common real-world pattern.
const TWO_SEARCH_FORMS_SAME_ACTION_PAGE = `
<html><body>
<form action="/search" method="get">
  <input type="text" name="q">
  <button type="submit">Go</button>
</form>
<form action="/search" method="get">
  <input type="text" name="query">
  <button type="submit">Search</button>
</form>
</body></html>
`;

beforeEach(() => {
  mockSafeFetch.mockReset();
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
});

describe("checkSqlInjectionProbe", () => {
  it("flags a form whose canary quote produces a database error", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockResolvedValueOnce(
        htmlResponse(
          "<p>Error: You have an error in your SQL syntax; check the manual</p>",
        ),
      );

    const findings = await checkSqlInjectionProbe("https://example.com/search");
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toMatch(/^sql-injection-error-based--/);
    expect(findings[0].category).toBe("active-probes");
    expect(findings[0].severity).toBe("critical");
  });

  it("recognizes a PostgreSQL error signature", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(CONTACT_PAGE))
      .mockResolvedValueOnce(
        htmlResponse('{"error": "syntax error at or near \\"vr1234\\""}'),
      );

    const findings = await checkSqlInjectionProbe(
      "https://example.com/contact",
    );
    expect(findings).toHaveLength(1);
  });

  it("does not flag an ordinary response with no database error text", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockResolvedValueOnce(htmlResponse("<p>No results found.</p>"));

    const findings = await checkSqlInjectionProbe("https://example.com/search");
    expect(findings).toEqual([]);
  });

  it("submits a canary containing an unescaped quote", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockResolvedValueOnce(htmlResponse("<p>no error</p>"));

    await checkSqlInjectionProbe("https://example.com/search");

    const [probeUrl] = mockSafeFetch.mock.calls[1];
    expect(new URL(probeUrl as string).searchParams.get("q")).toMatch(
      /^vr[0-9a-f]+'$/,
    );
  });

  it("restricts every request to the scanned URL's own hostname", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(SEARCH_PAGE));
    await checkSqlInjectionProbe("https://example.com/search");
    for (const call of mockSafeFetch.mock.calls) {
      expect(call[2]).toEqual(["example.com"]);
    }
  });

  it("fails open (returns []) when the page fetch throws", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("network error"));
    const findings = await checkSqlInjectionProbe("https://example.com");
    expect(findings).toEqual([]);
  });

  it("fails open on one form's probe error but still checks the next form", async () => {
    const TWO_FORMS_PAGE = `${SEARCH_PAGE}${CONTACT_PAGE}`;
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(TWO_FORMS_PAGE))
      .mockRejectedValueOnce(new Error("first form's probe failed"))
      .mockResolvedValueOnce(
        htmlResponse("ORA-01756: quoted string not properly terminated"),
      );

    const findings = await checkSqlInjectionProbe("https://example.com");
    expect(findings).toHaveLength(1);
  });

  it("does not flag a database/dev-tooling documentation page that already quotes the exact error text before any probe runs", async () => {
    const DOCS_PAGE_WITH_SEARCH = `
<html><body>
<p>Common error: "you have an error in your SQL syntax" usually means a
malformed query. See our troubleshooting guide.</p>
<form action="/search" method="get">
  <input type="text" name="q">
</form>
</body></html>
`;
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(DOCS_PAGE_WITH_SEARCH))
      .mockResolvedValueOnce(
        // Real page: this text is on EVERY response from this page,
        // probed or not -- our lone-quote payload didn't cause it.
        htmlResponse(
          'Common error: "you have an error in your SQL syntax" usually means a malformed query.',
        ),
      );

    const findings = await checkSqlInjectionProbe("https://example.com/search");
    expect(findings).toEqual([]);
  });

  it("still flags a real SQL error signature that was NOT already present on the unprobed page, even when the page happens to mention an unrelated one", async () => {
    const DOCS_PAGE_MENTIONS_MYSQL_ONLY = `
<html><body>
<p>We migrated from "you have an error in your SQL syntax" (MySQL) to PostgreSQL.</p>
<form action="/search" method="get">
  <input type="text" name="q">
</form>
</body></html>
`;
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(DOCS_PAGE_MENTIONS_MYSQL_ONLY))
      .mockResolvedValueOnce(
        // A genuinely different (PostgreSQL) signature, not present on
        // the baseline page at all -- this one is real, live evidence.
        htmlResponse('ERROR: syntax error at or near "vr1234\'"'),
      );

    const findings = await checkSqlInjectionProbe("https://example.com/search");
    expect(findings).toHaveLength(1);
  });
});

// A cancelled scan must stop sending real requests to the target
// immediately, not merely fail to start the next check category.
describe("cancellation", () => {
  it("stops submitting further forms once cancelSignal aborts mid-scan", async () => {
    const controller = new AbortController();
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(TWO_SEARCH_FORMS_SAME_ACTION_PAGE))
      .mockImplementationOnce(async () => {
        // Cancellation lands while the first form's probe is "in flight".
        controller.abort();
        return htmlResponse("<p>no results</p>");
      });

    const findings = await checkSqlInjectionProbe(
      "https://example.com/search",
      controller.signal,
    );

    expect(findings).toEqual([]);
    // Baseline page fetch + exactly one form probe, never the second form.
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
  });
});
