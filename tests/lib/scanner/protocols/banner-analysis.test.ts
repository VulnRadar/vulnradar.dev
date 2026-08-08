/**
 * Tests for the pure banner-analysis helpers added alongside the
 * expanded service-probe support: SSH version/protocol-1 assessment,
 * STARTTLS detection for SMTP/IMAP/POP3, and the Redis/Memcached
 * unauthenticated-access interpreters. None of these touch the network —
 * they operate on banner text already captured by grabBanner /
 * grabCapabilityBanner, so no socket mocking is needed here (see
 * banner-tls-and-capability.test.ts and mongo-probe.test.ts for the
 * network-boundary tests).
 */
import { describe, it, expect } from "vitest";
import {
  assessSshBanner,
  detectStartTls,
  isRedisPingUnauthenticated,
  isMemcachedStatsUnauthenticated,
} from "@/lib/scanner/protocols/banner";

describe("assessSshBanner", () => {
  it("returns all-null/false for an unparseable banner", () => {
    expect(assessSshBanner("not an ssh banner\r\n")).toEqual({
      protocolVersion: null,
      softwareVersion: null,
      supportsProtocol1: false,
      knownVulnerable: false,
      vulnNote: null,
    });
  });

  it("flags SSH-1.99 (protocol-1 compatible) as supporting protocol 1", () => {
    const result = assessSshBanner("SSH-1.99-OpenSSH_3.9\r\n");
    expect(result.protocolVersion).toBe("1.99");
    expect(result.supportsProtocol1).toBe(true);
  });

  it("flags bare SSH-1.5 as supporting protocol 1", () => {
    const result = assessSshBanner("SSH-1.5-1.2.27\r\n");
    expect(result.supportsProtocol1).toBe(true);
  });

  it("does not flag SSH-2.0 as supporting protocol 1", () => {
    const result = assessSshBanner("SSH-2.0-OpenSSH_9.6\r\n");
    expect(result.supportsProtocol1).toBe(false);
  });

  it("matches ancient OpenSSH (pre-4.4) as known-vulnerable / EOL", () => {
    const result = assessSshBanner("SSH-1.99-OpenSSH_3.9\r\n");
    expect(result.knownVulnerable).toBe(true);
    expect(result.vulnNote).toMatch(/end-of-life/i);
  });

  it("matches the 4.4-6.6 OpenSSH range", () => {
    const result = assessSshBanner("SSH-2.0-OpenSSH_6.6\r\n");
    expect(result.knownVulnerable).toBe(true);
    expect(result.vulnNote).toMatch(/CVE-2015-5600/);
  });

  it("matches the 6.7-7.4 OpenSSH range", () => {
    const result = assessSshBanner("SSH-2.0-OpenSSH_7.2p2 Ubuntu-4\r\n");
    expect(result.knownVulnerable).toBe(true);
    expect(result.vulnNote).toMatch(/CVE-2016-10009/);
  });

  it("matches the 8.5-9.7 regreSSHion range", () => {
    const result = assessSshBanner("SSH-2.0-OpenSSH_9.6\r\n");
    expect(result.knownVulnerable).toBe(true);
    expect(result.vulnNote).toMatch(/CVE-2024-6387/);
  });

  it("does not flag a current, patched OpenSSH release", () => {
    const result = assessSshBanner("SSH-2.0-OpenSSH_9.9\r\n");
    expect(result.knownVulnerable).toBe(false);
    expect(result.vulnNote).toBeNull();
  });

  it("does not attempt a version-range match for non-OpenSSH software", () => {
    const result = assessSshBanner("SSH-2.0-dropbear_2020.81\r\n");
    expect(result.softwareVersion).toBe("dropbear_2020.81");
    expect(result.knownVulnerable).toBe(false);
  });
});

describe("detectStartTls: smtp", () => {
  it("detects STARTTLS offered in a multi-line EHLO response", () => {
    const capability =
      "220 mail.example.com ESMTP\r\n250-mail.example.com\r\n250-PIPELINING\r\n250 STARTTLS\r\n";
    const result = detectStartTls("smtp", capability);
    expect(result.offered).toBe(true);
  });

  it("flags plaintext auth allowed when STARTTLS is absent", () => {
    const capability =
      "220 mail.example.com ESMTP\r\n250-mail.example.com\r\n250 PIPELINING\r\n";
    const result = detectStartTls("smtp", capability);
    expect(result.offered).toBe(false);
    expect(result.plaintextAuthAllowed).toBe(true);
  });

  it("flags plaintext auth allowed when AUTH is advertised alongside STARTTLS in the same response", () => {
    const capability =
      "220 mail.example.com ESMTP\r\n250-mail.example.com\r\n250-STARTTLS\r\n250 AUTH LOGIN PLAIN\r\n";
    const result = detectStartTls("smtp", capability);
    expect(result.offered).toBe(true);
    expect(result.plaintextAuthAllowed).toBe(true);
  });

  it("does not flag plaintext auth when STARTTLS is offered and AUTH is not advertised pre-TLS", () => {
    const capability =
      "220 mail.example.com ESMTP\r\n250-mail.example.com\r\n250 STARTTLS\r\n";
    const result = detectStartTls("smtp", capability);
    expect(result.offered).toBe(true);
    expect(result.plaintextAuthAllowed).toBe(false);
  });
});

describe("detectStartTls: imap", () => {
  it("detects STARTTLS offered with LOGINDISABLED (hardened)", () => {
    const capability =
      "* OK IMAP4rev1 Server ready\r\n* CAPABILITY IMAP4rev1 STARTTLS LOGINDISABLED\r\nA1 OK CAPABILITY completed\r\n";
    const result = detectStartTls("imap", capability);
    expect(result.offered).toBe(true);
    expect(result.plaintextAuthAllowed).toBe(false);
  });

  it("detects STARTTLS offered without LOGINDISABLED (plaintext login still possible)", () => {
    const capability =
      "* OK IMAP4rev1 Server ready\r\n* CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN\r\nA1 OK CAPABILITY completed\r\n";
    const result = detectStartTls("imap", capability);
    expect(result.offered).toBe(true);
    expect(result.plaintextAuthAllowed).toBe(true);
  });

  it("flags plaintext auth allowed when STARTTLS is not offered at all", () => {
    const capability =
      "* OK IMAP4rev1 Server ready\r\n* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\nA1 OK CAPABILITY completed\r\n";
    const result = detectStartTls("imap", capability);
    expect(result.offered).toBe(false);
    expect(result.plaintextAuthAllowed).toBe(true);
  });
});

describe("detectStartTls: pop3", () => {
  it("detects STLS offered with USER capability present (plaintext login still possible)", () => {
    const capability =
      "+OK POP3 server ready\r\n+OK Capability list follows\r\nSTLS\r\nUSER\r\n.\r\n";
    const result = detectStartTls("pop3", capability);
    expect(result.offered).toBe(true);
    expect(result.plaintextAuthAllowed).toBe(true);
  });

  it("detects STLS offered without USER capability (login gated behind STLS)", () => {
    const capability =
      "+OK POP3 server ready\r\n+OK Capability list follows\r\nSTLS\r\n.\r\n";
    const result = detectStartTls("pop3", capability);
    expect(result.offered).toBe(true);
    expect(result.plaintextAuthAllowed).toBe(false);
  });

  it("flags plaintext auth allowed when STLS is not offered at all", () => {
    const capability =
      "+OK POP3 server ready\r\n+OK Capability list follows\r\nUSER\r\n.\r\n";
    const result = detectStartTls("pop3", capability);
    expect(result.offered).toBe(false);
    expect(result.plaintextAuthAllowed).toBe(true);
  });
});

describe("isRedisPingUnauthenticated", () => {
  it("returns true for a bare +PONG reply", () => {
    expect(isRedisPingUnauthenticated("+PONG\r\n")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isRedisPingUnauthenticated("+pong\r\n")).toBe(true);
  });

  it("returns false for a NOAUTH error reply", () => {
    expect(
      isRedisPingUnauthenticated("-NOAUTH Authentication required.\r\n"),
    ).toBe(false);
  });

  it("returns false for any other error reply", () => {
    expect(isRedisPingUnauthenticated("-ERR unknown command\r\n")).toBe(false);
  });

  it("returns false for an empty banner", () => {
    expect(isRedisPingUnauthenticated("")).toBe(false);
  });
});

describe("isMemcachedStatsUnauthenticated", () => {
  it("returns true when a STAT line comes back", () => {
    expect(isMemcachedStatsUnauthenticated("STAT pid 12345\r\n")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMemcachedStatsUnauthenticated("stat pid 12345\r\n")).toBe(true);
  });

  it("returns false for an ERROR reply", () => {
    expect(isMemcachedStatsUnauthenticated("ERROR\r\n")).toBe(false);
  });

  it("returns false for an empty banner", () => {
    expect(isMemcachedStatsUnauthenticated("")).toBe(false);
  });
});
