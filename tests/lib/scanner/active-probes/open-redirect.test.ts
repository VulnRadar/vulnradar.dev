/**
 * Tests for the open-redirect active probe.
 *
 * Unlike the form-submitting probes in this directory, checkOpenRedirectProbe
 * uses raw global fetch (manual-redirect inspection) and the real
 * validateScanTarget/isPrivateHostname from safe-fetch.ts, the same pattern
 * tests/lib/scanner/async-checks.test.ts uses for checkActiveCORS and
 * friends. Only dns/promises' `lookup` (validateScanTarget's DNS step) is
 * mocked, defaulting to a public IP so the real safety logic runs in tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

import { checkOpenRedirectProbe } from "@/lib/scanner/active-probes/open-redirect";

const PAGE_WITH_LOGIN_REDIRECT = `
<html><body>
<a href="/login?redirect=/dashboard">Log in</a>
</body></html>
`;

const PAGE_WITH_MULTIPLE_REDIRECT_PARAMS = `
<html><body>
<a href="/login?next=/account">Log in</a>
<form action="/logout?return_to=/">Log out</form>
</body></html>
`;

const PAGE_WITH_NO_REDIRECT_PARAM = `
<html><body>
<a href="/about">About</a>
<a href="/contact?ref=footer">Contact</a>
</body></html>
`;

const PAGE_WITH_CROSS_HOST_REDIRECT_PARAM = `
<html><body>
<a href="https://other-site.example/go?redirect=/x">External</a>
</body></html>
`;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkOpenRedirectProbe", () => {
  it("returns [] when the page references no known redirect-parameter name", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(PAGE_WITH_NO_REDIRECT_PARAM),
    });
    const findings = await checkOpenRedirectProbe("https://example.com");
    expect(findings).toEqual([]);
    // Only the baseline page fetch happened -- no candidate to probe.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores a redirect-parameter name found on a cross-host link", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(PAGE_WITH_CROSS_HOST_REDIRECT_PARAM),
    });
    const findings = await checkOpenRedirectProbe("https://example.com");
    expect(findings).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("flags an endpoint that redirects to the canary URL for a discovered redirect parameter", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com") {
          return {
            ok: true,
            status: 200,
            text: () => Promise.resolve(PAGE_WITH_LOGIN_REDIRECT),
          };
        }
        // The probe request: redirect param replaced with the canary target.
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location"
                ? "https://openredirect-probe.vulnradar.test/canary"
                : null,
          },
        };
      },
    );

    const findings = await checkOpenRedirectProbe("https://example.com");
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toMatch(/^confirmed-open-redirect--/);
    expect(findings[0].category).toBe("active-probes");
    expect(findings[0].severity).toBe("medium");
  });

  it("does not flag an endpoint that redirects somewhere other than the canary target", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com") {
          return {
            ok: true,
            status: 200,
            text: () => Promise.resolve(PAGE_WITH_LOGIN_REDIRECT),
          };
        }
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location" ? "/dashboard" : null,
          },
        };
      },
    );

    const findings = await checkOpenRedirectProbe("https://example.com");
    expect(findings).toEqual([]);
  });

  it("does not flag a 200 response even if it echoes the canary URL in the body", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com") {
          return {
            ok: true,
            status: 200,
            text: () => Promise.resolve(PAGE_WITH_LOGIN_REDIRECT),
          };
        }
        return {
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              "Redirecting to https://openredirect-probe.vulnradar.test/canary via JavaScript...",
            ),
          headers: { get: () => null },
        };
      },
    );

    const findings = await checkOpenRedirectProbe("https://example.com");
    expect(findings).toEqual([]);
  });

  it("probes each distinct discovered redirect parameter separately", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com") {
          return {
            ok: true,
            status: 200,
            text: () => Promise.resolve(PAGE_WITH_MULTIPLE_REDIRECT_PARAMS),
          };
        }
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location"
                ? "https://openredirect-probe.vulnradar.test/canary"
                : null,
          },
        };
      },
    );

    const findings = await checkOpenRedirectProbe("https://example.com");
    expect(findings).toHaveLength(2);
    expect(findings[0].id).not.toBe(findings[1].id);
  });

  it("fails open (returns []) when the baseline page fetch throws", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );
    const findings = await checkOpenRedirectProbe("https://example.com");
    expect(findings).toEqual([]);
  });

  it("fails open on one candidate's probe error but still checks the next", async () => {
    let probeCall = 0;
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com") {
          return {
            ok: true,
            status: 200,
            text: () => Promise.resolve(PAGE_WITH_MULTIPLE_REDIRECT_PARAMS),
          };
        }
        probeCall++;
        if (probeCall === 1) throw new Error("first candidate's probe failed");
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location"
                ? "https://openredirect-probe.vulnradar.test/canary"
                : null,
          },
        };
      },
    );

    const findings = await checkOpenRedirectProbe("https://example.com");
    expect(findings).toHaveLength(1);
  });

  it("never calls fetch when cancelSignal is already aborted before the check starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const findings = await checkOpenRedirectProbe(
      "https://example.com",
      controller.signal,
    );
    expect(findings).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
