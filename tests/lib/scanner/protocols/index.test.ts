/**
 * lib/scanner/protocols/index.ts dispatches between the protocol handlers
 * (declarative config lookups + a big findings switch keyed off
 * getProtocolFromUrl's parsed protocol). It performs no network I/O and has
 * no timeout/refuse handling of its own — that behavior lives one layer
 * down in lib/scanner/protocols/banner.ts (grabBanner) and in
 * lib/scanner/execute-scan.ts, which call into this module for config, not
 * the other way around. These tests exercise the dispatch/config logic that
 * actually exists here directly, with real inputs.
 */
import { describe, it, expect } from "vitest";
import {
  PROTOCOL_CONFIGS,
  SCAN_PROTOCOLS,
  getProtocolFromUrl,
  getProtocolConfig,
  isCategoryApplicable,
  getApplicableCategories,
  supportsBodyScan,
  supportsHeaderScan,
  supportsCrawl,
  isHttpProtocol,
  getProtocolFindings,
  type SupportedProtocol,
} from "@/lib/scanner/protocols/index";

describe("getProtocolFromUrl", () => {
  it.each<[string, SupportedProtocol]>([
    ["https://example.com/", "https"],
    ["http://example.com/", "http"],
    ["wss://example.com/", "wss"],
    ["ws://example.com/", "ws"],
    ["ftps://example.com/", "ftps"],
    ["ftp://example.com/", "ftp"],
    ["ssh://example.com/", "ssh"],
    ["sftp://example.com/", "sftp"],
    ["smtp://example.com/", "smtp"],
    ["smtps://example.com/", "smtps"],
    ["imap://example.com/", "imap"],
    ["imaps://example.com/", "imaps"],
    ["pop3://example.com/", "pop3"],
    ["pop3s://example.com/", "pop3s"],
    ["mongodb://example.com/", "mongodb"],
  ])("maps %s to protocol %s", (url, expected) => {
    expect(getProtocolFromUrl(url)).toBe(expected);
  });

  it("falls back to https for a scheme not in PROTOCOL_CONFIGS", () => {
    expect(getProtocolFromUrl("gopher://example.com/")).toBe("https");
  });

  it("falls back to https for an unparseable URL", () => {
    expect(getProtocolFromUrl("not a url")).toBe("https");
  });
});

describe("getProtocolConfig / isCategoryApplicable / getApplicableCategories", () => {
  it("returns the exact config object for a protocol", () => {
    expect(getProtocolConfig("https")).toBe(PROTOCOL_CONFIGS.https);
    expect(getProtocolConfig("ftp")).toBe(PROTOCOL_CONFIGS.ftp);
  });

  it("isCategoryApplicable matches the protocol's declared categories", () => {
    expect(isCategoryApplicable("https", "dns")).toBe(true);
    expect(isCategoryApplicable("ftp", "dns")).toBe(false);
    expect(isCategoryApplicable("ws", "ssl")).toBe(false);
    expect(isCategoryApplicable("wss", "ssl")).toBe(true);
  });

  it("getApplicableCategories mirrors PROTOCOL_CONFIGS", () => {
    expect(getApplicableCategories("mongodb")).toEqual(
      PROTOCOL_CONFIGS.mongodb.categories,
    );
  });
});

describe("supportsBodyScan / supportsHeaderScan / supportsCrawl", () => {
  it("https supports body, headers, and crawl", () => {
    expect(supportsBodyScan("https")).toBe(true);
    expect(supportsHeaderScan("https")).toBe(true);
    expect(supportsCrawl("https")).toBe(true);
  });

  it("ftp supports none of body/headers/crawl", () => {
    expect(supportsBodyScan("ftp")).toBe(false);
    expect(supportsHeaderScan("ftp")).toBe(false);
    expect(supportsCrawl("ftp")).toBe(false);
  });

  it("wss supports headers but not body or crawl", () => {
    expect(supportsHeaderScan("wss")).toBe(true);
    expect(supportsBodyScan("wss")).toBe(false);
    expect(supportsCrawl("wss")).toBe(false);
  });
});

describe("isHttpProtocol", () => {
  it("is true only for https:// and http://", () => {
    expect(isHttpProtocol("https://")).toBe(true);
    expect(isHttpProtocol("http://")).toBe(true);
    expect(isHttpProtocol("ws://")).toBe(false);
    expect(isHttpProtocol("ftp://")).toBe(false);
  });
});

describe("SCAN_PROTOCOLS", () => {
  it("has one entry per PROTOCOL_CONFIGS member (https/http share the http family)", () => {
    const values = SCAN_PROTOCOLS.map((p) => p.value);
    expect(values).toContain("https://");
    expect(values).toContain("mongodb://");
    expect(new Set(values).size).toBe(values.length); // no duplicate scheme values
  });
});

describe("getProtocolFindings: dispatch by parsed protocol", () => {
  it("http:// produces the insecure-HTTP finding", () => {
    const findings = getProtocolFindings("http://example.com/");
    expect(findings.some((f) => f.id.startsWith("proto-http-insecure--"))).toBe(
      true,
    );
  });

  it("https:// produces no protocol-specific findings", () => {
    expect(getProtocolFindings("https://example.com/")).toEqual([]);
  });

  it("ws:// produces the insecure-WebSocket finding, wss:// does not", () => {
    expect(
      getProtocolFindings("ws://example.com/").some((f) =>
        f.id.startsWith("proto-ws-insecure--"),
      ),
    ).toBe(true);
    expect(
      getProtocolFindings("wss://example.com/").some((f) =>
        f.id.startsWith("proto-ws-insecure--"),
      ),
    ).toBe(false);
  });

  it("ftp:// produces the insecure-FTP finding (critical)", () => {
    const findings = getProtocolFindings("ftp://example.com/");
    const f = findings.find((x) => x.id.startsWith("proto-ftp-insecure--"));
    expect(f).toBeDefined();
    expect(f?.severity).toBe("critical");
  });

  it("ssh:// produces an informational service-detected finding", () => {
    const findings = getProtocolFindings("ssh://example.com/");
    const f = findings.find((x) => x.id.startsWith("proto-ssh-detected--"));
    expect(f).toBeDefined();
    expect(f?.severity).toBe("info");
  });

  it("smtp:// (plaintext) produces a high-severity plaintext finding; smtps:// does not", () => {
    expect(
      getProtocolFindings("smtp://example.com/").some((f) =>
        f.id.startsWith("proto-smtp-plaintext--"),
      ),
    ).toBe(true);
    expect(
      getProtocolFindings("smtps://example.com/").some((f) =>
        f.id.startsWith("proto-smtp-plaintext--"),
      ),
    ).toBe(false);
  });

  it("imap:// produces a plaintext finding; imaps:// does not", () => {
    expect(
      getProtocolFindings("imap://example.com/").some((f) =>
        f.id.startsWith("proto-imap-plaintext--"),
      ),
    ).toBe(true);
    expect(
      getProtocolFindings("imaps://example.com/").some((f) =>
        f.id.startsWith("proto-imap-plaintext--"),
      ),
    ).toBe(false);
  });

  it("pop3:// produces a plaintext finding; pop3s:// does not", () => {
    expect(
      getProtocolFindings("pop3://example.com/").some((f) =>
        f.id.startsWith("proto-pop3-plaintext--"),
      ),
    ).toBe(true);
    expect(
      getProtocolFindings("pop3s://example.com/").some((f) =>
        f.id.startsWith("proto-pop3-plaintext--"),
      ),
    ).toBe(false);
  });

  it("mongodb:// produces a medium-severity service-detected finding", () => {
    const findings = getProtocolFindings("mongodb://example.com/");
    const f = findings.find((x) => x.id.startsWith("proto-mongodb-detected--"));
    expect(f).toBeDefined();
    expect(f?.severity).toBe("medium");
  });

  it("an unparseable URL is treated as https and produces no findings", () => {
    expect(getProtocolFindings("not a url")).toEqual([]);
  });
});
