import { describe, it, expect } from "vitest";
import { loadsFrom, urlRefs } from "@/lib/scanner/checks/_url-hosts";

/**
 * urlRefs reads the host a browser would load from. The run of host
 * characters after "//" is that host only when the authority ends right
 * after it: one that keeps going (user info before an "@", a percent-encoded
 * or full-width dot) names some other host, which is the textbook way a
 * hostname check is made to accept https://trusted.example@evil.example/.
 *
 * Backslashes, the full-width stop and the escaped "@" are built from char
 * codes so the fixtures say exactly what the page bytes are.
 */
const BS = String.fromCharCode(92);
const FULLWIDTH_STOP = String.fromCharCode(0x3002);
const TAILWIND = [{ host: "cdn.tailwindcss.com" }];

function loads(body: string): boolean {
  return loadsFrom(urlRefs(body), TAILWIND);
}

describe("urlRefs: the host is where the authority ends", () => {
  const notTheHost: [string, string][] = [
    ["user info", "https://cdn.tailwindcss.com@evil.example/x.js"],
    [
      "user info after a port",
      "https://cdn.tailwindcss.com:443@evil.example/x.js",
    ],
    [
      "user info with a password",
      "https://cdn.tailwindcss.com:pw@evil.example/x.js",
    ],
    [
      "user info with a sub-delimiter",
      "https://cdn.tailwindcss.com;x@evil.example/x.js",
    ],
    [
      "a percent-encoded dot",
      "https://cdn.tailwindcss.com%2eevil.example/x.js",
    ],
    [
      "a full-width stop",
      `https://cdn.tailwindcss.com${FULLWIDTH_STOP}evil.example/x.js`,
    ],
    ["an underscore", "https://cdn.tailwindcss.com_evil.example/x.js"],
    [
      "a protocol-relative URL with user info",
      "//cdn.tailwindcss.com@evil.example/x.js",
    ],
  ];
  for (const [label, url] of notTheHost) {
    it(`does not read the vendor's host out of ${label}`, () => {
      expect(loads(`<script src="${url}"></script>`)).toBe(false);
    });
  }

  it("does not read it out of a JSON-escaped @ either", () => {
    const url = `https:${BS}/${BS}/cdn.tailwindcss.com${BS}u0040evil.example${BS}/x.js`;
    expect(loads(`<script>s.src="${url}";</script>`)).toBe(false);
  });

  const stillTheHost: [string, string][] = [
    ["a closing quote", `<script src="https://cdn.tailwindcss.com"></script>`],
    ["a path", `<script src="https://cdn.tailwindcss.com/3.4.16"></script>`],
    ["a port", `<script src="https://cdn.tailwindcss.com:443/x.js"></script>`],
    [
      "a query",
      `<script src="https://cdn.tailwindcss.com?plugins=forms"></script>`,
    ],
    [
      "a trailing root dot",
      `<script src="https://cdn.tailwindcss.com./x.js"></script>`,
    ],
    [
      "the end of an unquoted attribute",
      `<script src=https://cdn.tailwindcss.com></script>`,
    ],
    [
      "a space in an unquoted attribute",
      `<script src=https://cdn.tailwindcss.com defer></script>`,
    ],
    [
      "an escaped quote in a JSON string",
      `<script>x="{${BS}"src${BS}":${BS}"https://cdn.tailwindcss.com${BS}"}"</script>`,
    ],
    [
      "an entity-encoded quote",
      `<div data-x="{&quot;src&quot;:&quot;https://cdn.tailwindcss.com&quot;}"></div>`,
    ],
    ["the end of the body", "https://cdn.tailwindcss.com"],
  ];
  for (const [label, body] of stillTheHost) {
    it(`reads the vendor's host ending at ${label}`, () => {
      expect(loads(body)).toBe(true);
    });
  }
});

describe("urlRefs: a URL in another URL's query string belongs to it", () => {
  it("across a JSON-escaped ampersand, as Next.js writes its payloads", () => {
    const outer = `https:${BS}/${BS}/evil.example${BS}/r?a=1${BS}u0026u=https:${BS}/${BS}/cdn.tailwindcss.com${BS}/x.js`;
    const refs = urlRefs(`<script>self.__next_f.push([1,"${outer}"])</script>`);
    expect(refs.map((r) => r.host)).toEqual(["evil.example"]);
    expect(loadsFrom(refs, TAILWIND)).toBe(false);
  });

  it("after a backslash, which a browser reads as a slash", () => {
    expect(
      loads(
        `<script src="https://evil.example${BS}https://cdn.tailwindcss.com/x.js"></script>`,
      ),
    ).toBe(false);
    expect(
      loads(
        `<script src="https://evil.example/x?${BS}https://cdn.tailwindcss.com/x.js"></script>`,
      ),
    ).toBe(false);
  });
});
