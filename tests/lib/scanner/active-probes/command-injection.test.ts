/**
 * Tests for the OS command injection active probe.
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

import { checkCommandInjectionProbe } from "@/lib/scanner/active-probes/command-injection";

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

const PING_PAGE = `
<html><body>
<form action="/ping" method="post">
  <input type="text" name="host">
</form>
</body></html>
`;

const NO_FORM_PAGE = `<html><body><h1>Nothing here</h1></body></html>`;

// Extracts the "vr<hex>cmdi" marker prefix that checkCommandInjectionProbe
// embeds in its payload, so a mock implementation can compute the exact
// "evaluated" (shell-executed) response the way a genuinely vulnerable
// backend would.
function evaluatedEcho(payload: string): string {
  const match = /vr([0-9a-f]+)cmdi/.exec(payload);
  const hex = match?.[1] ?? "";
  return `vr${hex}cmdi91end${hex}`;
}

beforeEach(() => {
  mockSafeFetch.mockReset();
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
});

describe("checkCommandInjectionProbe", () => {
  it("returns [] and never calls safeFetch when validateScanTarget says unsafe", async () => {
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "blocked",
    });
    const findings = await checkCommandInjectionProbe("https://example.com");
    expect(findings).toEqual([]);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("returns [] when the page has no forms", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(NO_FORM_PAGE));
    const findings = await checkCommandInjectionProbe("https://example.com");
    expect(findings).toEqual([]);
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("flags a form whose shell arithmetic marker comes back evaluated", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(PING_PAGE))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new URLSearchParams(init.body as string);
        const host = body.get("host") ?? "";
        return htmlResponse(`<p>Pinging ${evaluatedEcho(host)}</p>`);
      });

    const findings = await checkCommandInjectionProbe(
      "https://example.com/ping",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toMatch(/^os-command-injection--/);
    expect(findings[0].category).toBe("active-probes");
    expect(findings[0].severity).toBe("critical");
  });

  it("does not flag a page that merely reflects the raw, unevaluated payload (not command-injected, just echoed as text)", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockImplementationOnce(async (_url: string) => {
        const q = new URL(_url).searchParams.get("q") ?? "";
        // A naive search box that reflects the input verbatim, unescaped --
        // the raw "$((7*13))" text appears, but it was never run through a
        // shell, so it never becomes "91".
        return htmlResponse(`<p>No results for: ${q}</p>`);
      });

    const findings = await checkCommandInjectionProbe(
      "https://example.com/search",
    );
    expect(findings).toEqual([]);
  });

  it("does not flag a page that merely contains the number 91 elsewhere", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockResolvedValueOnce(
        htmlResponse("<p>91 results found, none matching your query</p>"),
      );

    const findings = await checkCommandInjectionProbe(
      "https://example.com/search",
    );
    expect(findings).toEqual([]);
  });

  it("submits a payload starting with a semicolon shell metacharacter", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockResolvedValueOnce(htmlResponse("<p>no reflection</p>"));

    await checkCommandInjectionProbe("https://example.com/search");

    const [probeUrl] = mockSafeFetch.mock.calls[1];
    const q = new URL(probeUrl as string).searchParams.get("q") ?? "";
    expect(q).toMatch(/^;echo vr[0-9a-f]+cmdi\$\(\(7\*13\)\)end[0-9a-f]+$/);
  });

  it("restricts every request to the scanned URL's own hostname", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(SEARCH_PAGE));
    await checkCommandInjectionProbe("https://example.com/search");
    for (const call of mockSafeFetch.mock.calls) {
      expect(call[2]).toEqual(["example.com"]);
    }
  });

  it("fails open (returns []) when the page fetch throws", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("network error"));
    const findings = await checkCommandInjectionProbe("https://example.com");
    expect(findings).toEqual([]);
  });

  it("never calls safeFetch when cancelSignal is already aborted before the check starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const findings = await checkCommandInjectionProbe(
      "https://example.com",
      controller.signal,
    );
    expect(findings).toEqual([]);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});
