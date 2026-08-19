import { describe, it, expect } from "vitest";
import {
  computeSslGrade,
  type SslGradeInput,
} from "@/lib/scanner/ssl-grade";

/**
 * A modern, trusted, TLS 1.3 endpoint with a strong RSA 2048 key and a
 * modern AEAD cipher. Every test starts from this and overrides the one
 * signal it exercises, so a failure points at exactly that rule.
 */
function base(overrides: Partial<SslGradeInput> = {}): SslGradeInput {
  return {
    reachedTls: true,
    protocol: "TLSv1.3",
    authorized: true,
    keyBits: 2048,
    isEcKey: false,
    cipherName: "TLS_AES_128_GCM_SHA256",
    ...overrides,
  };
}

describe("computeSslGrade", () => {
  it("returns null when TLS was never reached (HTTP-only / unreachable)", () => {
    expect(computeSslGrade(base({ reachedTls: false }))).toBeNull();
  });

  it("grades a modern TLS 1.3 endpoint with a strong RSA key as A+", () => {
    const result = computeSslGrade(base());
    expect(result).not.toBeNull();
    expect(result!.grade).toBe("A+");
    expect(result!.score).toBe(100);
    expect(result!.reasons).toContain("TLS 1.3 supported");
  });

  it("grades a modern TLS 1.3 endpoint with an EC P-256 key as A+", () => {
    const result = computeSslGrade(
      base({ isEcKey: true, nistCurve: "P-256", keyBits: 256 }),
    );
    expect(result!.grade).toBe("A+");
  });

  it("caps a TLS 1.2-only endpoint at A (A+ requires TLS 1.3)", () => {
    const result = computeSslGrade(base({ protocol: "TLSv1.2" }));
    expect(result!.grade).toBe("A");
  });

  it("grades an obsolete TLS 1.0 endpoint as F (no TLS 1.2+)", () => {
    const result = computeSslGrade(base({ protocol: "TLSv1" }));
    expect(result!.grade).toBe("F");
  });

  it("caps an expired certificate at F even on TLS 1.3", () => {
    const result = computeSslGrade(base({ certExpired: true }));
    expect(result!.grade).toBe("F");
    expect(result!.score).toBe(0);
  });

  it("caps a self-signed certificate at F", () => {
    const result = computeSslGrade(base({ certSelfSigned: true }));
    expect(result!.grade).toBe("F");
  });

  it("caps a hostname mismatch at F", () => {
    const result = computeSslGrade(base({ hostnameMismatch: true }));
    expect(result!.grade).toBe("F");
  });

  it("caps a missing SAN at F (rejected by modern clients)", () => {
    const result = computeSslGrade(base({ missingSan: true }));
    expect(result!.grade).toBe("F");
  });

  it("caps an expired certificate in the chain at F", () => {
    const result = computeSslGrade(base({ chainHasExpiredCert: true }));
    expect(result!.grade).toBe("F");
  });

  it("treats an unauthorized cert with no classified reason as F", () => {
    const result = computeSslGrade(base({ authorized: false }));
    expect(result!.grade).toBe("F");
  });

  it("caps an incomplete chain at C, not an outright failure", () => {
    const result = computeSslGrade(
      base({ authorized: false, incompleteChain: true }),
    );
    expect(result!.grade).toBe("C");
  });

  it("penalizes a 1024-bit RSA key below A", () => {
    const result = computeSslGrade(base({ keyBits: 1024 }));
    expect(["B", "C", "D", "F"]).toContain(result!.grade);
  });

  it("fails a very weak 512-bit RSA key", () => {
    const result = computeSslGrade(base({ keyBits: 512 }));
    expect(result!.grade).toBe("F");
  });

  it("penalizes an EC curve below P-256 below A", () => {
    const result = computeSslGrade(
      base({ isEcKey: true, nistCurve: "P-192", keyBits: 192 }),
    );
    expect(["B", "C", "D", "F"]).toContain(result!.grade);
  });

  it("penalizes a weak RC4 cipher suite", () => {
    const result = computeSslGrade(
      base({ cipherName: "ECDHE-RSA-RC4-SHA" }),
    );
    expect(["C", "D", "F"]).toContain(result!.grade);
  });

  it("records OCSP stapling and HSTS as reasons when present", () => {
    const result = computeSslGrade(base({ ocspStapled: true, hstsEnabled: true }));
    expect(result!.grade).toBe("A+");
    expect(result!.reasons).toContain("OCSP stapling enabled");
    expect(result!.reasons).toContain("HSTS enabled");
  });

  it("always returns a non-empty reasons array explaining the grade", () => {
    const result = computeSslGrade(base());
    expect(Array.isArray(result!.reasons)).toBe(true);
    expect(result!.reasons.length).toBeGreaterThan(0);
  });
});
