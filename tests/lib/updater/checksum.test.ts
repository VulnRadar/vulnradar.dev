import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  parseSha256Sums,
  sha256Hex,
  verifyChecksum,
} from "@/lib/updater/checksum";

function realSha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("sha256Hex", () => {
  it("matches node:crypto's own sha256 digest for the same buffer", () => {
    const buf = Buffer.from("vulnradar release contents", "utf8");
    expect(sha256Hex(buf)).toBe(realSha256(buf));
  });

  it("produces different digests for different content", () => {
    const a = sha256Hex(Buffer.from("a"));
    const b = sha256Hex(Buffer.from("b"));
    expect(a).not.toBe(b);
  });
});

describe("parseSha256Sums", () => {
  it("parses standard two-space GNU coreutils format", () => {
    const digest = realSha256(Buffer.from("hello"));
    const text = `${digest}  vulnradar-v3.1.0.tar.gz\n`;
    const map = parseSha256Sums(text);
    expect(map.get("vulnradar-v3.1.0.tar.gz")).toBe(digest);
  });

  it("parses binary-mode entries with a leading asterisk", () => {
    const digest = realSha256(Buffer.from("hello"));
    const text = `${digest} *vulnradar-v3.1.0.tar.gz\n`;
    const map = parseSha256Sums(text);
    expect(map.get("vulnradar-v3.1.0.tar.gz")).toBe(digest);
  });

  it("parses multiple entries, one per line", () => {
    const d1 = realSha256(Buffer.from("one"));
    const d2 = realSha256(Buffer.from("two"));
    const text = [
      `${d1}  vulnradar-v3.1.0.tar.gz`,
      `${d2}  sha256sums-companion.txt`,
      "",
    ].join("\n");
    const map = parseSha256Sums(text);
    expect(map.size).toBe(2);
    expect(map.get("vulnradar-v3.1.0.tar.gz")).toBe(d1);
    expect(map.get("sha256sums-companion.txt")).toBe(d2);
  });

  it("lowercases hex digests", () => {
    const digest = realSha256(Buffer.from("hello")).toUpperCase();
    const text = `${digest}  file.tar.gz\n`;
    const map = parseSha256Sums(text);
    expect(map.get("file.tar.gz")).toBe(digest.toLowerCase());
  });

  it("ignores blank lines and unparsable lines", () => {
    const digest = realSha256(Buffer.from("hello"));
    const text = `\n\n# not a real checksum line\n${digest}  real-file.tar.gz\n\n`;
    const map = parseSha256Sums(text);
    expect(map.size).toBe(1);
    expect(map.get("real-file.tar.gz")).toBe(digest);
  });

  it("returns an empty map for empty input", () => {
    expect(parseSha256Sums("").size).toBe(0);
  });
});

describe("verifyChecksum", () => {
  it("passes when the buffer's digest matches the checksums file", () => {
    const content = Buffer.from("the actual release tarball bytes");
    const digest = realSha256(content);
    const sums = `${digest}  vulnradar-v3.1.0.tar.gz\n`;
    const result = verifyChecksum(content, sums, "vulnradar-v3.1.0.tar.gz");
    expect(result.ok).toBe(true);
    expect(result.actual).toBe(digest);
    expect(result.expected).toBe(digest);
  });

  it("fails closed when the digest does not match (tampered content)", () => {
    const original = Buffer.from("the actual release tarball bytes");
    const digest = realSha256(original);
    const sums = `${digest}  vulnradar-v3.1.0.tar.gz\n`;
    const tampered = Buffer.from("a different, tampered payload");
    const result = verifyChecksum(tampered, sums, "vulnradar-v3.1.0.tar.gz");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/mismatch/i);
    expect(result.expected).toBe(digest);
    expect(result.actual).not.toBe(digest);
  });

  it("fails closed when the filename is missing from the checksums file", () => {
    const content = Buffer.from("bytes");
    const sums = `${realSha256(content)}  some-other-file.tar.gz\n`;
    const result = verifyChecksum(content, sums, "vulnradar-v3.1.0.tar.gz");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("fails closed on a completely empty checksums file", () => {
    const content = Buffer.from("bytes");
    const result = verifyChecksum(content, "", "vulnradar-v3.1.0.tar.gz");
    expect(result.ok).toBe(false);
  });
});
