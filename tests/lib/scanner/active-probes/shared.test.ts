/**
 * Shared infrastructure for the active probes. The probes' own suites run the
 * whole flow against mocked network calls; this one pins what is common to
 * all of them and visible to the site being probed: who the request says it
 * is from, and how a form is turned into a request.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: vi.fn(),
  validateScanTarget: vi.fn(async () => ({ safe: true })),
}));

import { safeFetch, validateScanTarget } from "@/lib/scanner/safe-fetch";
import {
  USER_AGENT,
  buildProbeRequest,
  discoverProbableForms,
} from "@/lib/scanner/active-probes/shared";
import {
  SCANNER_UA_ACTIVE_PROBE,
  SCANNER_UA_PRODUCT,
} from "@/lib/scanner/user-agent";
import { userAgentOf } from "../_user-agent-of";

const safeFetchMock = vi.mocked(safeFetch);
const validateScanTargetMock = vi.mocked(validateScanTarget);

beforeEach(() => {
  safeFetchMock.mockReset();
  validateScanTargetMock.mockReset();
  validateScanTargetMock.mockResolvedValue({ safe: true });
});

describe("USER_AGENT", () => {
  it("is the scanner's active-probe form and carries the product token", () => {
    expect(USER_AGENT).toBe(SCANNER_UA_ACTIVE_PROBE);
    expect(USER_AGENT).toContain(SCANNER_UA_PRODUCT);
    expect(USER_AGENT).toContain("Active Probe");
  });
});

describe("buildProbeRequest", () => {
  const hidden = { csrf: "tok" };
  const fields = ["q", "name"];

  it("puts a GET form's fields in the query string and names the scanner", () => {
    const { url, init } = buildProbeRequest(
      "https://example.com/search",
      "GET",
      hidden,
      fields,
      "canary123",
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("csrf")).toBe("tok");
    expect(parsed.searchParams.get("q")).toBe("canary123");
    expect(parsed.searchParams.get("name")).toBe("canary123");
    expect(init.method).toBe("GET");
    expect(userAgentOf(init)).toBe(USER_AGENT);
  });

  it("sends a POST form url-encoded and names the scanner", () => {
    const { url, init } = buildProbeRequest(
      "https://example.com/contact",
      "POST",
      hidden,
      fields,
      "canary123",
    );
    expect(url).toBe("https://example.com/contact");
    expect(init.method).toBe("POST");
    expect(userAgentOf(init)).toBe(USER_AGENT);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("csrf")).toBe("tok");
    expect(body.get("q")).toBe("canary123");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("carries a cancellation signal on every request", () => {
    const { init } = buildProbeRequest(
      "https://example.com/s",
      "POST",
      {},
      ["q"],
      "m",
      new AbortController().signal,
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("discoverProbableForms", () => {
  const PAGE = `<html><body>
    <form action="/search" method="get"><input type="text" name="q"></form>
  </body></html>`;

  it("fetches the page once, names the scanner, and returns the forms worth probing", async () => {
    safeFetchMock.mockResolvedValue(new Response(PAGE, { status: 200 }));
    const found = await discoverProbableForms("https://example.com/");

    expect(found?.hostname).toBe("example.com");
    expect(found?.forms).toHaveLength(1);
    expect(found?.forms[0].testableFields).toEqual(["q"]);
    expect(found?.baselineHtml).toBe(PAGE);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(userAgentOf(safeFetchMock.mock.calls[0][1])).toBe(USER_AGENT);
  });

  it("does nothing when the target fails the SSRF guard", async () => {
    validateScanTargetMock.mockResolvedValue({ safe: false, reason: "no" });
    expect(await discoverProbableForms("https://example.com/")).toBeNull();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the scan was already cancelled", async () => {
    const cancel = new AbortController();
    cancel.abort();
    expect(
      await discoverProbableForms("https://example.com/", cancel.signal),
    ).toBeNull();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("returns null for a page with no form to probe", async () => {
    safeFetchMock.mockResolvedValue(
      new Response("<html><body>no forms</body></html>"),
    );
    expect(await discoverProbableForms("https://example.com/")).toBeNull();
  });

  it("returns null when the page answers with an error", async () => {
    safeFetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await discoverProbableForms("https://example.com/")).toBeNull();
  });
});
