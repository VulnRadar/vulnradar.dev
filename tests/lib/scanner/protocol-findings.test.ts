import { describe, it, expect } from "vitest";
import {
  buildVersionDisclosureFinding,
  buildSshFindings,
  buildStartTlsFindings,
  buildMongoAuthFindings,
} from "@/lib/scanner/protocol-findings";
import type {
  BannerResult,
  MongoAuthProbeResult,
} from "@/lib/scanner/protocols/banner";

/**
 * Coverage for the ssh/smtp/imap/pop3/mongodb finding builders. The banner
 * PARSER underneath (protocols/banner.ts) already has its own suites, so what
 * was untested here is the layer that decides whether a parsed banner becomes
 * a finding at all. Without these, a regression that dropped a builder would
 * make a protocol scan of a genuinely vulnerable host complete normally and
 * report clean, with nothing in the suite failing. ref: AUDIT-013#cov-15
 *
 * Every expected id below is hard-coded rather than recomputed from
 * generateId. That is deliberate: protocol-findings.ts's own header says the
 * checkId prefixes MUST stay stable because a finding's id is what makes two
 * scans of the same host diffable, and an assertion that recomputed the id
 * would follow a renamed prefix straight past the regression it exists to
 * catch. If one of these fails, the fix is almost never to update the string.
 */

const SSH_URL = "ssh://ssh.example.com:22";
const SMTP_URL = "smtp://mail.example.com:25";
const IMAP_URL = "imap://mail.example.com:143";
const POP3_URL = "pop3://mail.example.com:110";
const MONGO_URL = "mongodb://db.example.com:27017";

function banner(
  protocol: string,
  host: string,
  port: number,
  text: string,
): BannerResult {
  return { protocol, host, port, banner: text, secure: false };
}

describe("buildVersionDisclosureFinding", () => {
  it("reports the version an SSH banner discloses, at info severity", () => {
    const finding = buildVersionDisclosureFinding(
      "banner-version-ssh",
      "SSH service discloses version",
      banner("ssh", "ssh.example.com", 22, "SSH-2.0-OpenSSH_9.6p1 Debian-4"),
      SSH_URL,
    );
    expect(finding).not.toBeNull();
    expect(finding!.id).toBe("banner-version-ssh--sgxkem");
    expect(finding!.severity).toBe("info");
    expect(finding!.category).toBe("configuration");
    expect(finding!.evidence).toContain("OpenSSH_9.6p1");
  });

  it("returns null when the banner carries no version at all", () => {
    const finding = buildVersionDisclosureFinding(
      "banner-version-smtp",
      "SMTP service discloses version",
      banner("smtp", "mail.example.com", 25, "220 mail.example.com ESMTP"),
      SMTP_URL,
    );
    expect(finding).toBeNull();
  });

  it("truncates a hostile multi-kilobyte banner to 256 characters", () => {
    const finding = buildVersionDisclosureFinding(
      "banner-version-ssh",
      "SSH service discloses version",
      banner("ssh", "ssh.example.com", 22, `SSH-2.0-${"A".repeat(4000)}`),
      SSH_URL,
    );
    expect(finding!.evidence.length).toBe(256);
  });
});

describe("buildSshFindings", () => {
  it("flags protocol 1 support as high severity", () => {
    const findings = buildSshFindings(
      banner("ssh", "ssh.example.com", 22, "SSH-1.99-OpenSSH_9.6"),
      SSH_URL,
      "ssh.example.com",
    );
    const proto1 = findings.find((f) => f.title === "SSH Protocol 1 Supported");
    expect(proto1).toBeDefined();
    expect(proto1!.id).toBe("ssh-protocol1-ssh.example.com--sgxkem");
    expect(proto1!.severity).toBe("high");
  });

  it("flags a banner inside a known-vulnerable OpenSSH range, as a lead", () => {
    const findings = buildSshFindings(
      banner("ssh", "ssh.example.com", 22, "SSH-2.0-OpenSSH_7.2p2 Ubuntu-4"),
      SSH_URL,
      "ssh.example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("ssh-known-vulnerable-ssh.example.com--sgxkem");
    // Distributions backport fixes without bumping the reported version, so
    // this stays medium and the copy says "verify", not "confirmed".
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].explanation).toMatch(/backport/i);
  });

  it("produces nothing for a current, protocol-2-only server", () => {
    expect(
      buildSshFindings(
        banner("ssh", "ssh.example.com", 22, "SSH-2.0-OpenSSH_9.8p1"),
        SSH_URL,
        "ssh.example.com",
      ),
    ).toEqual([]);
  });

  it("produces nothing for a banner it cannot parse", () => {
    expect(
      buildSshFindings(
        banner("ssh", "ssh.example.com", 22, "not an ssh banner"),
        SSH_URL,
        "ssh.example.com",
      ),
    ).toEqual([]);
  });
});

describe("buildStartTlsFindings", () => {
  it("flags an SMTP server that never advertises STARTTLS", () => {
    const findings = buildStartTlsFindings(
      "smtp",
      banner(
        "smtp",
        "mail.example.com",
        25,
        "250-mail.example.com\r\n250-PIPELINING\r\n250 SIZE 10240000",
      ),
      SMTP_URL,
      "mail.example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("smtp-no-starttls-mail.example.com--dit90u");
    expect(findings[0].severity).toBe("high");
  });

  it("flags SMTP that offers STARTTLS but advertises AUTH before it", () => {
    const findings = buildStartTlsFindings(
      "smtp",
      banner(
        "smtp",
        "mail.example.com",
        25,
        "250-mail.example.com\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN",
      ),
      SMTP_URL,
      "mail.example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(
      "smtp-plaintext-auth-allowed-mail.example.com--dit90u",
    );
    expect(findings[0].severity).toBe("medium");
  });

  it("produces nothing for SMTP that offers STARTTLS and no pre-TLS AUTH", () => {
    expect(
      buildStartTlsFindings(
        "smtp",
        banner(
          "smtp",
          "mail.example.com",
          25,
          "250-mail.example.com\r\n250-PIPELINING\r\n250 STARTTLS",
        ),
        SMTP_URL,
        "mail.example.com",
      ),
    ).toEqual([]);
  });

  it("flags IMAP offering STARTTLS without LOGINDISABLED", () => {
    const findings = buildStartTlsFindings(
      "imap",
      banner(
        "imap",
        "mail.example.com",
        143,
        "* OK [CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN] Dovecot ready.",
      ),
      IMAP_URL,
      "mail.example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(
      "imap-plaintext-auth-allowed-mail.example.com--1ckpcgq",
    );
    expect(findings[0].explanation).toMatch(/LOGINDISABLED/);
  });

  it("produces nothing for IMAP that gates login behind STARTTLS", () => {
    expect(
      buildStartTlsFindings(
        "imap",
        banner(
          "imap",
          "mail.example.com",
          143,
          "* OK [CAPABILITY IMAP4rev1 LOGINDISABLED STARTTLS] Dovecot ready.",
        ),
        IMAP_URL,
        "mail.example.com",
      ),
    ).toEqual([]);
  });

  it("flags POP3 that offers STLS but still advertises USER", () => {
    const findings = buildStartTlsFindings(
      "pop3",
      banner(
        "pop3",
        "mail.example.com",
        110,
        "+OK Capability list follows\r\nSTLS\r\nUSER\r\n.",
      ),
      POP3_URL,
      "mail.example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(
      "pop3-plaintext-auth-allowed-mail.example.com--1h1qdcz",
    );
    expect(findings[0].explanation).toMatch(/CAPA/);
  });

  it("flags POP3 with no STLS at all as high severity", () => {
    const findings = buildStartTlsFindings(
      "pop3",
      banner(
        "pop3",
        "mail.example.com",
        110,
        "+OK Capability list follows\r\nUSER\r\nUIDL\r\n.",
      ),
      POP3_URL,
      "mail.example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("pop3-no-starttls-mail.example.com--1h1qdcz");
    expect(findings[0].severity).toBe("high");
  });
});

describe("buildMongoAuthFindings", () => {
  const probe = (
    unauthenticatedAccess: boolean | null,
    detail: string,
  ): MongoAuthProbeResult => ({
    reachable: true,
    unauthenticatedAccess,
    detail,
  });

  it("reports unauthenticated administrative access as critical", () => {
    const findings = buildMongoAuthFindings(
      probe(true, 'listDatabases returned ok:1 with databases ["admin","app"]'),
      MONGO_URL,
      "db.example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(
      "mongodb-unauthenticated-db.example.com--mxkvx5",
    );
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].title).toBe("MongoDB Allows Unauthenticated Access");
  });

  it("records the secure case as an info finding, not silence", () => {
    const findings = buildMongoAuthFindings(
      probe(false, "listDatabases rejected: not authorized on admin"),
      MONGO_URL,
      "db.example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("mongodb-auth-required-db.example.com--mxkvx5");
    expect(findings[0].severity).toBe("info");
    expect(findings[0].title).toBe("MongoDB Requires Authentication");
  });

  // An inconclusive probe must stay silent rather than claim either verdict:
  // reporting "requires authentication" from a probe that never completed
  // would be a check reporting clean when it did not actually run.
  it("produces nothing when the probe was inconclusive", () => {
    expect(
      buildMongoAuthFindings(
        probe(null, "connection closed before listDatabases completed"),
        MONGO_URL,
        "db.example.com",
      ),
    ).toEqual([]);
  });

  it("truncates a hostile probe detail to 500 characters", () => {
    const findings = buildMongoAuthFindings(
      probe(true, "x".repeat(4000)),
      MONGO_URL,
      "db.example.com",
    );
    expect(findings[0].evidence.length).toBe(500);
  });
});
