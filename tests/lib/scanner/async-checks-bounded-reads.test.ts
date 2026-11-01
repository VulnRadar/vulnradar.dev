/**
 * The async checks read bodies the scanned site controls: robots.txt,
 * security.txt, two dozen exposed-file paths, the MTA-STS policy, a second
 * copy of the page. Each used to call `res.text()` and slice afterwards, which
 * buffers the whole body before the slice runs, so a target that answered
 * robots.txt with an endless (or gzip-bombed) stream grew the server's heap
 * until the process died and took every other user's scan with it. Anyone can
 * trigger that, including from the anonymous demo scan.
 *
 * The responses here are real `Response` objects over a ReadableStream that
 * hands out 1 MB chunks for as long as it is read. What is asserted is that
 * each check stops after the first chunk past its cap, cancels the stream so
 * the socket is released, and settles far inside its own timeout.
 *
 * The MTA-STS half covers RFC 8461 section 3.3: a policy fetch must not
 * follow redirects, so a policy URL that answers 3xx has no policy at all,
 * whichever way safeFetch reports the redirect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("dns/promises", () => ({
  resolveTxt: vi.fn(),
  resolveCaa: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
  resolveMx: vi.fn(),
  resolveSoa: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
  resolveCname: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
  resolve4: vi.fn().mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolve6: vi.fn().mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolveNs: vi
    .fn()
    .mockRejectedValue(new Error("mock: dns disabled in tests")),
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("tls", () => ({
  default: { connect: vi.fn() },
  connect: vi.fn(),
}));

vi.mock("http", () => ({
  default: { request: vi.fn() },
  request: vi.fn(),
}));

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
  };
});

// safeFetch stays the real one unless a test replaces it: the MTA-STS cases
// need both the real redirect loop and the behaviour it is moving to (a
// SafeFetchError on the first 3xx when the caller passes redirect: "error").
vi.mock("@/lib/scanner/safe-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/safe-fetch")>();
  return { ...actual, safeFetch: vi.fn(actual.safeFetch) };
});

import * as dns from "dns/promises";
import * as http from "http";
import {
  checkRobotsTxt,
  checkLiveFetch,
  checkCspNonceReuse,
  checkDNSSecurity,
} from "@/lib/scanner/async-checks";
import { safeFetch } from "@/lib/scanner/safe-fetch";

const dnsMock = vi.mocked(dns);
const httpMock = vi.mocked(http);
const safeFetchMock = vi.mocked(safeFetch);
let realSafeFetch: typeof safeFetch;

const MB = 1024 * 1024;
// Past this the stream stalls instead of producing more. Without a stop the
// unfixed code would buffer until the test worker itself ran out of memory;
// with it, the unfixed code reads 24 MB and then hangs, which the deadline
// below reports as a failure.
const SAFETY_CHUNKS = 24;

interface EndlessBody {
  stream: ReadableStream<Uint8Array>;
  /** How many 1 MB chunks the reader pulled out of the stream. */
  pulls: number;
  cancelled: boolean;
}

function endlessBody(): EndlessBody {
  const state = { pulls: 0, cancelled: false } as EndlessBody;
  state.stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (state.pulls >= SAFETY_CHUNKS) return new Promise<void>(() => {});
        state.pulls++;
        controller.enqueue(new Uint8Array(MB).fill(0x61));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    // Nothing is read ahead, so `pulls` is exactly what the reader asked for.
    { highWaterMark: 0 },
  );
  return state;
}

function endlessResponse(
  bodies: EndlessBody[],
  init: ResponseInit = { status: 200 },
): Response {
  const body = endlessBody();
  bodies.push(body);
  return new Response(body.stream, init);
}

const HUNG = Symbol("hung");
async function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof HUNG> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof HUNG>((resolve) => {
    timer = setTimeout(() => resolve(HUNG), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const fetchMock = () => vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);

const urlOf = (input: unknown): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : (input as Request).url;

beforeEach(async () => {
  realSafeFetch = (
    await vi.importActual<typeof import("@/lib/scanner/safe-fetch")>(
      "@/lib/scanner/safe-fetch",
    )
  ).safeFetch;
  safeFetchMock.mockReset();
  safeFetchMock.mockImplementation(realSafeFetch);
  dnsMock.resolveTxt.mockReset();
  dnsMock.resolveMx.mockReset();
  httpMock.request.mockReset();
  httpMock.request.mockImplementation(() => {
    const req = {
      on: vi.fn((event: string, handler: (err: Error) => void) => {
        if (event === "error") {
          queueMicrotask(() => handler(new Error("ECONNREFUSED")));
        }
        return req;
      }),
      end: vi.fn(),
      destroy: vi.fn(),
    };
    return req as unknown as ReturnType<typeof http.request>;
  });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("target-controlled bodies are read up to a cap", () => {
  it("checkRobotsTxt stops an endless robots.txt after one chunk and cancels it", async () => {
    const bodies: EndlessBody[] = [];
    fetchMock().mockImplementation(async () => endlessResponse(bodies));

    const started = Date.now();
    const result = await settleWithin(
      checkRobotsTxt("https://example.com"),
      3000,
    );

    expect(result).not.toBe(HUNG);
    expect(result).toEqual([]);
    // The check's own deadline is 5 s; a capped read is nowhere near it.
    expect(Date.now() - started).toBeLessThan(2000);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].pulls).toBeLessThanOrEqual(2);
    expect(bodies[0].cancelled).toBe(true);
  });

  it("the exposed-file probes, robots.txt and security.txt each stop after one chunk", async () => {
    const bodies: EndlessBody[] = [];
    fetchMock().mockImplementation(async () =>
      endlessResponse(bodies, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const started = Date.now();
    // "host" is the half that holds checkRobotsTxt, checkSecurityTxt and
    // checkExposedFiles; the page half is covered on its own below.
    const result = await settleWithin(
      checkLiveFetch("https://example.com/", "host"),
      4000,
    );

    expect(result).not.toBe(HUNG);
    expect(Date.now() - started).toBeLessThan(3000);
    // robots.txt, two security.txt locations and the exposed-file table.
    expect(bodies.length).toBeGreaterThan(10);
    for (const body of bodies) {
      expect(body.pulls).toBeLessThanOrEqual(2);
      expect(body.cancelled).toBe(true);
    }
  });

  it("the CSP nonce check releases its second response without reading it", async () => {
    const bodies: EndlessBody[] = [];
    let call = 0;
    fetchMock().mockImplementation(async () => {
      call++;
      const headers = {
        "content-security-policy": "script-src 'nonce-AAAAAAAAAAAAAAAA'",
      };
      if (call === 1) return new Response("<html></html>", { headers });
      return endlessResponse(bodies, { status: 200, headers });
    });

    const result = await settleWithin(
      checkCspNonceReuse("https://example.com/"),
      3000,
    );

    expect(result).not.toBe(HUNG);
    // Only the header was ever needed; the repeated nonce is still reported.
    expect((result as { title: string }[]).length).toBe(1);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].pulls).toBe(0);
    expect(bodies[0].cancelled).toBe(true);
  });
});

// ── MTA-STS: a redirect on the policy URL is a missing policy ──────────

const POLICY_URL = "https://mta-sts.example.com/.well-known/mta-sts.txt";
const GOOD_POLICY =
  "version: STSv1\nmode: enforce\nmx: mail.example.com\nmax_age: 1209600\n";

function publishMtaStsRecord() {
  dnsMock.resolveMx.mockResolvedValue([
    { exchange: "mail.example.com", priority: 10 },
  ]);
  dnsMock.resolveTxt.mockImplementation(async (name: string) => {
    if (name === "_mta-sts.example.com") return [["v=STSv1; id=20260101"]];
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  });
}

/** Everything that is not the policy URL is a DoH lookup with no answer. */
function answerPolicyWith(
  policy: (url: string, init?: RequestInit) => Promise<Response>,
) {
  fetchMock().mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.startsWith("https://mta-sts.example.com/"))
      return policy(url, init);
    return new Response("{}", { status: 200 });
  });
}

const titlesOf = (findings: { title: string }[]) =>
  findings.map((f) => f.title);

describe("the MTA-STS policy fetch does not follow redirects", () => {
  it("asks safeFetch not to follow redirects", async () => {
    publishMtaStsRecord();
    answerPolicyWith(async () => new Response(GOOD_POLICY, { status: 200 }));

    await checkDNSSecurity("example.com", "https://example.com");

    const policyCalls = safeFetchMock.mock.calls.filter(
      ([url]) => url === POLICY_URL,
    );
    expect(policyCalls.length).toBeGreaterThan(0);
    for (const [, init] of policyCalls) {
      expect(init?.redirect).toBe("error");
    }
  });

  it("reports the policy as missing when the policy URL redirects on the same host", async () => {
    publishMtaStsRecord();
    answerPolicyWith(async (url) =>
      url === POLICY_URL
        ? new Response(null, {
            status: 301,
            headers: { location: "/.well-known/mta-sts.txt/" },
          })
        : new Response(GOOD_POLICY, { status: 200 }),
    );

    const titles = titlesOf(
      await checkDNSSecurity("example.com", "https://example.com"),
    );

    expect(titles).toContain("MTA-STS Policy File Missing");
    expect(titles).not.toContain("MTA-STS Policy File Unreachable");
  });

  it("reports the policy as missing when safeFetch refuses the redirect", async () => {
    publishMtaStsRecord();
    answerPolicyWith(async () => new Response(GOOD_POLICY, { status: 200 }));
    safeFetchMock.mockImplementation(async (url, init) => {
      if (url === POLICY_URL) {
        throw Object.assign(new Error(`Redirect from ${POLICY_URL} refused.`), {
          name: "SafeFetchError",
          code: "redirect",
        });
      }
      return realSafeFetch(url, init);
    });

    const findings = await checkDNSSecurity(
      "example.com",
      "https://example.com",
    );
    const titles = titlesOf(findings);

    expect(titles).toContain("MTA-STS Policy File Missing");
    expect(titles).not.toContain("MTA-STS Policy File Unreachable");
    const missing = findings.find(
      (f) => f.title === "MTA-STS Policy File Missing",
    );
    expect(missing?.evidence).toMatch(/redirect/i);
  });

  it("reports the policy as missing when it redirects to another host", async () => {
    publishMtaStsRecord();
    answerPolicyWith(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.example.net/policy.txt" },
        }),
    );

    const titles = titlesOf(
      await checkDNSSecurity("example.com", "https://example.com"),
    );

    expect(titles).toContain("MTA-STS Policy File Missing");
    expect(titles).not.toContain("MTA-STS Policy File Unreachable");
  });

  it("still reports a connection failure as unreachable", async () => {
    publishMtaStsRecord();
    answerPolicyWith(async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      });
    });

    const titles = titlesOf(
      await checkDNSSecurity("example.com", "https://example.com"),
    );

    expect(titles).toContain("MTA-STS Policy File Unreachable");
    expect(titles).not.toContain("MTA-STS Policy File Missing");
  });

  it("reads an endless policy file up to its cap", async () => {
    publishMtaStsRecord();
    const bodies: EndlessBody[] = [];
    answerPolicyWith(async () => endlessResponse(bodies));

    const result = await settleWithin(
      checkDNSSecurity("example.com", "https://example.com"),
      4000,
    );

    expect(result).not.toBe(HUNG);
    expect(titlesOf(result as { title: string }[])).toContain(
      "MTA-STS Policy File Malformed",
    );
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body.pulls).toBeLessThanOrEqual(2);
      expect(body.cancelled).toBe(true);
    }
  });
});
