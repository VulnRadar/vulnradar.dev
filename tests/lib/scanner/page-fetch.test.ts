/**
 * readPage is the one unauthenticated GET of the scanned page that several
 * async checks share. Its request goes through safeFetch, mocked here, so what
 * is asserted is what the module decides: what it sends, what it keeps, and
 * that concurrent readers share one request.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "@/lib/scanner/safe-fetch";
import { readPage } from "@/lib/scanner/page-fetch";
import { SCANNER_UA, SCANNER_UA_PRODUCT } from "@/lib/scanner/user-agent";
import { userAgentOf } from "./_user-agent-of";

const safeFetchMock = vi.mocked(safeFetch);

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("readPage", () => {
  it("returns the status, headers and body of the page", async () => {
    safeFetchMock.mockResolvedValue(
      new Response("<html>hello</html>", {
        status: 200,
        headers: { "x-test": "1" },
      }),
    );
    const page = await readPage("https://example.com/");
    expect(page).toMatchObject({
      status: 200,
      ok: true,
      body: "<html>hello</html>",
    });
    expect(page?.headers.get("x-test")).toBe("1");
  });

  it("names the scanner in the User-Agent of its request", async () => {
    safeFetchMock.mockResolvedValue(new Response("ok"));
    await readPage("https://example.com/");

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/");
    expect(userAgentOf(init)).toBe(SCANNER_UA);
    expect(SCANNER_UA).toContain(SCANNER_UA_PRODUCT);
  });

  it("reports a non-2xx answer as a page that is not ok, rather than failing", async () => {
    safeFetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    const page = await readPage("https://example.com/");
    expect(page).toMatchObject({ status: 503, ok: false, body: "nope" });
  });

  it("keeps at most a million bytes of the body and says it cut it", async () => {
    safeFetchMock.mockResolvedValue(new Response("a".repeat(1_000_100)));
    const page = await readPage("https://example.com/");
    expect(page?.body).toHaveLength(1_000_000);
    expect(page?.truncated).toBe(true);
  });

  it("reports a body that fits as not truncated", async () => {
    safeFetchMock.mockResolvedValue(new Response("a".repeat(1_000_000)));
    const page = await readPage("https://example.com/");
    expect(page?.body).toHaveLength(1_000_000);
    expect(page?.truncated).toBe(false);
  });

  it("answers null when the page cannot be fetched at all", async () => {
    safeFetchMock.mockRejectedValue(new Error("blocked by the SSRF guard"));
    expect(await readPage("https://example.com/")).toBeNull();
  });

  it("shares one request between concurrent readers of a url, and none after it settles", async () => {
    let release!: () => void;
    safeFetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response("shared"));
        }),
    );

    const first = readPage("https://example.com/shared");
    const second = readPage("https://example.com/shared");
    expect(second).toBe(first);
    release();
    expect(await first).toMatchObject({ body: "shared" });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);

    // Nothing is cached across scans: once settled, the next read fetches.
    safeFetchMock.mockResolvedValueOnce(new Response("fresh"));
    expect(await readPage("https://example.com/shared")).toMatchObject({
      body: "fresh",
    });
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not share a request between different urls", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response("one"));
    safeFetchMock.mockResolvedValueOnce(new Response("two"));
    const [a, b] = await Promise.all([
      readPage("https://example.com/a"),
      readPage("https://example.com/b"),
    ]);
    expect(a?.body).toBe("one");
    expect(b?.body).toBe("two");
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });
});
