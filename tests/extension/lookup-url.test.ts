import { describe, expect, it } from "vitest";

import {
  carriesCredential,
  isPublicHostname,
  lookupUrl,
  withoutFragment,
} from "../../extension/src/lib/lookup-url";
import { httpsReferences } from "../../extension/src/lib/format";

/**
 * What the extension may send away about an address, and which addresses it
 * may act on unasked. Site Alerts looks up every page you open and auto-scan
 * sends the page to be scanned; before lookupUrl, both carried the tab's full
 * URL, so a password-reset link or an OAuth redirect left the browser the
 * moment its page loaded, and localhost addresses were sent only to be
 * rejected.
 */

describe("isPublicHostname", () => {
  it("accepts ordinary public hosts", () => {
    for (const host of [
      "example.com",
      "www.example.com",
      "a.b.c.example.co.uk",
      "xn--bcher-kva.example",
      "EXAMPLE.com",
      "example.com.",
    ]) {
      expect(isPublicHostname(host), host).toBe(true);
    }
  });

  it("rejects single-label names", () => {
    for (const host of ["localhost", "intranet", "router", "nas", ""]) {
      expect(isPublicHostname(host), host || "(empty)").toBe(false);
    }
  });

  it("rejects the private and reserved suffixes", () => {
    for (const host of [
      "app.localhost",
      "printer.local",
      "db.internal",
      "nas.lan",
      "site.test",
      "router.home.arpa",
      "home.arpa",
      "deep.sub.internal",
    ]) {
      expect(isPublicHostname(host), host).toBe(false);
    }
  });

  it("does not mistake a public host that merely contains a private word", () => {
    for (const host of [
      "local.example.com",
      "internal.example.com",
      "test.example.com",
      "mylocal.com",
      "lan.io",
    ]) {
      expect(isPublicHostname(host), host).toBe(true);
    }
  });

  it("rejects IPv4 literals in every notation the URL parser accepts", () => {
    for (const host of ["127.0.0.1", "192.168.1.1", "8.8.8.8", "10.0.0.1"]) {
      expect(isPublicHostname(host), host).toBe(false);
    }
    // The URL parser rewrites each of these to a dotted quad, but the predicate
    // is also handed raw hostnames, so it must not rely on that.
    for (const host of [
      "127.1",
      "0x7f.1",
      "2130706433",
      "0x7f000001",
      "1.2.3",
    ]) {
      expect(isPublicHostname(host), host).toBe(false);
    }
  });

  it("rejects IPv6 literals", () => {
    for (const host of ["[::1]", "::1", "[2001:db8::1]", "fe80::1"]) {
      expect(isPublicHostname(host), host).toBe(false);
    }
  });
});

describe("lookupUrl", () => {
  it("keeps origin and path and nothing else", () => {
    expect(lookupUrl("https://example.com/a/b?token=abc&x=1#frag")).toBe(
      "https://example.com/a/b",
    );
    expect(lookupUrl("https://example.com")).toBe("https://example.com/");
    expect(lookupUrl("http://example.com:8080/x?y=1")).toBe(
      "http://example.com:8080/x",
    );
  });

  it("drops userinfo", () => {
    expect(lookupUrl("https://user:secret@example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(lookupUrl("https://user@example.com/")).toBe("https://example.com/");
  });

  it("never lets a credential reach the output", () => {
    const url =
      "https://app.example.com/reset?token=abc123&email=a%40b.c#access_token=zzz";
    const out = lookupUrl(url);
    expect(out).toBe("https://app.example.com/reset");
    expect(out).not.toMatch(/abc123|zzz|email|token/);
  });

  it("returns null for anything that is not a public web address", () => {
    for (const url of [
      "http://localhost:3000/",
      "https://localhost/",
      "http://127.0.0.1/admin",
      "http://[::1]:8080/",
      "https://192.168.0.1/",
      "https://printer.local/",
      "https://wiki.internal/page",
      "http://nas.lan/",
      "https://app.test/",
      "https://router.home.arpa/",
      "https://intranet/",
      "chrome://extensions/",
      "about:blank",
      "file:///etc/passwd",
      "ftp://example.com/",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      expect(lookupUrl(url), url || "(empty)").toBeNull();
    }
  });

  it("is stable: looking up its own output returns it unchanged", () => {
    const once = lookupUrl("https://example.com/a?b=1#c");
    expect(lookupUrl(once!)).toBe(once);
  });
});

describe("carriesCredential", () => {
  it("flags query parameters named like credentials", () => {
    for (const name of [
      "token",
      "code",
      "key",
      "secret",
      "sig",
      "otp",
      "reset",
      "session",
      "access_token",
      "id_token",
      "api_key",
      "apiKey",
      "accessToken",
      "reset-token",
      "X-Amz-Signature",
      "TOKEN",
      // Run-together and framework names a word split never sees.
      "apikey",
      "accesstoken",
      "sessionid",
      "PHPSESSID",
      "jsessionid",
      "jwt",
      "auth",
      "x-auth",
      "authorization",
      "ticket",
      "secretkey",
      "passwd",
    ]) {
      expect(
        carriesCredential(`https://example.com/p?${name}=value`),
        name,
      ).toBe(true);
    }
  });

  it("flags userinfo", () => {
    expect(carriesCredential("https://user:pass@example.com/")).toBe(true);
    expect(carriesCredential("https://user@example.com/")).toBe(true);
  });

  it("leaves ordinary query strings alone", () => {
    for (const url of [
      "https://example.com/",
      "https://example.com/search?q=cats",
      "https://example.com/?page=2&sort=asc",
      "https://example.com/p?keyword=shoes",
      "https://example.com/p?monkey=1",
      "https://example.com/p?lang=en",
      "https://example.com/p?author=5",
      "https://example.com/p?zipcode=90210",
      "https://example.com/p?passage=3",
    ]) {
      expect(carriesCredential(url), url).toBe(false);
    }
  });

  it("does not throw on a string that is not a URL", () => {
    expect(carriesCredential("not a url")).toBe(false);
  });
});

describe("withoutFragment", () => {
  it("removes the fragment and keeps everything before it", () => {
    expect(withoutFragment("https://example.com/a?b=1#c")).toBe(
      "https://example.com/a?b=1",
    );
    expect(withoutFragment("https://example.com/#access_token=zzz")).toBe(
      "https://example.com/",
    );
  });

  it("returns an unparsable string unchanged", () => {
    expect(withoutFragment("not a url")).toBe("not a url");
  });
});

describe("httpsReferences", () => {
  it("keeps https links only, before cutting to the limit", () => {
    const refs = [
      "javascript:alert(1)",
      "http://insecure.example/a",
      "data:text/html,<script>1</script>",
      "https://one.example/a",
      "https://two.example/b",
      "https://three.example/c",
      "https://four.example/d",
      "https://five.example/e",
    ];
    // The three unusable links at the front must not use up slots.
    expect(httpsReferences(refs, 4)).toEqual([
      "https://one.example/a",
      "https://two.example/b",
      "https://three.example/c",
      "https://four.example/d",
    ]);
  });

  it("copes with a missing list and a malformed entry", () => {
    expect(httpsReferences(undefined, 4)).toEqual([]);
    expect(httpsReferences(["not a url", "https://ok.example/"], 4)).toEqual([
      "https://ok.example/",
    ]);
  });
});
