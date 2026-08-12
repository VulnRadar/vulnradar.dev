/**
 * Tests for the active-probing (reflected-input canary) check.
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

import { checkActiveProbes } from "@/lib/scanner/active-probe-check";

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

describe("checkActiveProbes", () => {
  it("returns [] and never calls safeFetch when validateScanTarget says unsafe", async () => {
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "blocked",
    });
    const findings = await checkActiveProbes("https://example.com");
    expect(findings).toEqual([]);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("returns [] when the page has no forms", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(NO_FORM_PAGE));
    const findings = await checkActiveProbes("https://example.com");
    expect(findings).toEqual([]);
    // Only the page fetch happened, no probe submission since there's
    // nothing to submit to.
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("returns [] when the canary does not reflect (properly escaped)", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockResolvedValueOnce(
        htmlResponse("<p>No results for &lt;vr...xss&gt;</p>"),
      );
    const findings = await checkActiveProbes("https://example.com");
    expect(findings).toEqual([]);
  });

  it("flags a GET form whose canary reflects unescaped", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockImplementationOnce(async (_url: string, _init: RequestInit) => {
        // Echo the submitted query param back unescaped, like a naive
        // "Results for: <input>" page would.
        const submittedUrl = new URL(_url);
        const q = submittedUrl.searchParams.get("q") ?? "";
        return htmlResponse(`<p>Results for: ${q}</p>`);
      });

    const findings = await checkActiveProbes("https://example.com/search");
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toMatch(/^reflected-input-xss--/);
    expect(findings[0].category).toBe("active-probes");
    expect(findings[0].severity).toBe("critical");
  });

  it("does not flag a JSON API response that echoes the marker in a string value", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(CONTACT_PAGE))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new URLSearchParams(init.body as string);
        return new Response(
          JSON.stringify({ error: `Invalid value: ${body.get("name")}` }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      });

    const findings = await checkActiveProbes("https://example.com/contact");
    expect(findings).toEqual([]);
  });

  it("submits a GET form as query params, not a body", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockResolvedValueOnce(htmlResponse("<p>no reflection</p>"));

    await checkActiveProbes("https://example.com/search");

    const [probeUrl, probeInit] = mockSafeFetch.mock.calls[1];
    expect(probeInit.method).toBe("GET");
    expect(probeInit.body).toBeUndefined();
    expect(new URL(probeUrl as string).searchParams.get("q")).toMatch(
      /^<vr[0-9a-f]+xss>$/,
    );
  });

  it("submits a POST form as a urlencoded body and carries the hidden CSRF field through", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(CONTACT_PAGE))
      .mockResolvedValueOnce(htmlResponse("<p>Thanks!</p>"));

    await checkActiveProbes("https://example.com/contact");

    const [probeUrl, probeInit] = mockSafeFetch.mock.calls[1];
    expect(probeUrl).toBe("https://example.com/contact");
    expect(probeInit.method).toBe("POST");
    const body = new URLSearchParams(probeInit.body as string);
    expect(body.get("csrf")).toBe("tok-123");
    expect(body.get("name")).toMatch(/^<vr[0-9a-f]+xss>$/);
    expect(body.get("email")).toMatch(/^<vr[0-9a-f]+xss>$/);
  });

  it("restricts every request to the scanned URL's own hostname", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(SEARCH_PAGE));
    await checkActiveProbes("https://example.com/search");
    for (const call of mockSafeFetch.mock.calls) {
      const allowedHostnames = call[2];
      expect(allowedHostnames).toEqual(["example.com"]);
    }
  });

  it("fails open (returns []) when the page fetch throws", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("network error"));
    const findings = await checkActiveProbes("https://example.com");
    expect(findings).toEqual([]);
  });

  it("fails open on one form's probe error but still checks the next form", async () => {
    const TWO_FORMS_PAGE = `${SEARCH_PAGE}${CONTACT_PAGE}`;
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(TWO_FORMS_PAGE))
      .mockRejectedValueOnce(new Error("first form's probe failed"))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new URLSearchParams(init.body as string);
        return htmlResponse(`<p>Hi ${body.get("name")}</p>`);
      });

    const findings = await checkActiveProbes("https://example.com");
    expect(findings).toHaveLength(1);
    expect(mockSafeFetch).toHaveBeenCalledTimes(3);
  });

  it("does not probe a form with zero testable fields", async () => {
    const BUTTON_ONLY_PAGE = `<form action="/ping" method="post"><button type="submit">Ping</button></form>`;
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(BUTTON_ONLY_PAGE));
    const findings = await checkActiveProbes("https://example.com");
    expect(findings).toEqual([]);
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("caps the number of forms probed", async () => {
    const manyForms = Array.from(
      { length: 15 },
      (_, i) =>
        `<form action="/f${i}" method="get"><input type="text" name="q"></form>`,
    ).join("\n");
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(manyForms));
    mockSafeFetch.mockResolvedValue(htmlResponse("<p>no reflection</p>"));

    await checkActiveProbes("https://example.com");
    // 1 page fetch + at most 10 probes (MAX_FORMS_TO_PROBE), not 15.
    expect(mockSafeFetch.mock.calls.length).toBeLessThanOrEqual(11);
  });
});
