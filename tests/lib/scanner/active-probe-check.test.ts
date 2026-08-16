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

import {
  checkActiveProbes,
  checkSqlInjectionProbe,
  checkSstiProbe,
} from "@/lib/scanner/active-probe-check";

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

  it("gives distinct finding ids to two different forms that share the same action", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(TWO_SEARCH_FORMS_SAME_ACTION_PAGE))
      .mockImplementationOnce(async (_url: string) => {
        const q = new URL(_url).searchParams.get("q") ?? "";
        return htmlResponse(`<p>Results for: ${q}</p>`);
      })
      .mockImplementationOnce(async (_url: string) => {
        const query = new URL(_url).searchParams.get("query") ?? "";
        return htmlResponse(`<p>Results for: ${query}</p>`);
      });

    const findings = await checkActiveProbes("https://example.com/search");
    expect(findings).toHaveLength(2);
    expect(findings[0].id).not.toBe(findings[1].id);
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

  it("does not flag a JSON API response that omits Content-Type entirely (real backend misconfiguration, not just a hypothetical)", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(CONTACT_PAGE))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = new URLSearchParams(init.body as string);
        // Raw bytes, not a string body -- a string body makes the Response
        // constructor auto-fill Content-Type: text/plain per the Fetch
        // spec, which would exercise the OLD "non-HTML content-type
        // present" guard instead of the new no-Content-Type markup-shape
        // sniff this fixture is meant to test.
        return new Response(
          new TextEncoder().encode(
            JSON.stringify({
              error: `invalid value for field: ${body.get("name")}`,
            }),
          ),
          { status: 400 },
        );
      });

    const findings = await checkActiveProbes("https://example.com/contact");
    expect(findings).toEqual([]);
  });

  it("still flags a real reflected-XSS response with no Content-Type header (fails open toward HTML when the body is actually markup-shaped)", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(htmlResponse(SEARCH_PAGE))
      .mockImplementationOnce(async (_url: string) => {
        const q = new URL(_url).searchParams.get("q") ?? "";
        // A string body makes the Response constructor auto-fill
        // Content-Type: text/plain per the Fetch spec, which would defeat
        // the point of this fixture -- pass raw bytes instead so no
        // Content-Type is set at all, the actual "misconfigured backend"
        // scenario this guard needs to still fail open on.
        return new Response(
          new TextEncoder().encode(`<p>Results for: ${q}</p>`),
          { status: 200 },
        );
      });

    const findings = await checkActiveProbes("https://example.com/search");
    expect(findings).toHaveLength(1);
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

// A cancelled scan must stop sending real requests to the target immediately,
// not merely fail to start the next check category. These cover the
// cancelSignal contract shared by all three probes above.
describe("cancellation", () => {
  it("never calls safeFetch when cancelSignal is already aborted before the check starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const findings = await checkActiveProbes(
      "https://example.com",
      controller.signal,
    );
    expect(findings).toEqual([]);
    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockValidateScanTarget).not.toHaveBeenCalled();
  });

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
