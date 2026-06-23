import { describe, it, expect } from "vitest";
import { isPrivateIP } from "./safe-fetch";

describe("isPrivateIP IPv6 canonicalization", () => {
  // Regression: audit found that non-canonical IPv6 representations of
  // private ranges (long expanded form, hex-encoded embedded IPv4, RFC 6052
  // NAT64 prefix) bypassed the regex-based private-range checks because the
  // patterns only matched dotted-form ::ffff:X.X.X.X.
  it.each([
    // IPv4-mapped loopback (dotted, hex-encoded, long expanded, with extras)
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:7f00:0001",
    "0:0:0:0:0:ffff:127.0.0.1",
    "0000:0000:0000:0000:0000:ffff:7f00:0001",
    // RFC 6052 NAT64 prefix with hex-encoded embedded IPv4
    "64:ff9b::7f00:1",
    // IPv4-mapped private A (10.0.0.0/8)
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    // IPv4-mapped private B (172.16.0.0/12)
    "::ffff:172.16.0.1",
    "::ffff:ac10:1",
    // IPv4-mapped private C (192.168.0.0/16)
    "::ffff:192.168.1.1",
    "::ffff:c0a8:101",
    // IPv4-mapped link-local / cloud metadata (169.254.169.254)
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
  ])("blocks %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each([
    // Genuine public addresses must NOT match
    "2606:4700:4700::1111", // Cloudflare DNS
    "2001:4860:4860::8888", // Google DNS
    "::ffff:1.1.1.1", // Cloudflare IPv4-mapped public
  ])("allows public IPv6 %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(false);
  });

  it("still blocks IPv4 private ranges", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
    expect(isPrivateIP("10.0.0.1")).toBe(true);
    expect(isPrivateIP("192.168.1.1")).toBe(true);
    expect(isPrivateIP("169.254.169.254")).toBe(true);
  });
});
