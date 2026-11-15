import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  NEXT_THEMES_CALL,
  checkPageScripts,
  cspNonce,
  headerValues,
  request,
  staticAssets,
} from "../../../scripts/ci/next16-runtime-probes.mjs";

/**
 * The Self-host job's runtime probes (scripts/ci/next16-runtime-probes.mjs).
 *
 * CI runs them against the booted image. Here the page check runs against
 * synthetic pages, one per way a page can be wrong, so a probe that would
 * pass a broken page, or fail a correct one, fails here first. The transport
 * runs against a local server, because the escaped-prefix probes only mean
 * something if the path reaches the app exactly as written.
 */

const NONCE = "bm9uY2UtZm9yLXRlc3Rz";
const CSP = `default-src 'self'; script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`;
const THEME_SCRIPT = `<script>((e,t)=>{})${NEXT_THEMES_CALL}`;

function page(...scripts: string[]): string {
  return `<!DOCTYPE html><html><head>${scripts.join("")}</head><body></body></html>`;
}

const nonced = (body = "") => `<script nonce="${NONCE}">${body}</script>`;
const external = `<script src="/_next/static/chunks/main.js" async="" nonce="${NONCE}"></script>`;

describe("the nonce check", () => {
  it("reads the nonce out of the CSP header", () => {
    expect(cspNonce(CSP)).toBe(NONCE);
    expect(cspNonce("default-src 'self'")).toBeNull();
    expect(cspNonce(undefined)).toBeNull();
  });

  it("passes a page whose scripts all carry the header nonce, plus the theme script", () => {
    const result = checkPageScripts(
      page(nonced("self.__next_f=[]"), external, THEME_SCRIPT),
      CSP,
    );
    expect(result).toEqual({
      ok: true,
      message: "3 scripts, all but 1 next-themes script carry the header nonce",
    });
  });

  it("passes a page without the theme script", () => {
    expect(checkPageScripts(page(nonced(), external), CSP).ok).toBe(true);
  });

  it("ignores JSON data blocks, which never execute", () => {
    const html = page(
      nonced(),
      '<script type="application/ld+json">{}</script>',
      '<script type="application/json" id="data">{}</script>',
    );
    expect(checkPageScripts(html, CSP).ok).toBe(true);
  });

  it("fails a bare script that is not the theme script", () => {
    const result = checkPageScripts(
      page(nonced(), THEME_SCRIPT, "<script>alert(1)</script>"),
      CSP,
    );
    expect(result).toEqual({
      ok: false,
      message: "2 bare script tags, 1 of them the next-themes script",
    });
  });

  it("reads script tags and attributes in any case", () => {
    expect(
      checkPageScripts(page(nonced(), "<SCRIPT>alert(1)</SCRIPT>"), CSP),
    ).toEqual({
      ok: false,
      message: "1 bare script tags, 0 of them the next-themes script",
    });
    const unnonced = checkPageScripts(
      page(nonced(), '<Script SRC="/_next/static/chunks/x.js"></Script>'),
      CSP,
    );
    expect(unnonced.ok).toBe(false);
    expect(unnonced.message).toMatch(/^1 scripts carry no nonce/);
    expect(
      checkPageScripts(
        page(nonced(), `<SCRIPT NONCE="${NONCE}" src="/a.js"></SCRIPT>`),
        CSP,
      ).ok,
    ).toBe(true);
    expect(
      checkPageScripts(
        page(nonced(), '<script TYPE="APPLICATION/JSON">{}</script>'),
        CSP,
      ).ok,
    ).toBe(true);
  });

  it("fails a script with attributes but no nonce", () => {
    const result = checkPageScripts(
      page(
        nonced(),
        '<script src="/_next/static/chunks/x.js" async=""></script>',
      ),
      CSP,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^1 scripts carry no nonce/);
  });

  it("fails a script whose nonce is not the header's", () => {
    const result = checkPageScripts(
      page(nonced(), '<script nonce="c3RhbGU=">x</script>'),
      CSP,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^script nonces differ from the header/);
  });

  it("fails a page with no nonce in its header, or no scripts at all", () => {
    expect(checkPageScripts(page(nonced()), "default-src 'self'")).toEqual({
      ok: false,
      message: "no nonce in the CSP header",
    });
    expect(checkPageScripts(page(), CSP)).toEqual({
      ok: false,
      message: "no script tags to check",
    });
  });

  it("allows the theme script once, not twice", () => {
    const result = checkPageScripts(
      page(nonced(), THEME_SCRIPT, THEME_SCRIPT),
      CSP,
    );
    expect(result.ok).toBe(false);
  });
});

describe("the static asset list", () => {
  it("names each /_next/static URL a page links once", () => {
    const html =
      '<link rel="stylesheet" href="/_next/static/chunks/a.css"/>' +
      '<script src="/_next/static/chunks/b.js?x=1&amp;y=2" nonce="n"></script>' +
      '<script src="/_next/static/chunks/b.js?x=1&amp;y=2" nonce="n"></script>' +
      '<img src="/logo.png"/>';
    expect(staticAssets(html)).toEqual([
      "/_next/static/chunks/a.css",
      "/_next/static/chunks/b.js?x=1&y=2",
    ]);
  });
});

describe("the probe transport", () => {
  let server: http.Server;
  let base = "";
  const seen: {
    method?: string;
    url?: string;
    headers: http.IncomingHttpHeaders;
  }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      res.setHeader("Cross-Origin-Resource-Policy", [
        "same-origin",
        "cross-origin",
      ]);
      res.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("sends escaped paths exactly as written", async () => {
    for (const path of [
      "/api/v3/x/%2e%2e/scan",
      "/%61pi/v3/scan",
      "/api%2Fv3%2Fhealth",
    ]) {
      await request(base, { method: "POST", path, body: "{}" });
      expect(seen.at(-1)?.url).toBe(path);
    }
  });

  it("says the request arrived over TLS", async () => {
    await request(base, { path: "/landing" });
    expect(seen.at(-1)?.headers["x-forwarded-proto"]).toBe("https");
  });

  it("sends the declared Content-Length, not the body's", async () => {
    await request(base, {
      method: "POST",
      path: "/%61pi/v3/scan",
      headers: { "Content-Length": "2000000" },
      body: "{}",
    });
    expect(seen.at(-1)?.headers["content-length"]).toBe("2000000");
  });

  it("counts a header that appears twice", async () => {
    const res = await request(base, { path: "/" });
    expect(headerValues(res, "cross-origin-resource-policy")).toEqual([
      "same-origin",
      "cross-origin",
    ]);
  });
});
