import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveTxt = vi.fn();
vi.mock("dns/promises", () => ({
  resolveTxt: (...args: unknown[]) => mockResolveTxt(...args),
}));

const {
  normalizeDomainInput,
  generateVerificationToken,
  verificationRecordName,
  verificationRecordValue,
  checkDnsVerification,
} = await import("@/lib/domains/verification");

beforeEach(() => {
  mockResolveTxt.mockReset();
});

describe("normalizeDomainInput", () => {
  it("accepts a bare domain", () => {
    expect(normalizeDomainInput("example.com")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("lowercases", () => {
    expect(normalizeDomainInput("Example.COM")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("strips a leading www.", () => {
    expect(normalizeDomainInput("www.example.com")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("extracts the hostname from a pasted full URL", () => {
    expect(
      normalizeDomainInput("https://app.example.com/dashboard?x=1"),
    ).toEqual({ ok: true, domain: "app.example.com" });
  });

  it("accepts a scheme-less input by assuming https", () => {
    expect(normalizeDomainInput("example.com/some/path")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("does NOT collapse a subdomain down to its registrable root", () => {
    // A caller who only controls blog.example.com must be able to verify
    // exactly that, not be forced into proving control of example.com.
    expect(normalizeDomainInput("blog.example.com")).toEqual({
      ok: true,
      domain: "blog.example.com",
    });
  });

  it("strips a trailing dot", () => {
    expect(normalizeDomainInput("example.com.")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("rejects empty input", () => {
    expect(normalizeDomainInput("   ").ok).toBe(false);
  });

  it("rejects a single-label input (no TLD)", () => {
    const result = normalizeDomainInput("localdomain");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/real domain/i);
  });

  it("rejects a bare IPv4 address", () => {
    const result = normalizeDomainInput("192.168.1.1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ip address/i);
  });

  it("rejects localhost and .internal/.local/.lan suffixes", () => {
    expect(normalizeDomainInput("localhost").ok).toBe(false);
    expect(normalizeDomainInput("printer.local").ok).toBe(false);
    expect(normalizeDomainInput("app.internal").ok).toBe(false);
    expect(normalizeDomainInput("nas.lan").ok).toBe(false);
  });

  it("rejects a label with invalid characters", () => {
    expect(normalizeDomainInput("exa mple.com").ok).toBe(false);
    expect(normalizeDomainInput("exa_mple.com").ok).toBe(false);
  });

  it("rejects a label starting or ending with a hyphen", () => {
    expect(normalizeDomainInput("-example.com").ok).toBe(false);
    expect(normalizeDomainInput("example-.com").ok).toBe(false);
  });

  it("rejects a domain longer than 253 characters", () => {
    const long = "a".repeat(250) + ".com";
    expect(normalizeDomainInput(long).ok).toBe(false);
  });

  it("rejects an unparseable value", () => {
    expect(normalizeDomainInput("http://").ok).toBe(false);
  });
});

describe("generateVerificationToken", () => {
  it("generates a 64-char hex token", () => {
    const token = generateVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a distinct token on every call", () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a).not.toBe(b);
  });
});

describe("verificationRecordName / verificationRecordValue", () => {
  it("builds the dedicated verification subdomain, not the apex", () => {
    expect(verificationRecordName("example.com")).toBe(
      "_vulnradar-verify.example.com",
    );
  });

  it("builds the expected TXT record value", () => {
    expect(verificationRecordValue("abc123")).toBe("vulnradar-verify=abc123");
  });
});

describe("checkDnsVerification", () => {
  it("verifies when a TXT record matches the token exactly", async () => {
    mockResolveTxt.mockResolvedValueOnce([["vulnradar-verify=abc123"]]);
    const result = await checkDnsVerification("example.com", "abc123");
    expect(result).toEqual({ verified: true });
    expect(mockResolveTxt).toHaveBeenCalledWith(
      "_vulnradar-verify.example.com",
    );
  });

  it("joins a multi-chunk TXT record before comparing", async () => {
    // DNS TXT records are split into <=255-byte chunks by the protocol;
    // resolveTxt returns each record as an array of its chunks.
    mockResolveTxt.mockResolvedValueOnce([["vulnradar-verify=", "abc123"]]);
    const result = await checkDnsVerification("example.com", "abc123");
    expect(result.verified).toBe(true);
  });

  it("does not verify when the token doesn't match", async () => {
    mockResolveTxt.mockResolvedValueOnce([["vulnradar-verify=wrong-token"]]);
    const result = await checkDnsVerification("example.com", "abc123");
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/doesn't match/i);
  });

  it("ignores unrelated TXT records at the same name and still matches the right one", async () => {
    mockResolveTxt.mockResolvedValueOnce([
      ["v=spf1 include:_spf.example.com ~all"],
      ["vulnradar-verify=abc123"],
    ]);
    const result = await checkDnsVerification("example.com", "abc123");
    expect(result.verified).toBe(true);
  });

  it("fails with a clear message when no TXT record exists (ENODATA)", async () => {
    const err = new Error("queryTxt ENODATA _vulnradar-verify.example.com");
    mockResolveTxt.mockRejectedValueOnce(err);
    const result = await checkDnsVerification("example.com", "abc123");
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/no txt record found/i);
  });

  it("fails with a clear message when the domain doesn't resolve (ENOTFOUND)", async () => {
    const err = new Error("queryTxt ENOTFOUND _vulnradar-verify.example.com");
    mockResolveTxt.mockRejectedValueOnce(err);
    const result = await checkDnsVerification("example.com", "abc123");
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/no txt record found/i);
  });

  it("fails without throwing on an unexpected resolver error", async () => {
    mockResolveTxt.mockRejectedValueOnce(new Error("SERVFAIL"));
    const result = await checkDnsVerification("example.com", "abc123");
    expect(result.verified).toBe(false);
    expect(result.error).toContain("SERVFAIL");
  });
});
