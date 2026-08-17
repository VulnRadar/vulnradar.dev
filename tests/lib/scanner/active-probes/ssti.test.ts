/**
 * Tests for the Server-Side Template Injection (SSTI) active probe.
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

import { checkSstiProbe } from "@/lib/scanner/active-probes/ssti";

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

const NO_FORM_PAGE = `<html><body><h1>Nothing here</h1></body></html>`;

beforeEach(() => {
  mockSafeFetch.mockReset();
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
});

describe("checkSstiProbe", () => {
  it("flags a form whose {{ }} template expression is evaluated", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockImplementationOnce(async (_url: string) => {
        const q = new URL(_url).searchParams.get("q") ?? "";
        // Simulate a Jinja2/Twig-style engine: evaluates {{ }}, leaves ${ } literal.
        const evaluated = q.replace(/\{\{7\*13\}\}/, "91");
        return htmlResponse(`<p>Result: ${evaluated}</p>`);
      });

    const findings = await checkSstiProbe("https://example.com/search");
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toMatch(/^server-side-template-injection--/);
    expect(findings[0].category).toBe("active-probes");
  });

  it("flags a form whose ${ } template expression is evaluated", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(CONTACT_PAGE))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new URLSearchParams(init.body as string);
        const name = body.get("name") ?? "";
        // Simulate a FreeMarker/ERB-style engine: evaluates ${ }, leaves {{ }} literal.
        const evaluated = name.replace(/\$\{7\*13\}/, "91");
        return htmlResponse(`<p>Hi ${evaluated}</p>`);
      });

    const findings = await checkSstiProbe("https://example.com/contact");
    expect(findings).toHaveLength(1);
  });

  it("does not flag a page that merely contains the number 91 elsewhere", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockResolvedValueOnce(
        htmlResponse("<p>91 results found, none matching your query</p>"),
      );

    const findings = await checkSstiProbe("https://example.com/search");
    expect(findings).toEqual([]);
  });

  it("does not flag when the marker is reflected inert (not evaluated)", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockImplementationOnce(async (_url: string) => {
        const q = new URL(_url).searchParams.get("q") ?? "";
        return htmlResponse(`<p>No results for: ${q}</p>`);
      });

    const findings = await checkSstiProbe("https://example.com/search");
    expect(findings).toEqual([]);
  });

  it("restricts every request to the scanned URL's own hostname", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(SEARCH_PAGE));
    await checkSstiProbe("https://example.com/search");
    for (const call of mockSafeFetch.mock.calls) {
      expect(call[2]).toEqual(["example.com"]);
    }
  });

  it("fails open (returns []) when the page fetch throws", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("network error"));
    const findings = await checkSstiProbe("https://example.com");
    expect(findings).toEqual([]);
  });

  it("returns [] when the page has no forms", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(NO_FORM_PAGE));
    const findings = await checkSstiProbe("https://example.com");
    expect(findings).toEqual([]);
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });
});

// A cancelled scan must stop sending real requests to the target
// immediately, not merely fail to start the next check category.
describe("cancellation", () => {
  it("threads cancelSignal into the probe request's own AbortSignal", async () => {
    const controller = new AbortController();
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(SEARCH_PAGE));
    mockSafeFetch.mockResolvedValueOnce(htmlResponse("<p>no results</p>"));

    await checkSstiProbe("https://example.com/search", controller.signal);

    const probeCall = mockSafeFetch.mock.calls[1];
    const probeInit = probeCall[1] as RequestInit;
    expect(probeInit.signal).toBeInstanceOf(AbortSignal);
    expect(probeInit.signal?.aborted).toBe(false);
    controller.abort();
    expect(probeInit.signal?.aborted).toBe(true);
  });
});
