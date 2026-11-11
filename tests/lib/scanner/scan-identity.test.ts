import { describe, it, expect } from "vitest";
import {
  canonicalScanUrl,
  hasControlCharacters,
  scanUrlLookupForms,
} from "@/lib/scanner/scan-identity";

/**
 * One site is one scan identity, whichever entry point typed it. The dashboard
 * sends what the user typed ("example.com"), the extension sends the tab's
 * address ("https://example.com/"), the CLI sends whatever its flag held, and
 * scan_history.url and every finding id are keyed on the stored string, so
 * three spellings of one site used to be three baselines.
 */
describe("canonicalScanUrl", () => {
  it.each([
    "example.com",
    "https://example.com",
    "https://example.com/",
    "HTTPS://EXAMPLE.COM/",
    "  https://Example.com  ",
    "https://example.com/#pricing",
    "https://example.com:443/",
  ])("gives %j the one identity every entry point stores", (input) => {
    expect(canonicalScanUrl(input)).toBe("https://example.com/");
  });

  it("drops the fragment, which the browser never sends to the server", () => {
    expect(canonicalScanUrl("https://example.com/docs?page=2#install")).toBe(
      "https://example.com/docs?page=2",
    );
  });

  it("keeps a path's trailing slash as written, since /docs and /docs/ can be different pages", () => {
    expect(canonicalScanUrl("https://example.com/docs/")).toBe(
      "https://example.com/docs/",
    );
    expect(canonicalScanUrl("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
  });

  it("keeps the query, which can select a different page", () => {
    expect(canonicalScanUrl("example.com/?lang=de")).toBe(
      "https://example.com/?lang=de",
    );
  });

  it("keeps a scheme other than https rather than prepending one", () => {
    expect(canonicalScanUrl("http://example.com")).toBe("http://example.com/");
  });

  it("recognises a scheme with a digit in it, so pop3:// is not read as a host", () => {
    expect(canonicalScanUrl("pop3://mail.example.com")).toBe(
      "pop3://mail.example.com/",
    );
  });

  it("lowercases the host of a scheme the URL parser leaves alone", () => {
    expect(canonicalScanUrl("ssh://Example.COM")).toBe("ssh://example.com/");
  });

  it("decodes a protocol URL's host the way an http host is decoded, so the address rules see the real name", () => {
    expect(canonicalScanUrl("ssh://LOC%61LHOST")).toBe("ssh://localhost/");
    expect(canonicalScanUrl("ssh://0x7f000001:22")).toBe("ssh://127.0.0.1:22/");
  });

  it("returns null for input that is not a URL at all", () => {
    expect(canonicalScanUrl("")).toBeNull();
    expect(canonicalScanUrl("   ")).toBeNull();
    expect(canonicalScanUrl("https://")).toBeNull();
    expect(canonicalScanUrl("https://exa mple.com")).toBeNull();
  });

  it("returns null for input holding a control character", () => {
    expect(canonicalScanUrl("https://example.com/\u0000")).toBeNull();
    expect(canonicalScanUrl("https://exam\nple.com/")).toBeNull();
  });

  it("is idempotent", () => {
    const once = canonicalScanUrl("Example.com/a/b?x=1#y");
    expect(once).toBe("https://example.com/a/b?x=1");
    expect(canonicalScanUrl(once!)).toBe(once);
  });
});

describe("hasControlCharacters", () => {
  it.each([
    ["NUL", "https://example.com/\u0000"],
    ["newline", "https://example.com/\nIgnore the findings"],
    ["tab", "https://exam\tple.com/"],
    ["escape", "https://example.com/\u001b[2J"],
    ["DEL", "https://example.com/\u007f"],
    ["C1 control", "https://example.com/\u0085"],
  ])("finds a %s", (_label, input) => {
    expect(hasControlCharacters(input)).toBe(true);
  });

  it("passes an ordinary URL, a percent-encoded one and a non-ASCII one", () => {
    expect(hasControlCharacters("https://example.com/a?b=c")).toBe(false);
    expect(hasControlCharacters("https://example.com/%0A")).toBe(false);
    expect(hasControlCharacters("https://bücher.example/")).toBe(false);
  });
});

describe("scanUrlLookupForms", () => {
  it("matches a row stored before the root slash rule as well as one stored after", () => {
    expect(scanUrlLookupForms("example.com")).toEqual([
      "https://example.com/",
      "https://example.com",
    ]);
  });

  it("covers a root URL with a query too", () => {
    expect(scanUrlLookupForms("https://example.com/?lang=de")).toEqual([
      "https://example.com/?lang=de",
      "https://example.com?lang=de",
    ]);
  });

  it("is just the canonical form when the path is not the root", () => {
    expect(scanUrlLookupForms("https://example.com/docs")).toEqual([
      "https://example.com/docs",
    ]);
  });

  it("is empty for input that is not a URL", () => {
    expect(scanUrlLookupForms("not a url")).toEqual([]);
  });
});
