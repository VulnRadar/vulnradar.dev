/**
 * Tests for lib/scanner/checks/email.ts.
 *
 * The exported `detectors` map is a registry-coverage placeholder (see that
 * file's header): "email" is an async-only category, dispatched from
 * lib/scanner/async-checks.ts, so every entry is a `() => null` stub and the
 * whole map is asserted to stay that way.
 *
 * The `check*` functions beside it are real live probes over DNS and, for
 * MTA-STS, one HTTPS fetch. Each gets a case that fires and a realistic case
 * that legitimately does not, because the second is what keeps these off
 * correctly configured domains. The "lookup did not answer" case is asserted
 * separately wherever it exists: a failed query must never be read as a
 * missing record.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("dns/promises", () => ({
  resolveTxt: vi.fn(),
  resolveMx: vi.fn(),
}));

vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import * as dns from "dns/promises";
import { safeFetch } from "@/lib/scanner/safe-fetch";
import {
  detectors,
  checkSpfRecordQuality,
  checkDmarcReporting,
  checkDkimSelectorFlags,
  checkBimiVmc,
  checkMxIpLiteral,
  checkMtaStsPolicyContent,
} from "@/lib/scanner/checks/email";

const dnsMock = vi.mocked(dns);
const safeFetchMock = vi.mocked(safeFetch);

const URL_UNDER_TEST = "https://example.com";

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

/** Route resolveTxt by name so one mock can serve a whole scenario. */
function txtByName(map: Record<string, string[]>) {
  dnsMock.resolveTxt.mockImplementation(async (name: string) => {
    const records = map[name];
    if (!records) throw dnsError("ENODATA");
    return records.map((r) => [r]);
  });
}

function ids(findings: { id: string }[]): string[] {
  return findings.map((f) => f.id.split("--")[0]);
}

beforeEach(() => {
  dnsMock.resolveTxt.mockReset();
  dnsMock.resolveMx.mockReset();
  safeFetchMock.mockReset();
});

// ── Placeholder detector map ────────────────────────────────────────────

describe("detectors placeholder map", () => {
  const entries = Object.keys(detectors);

  it("exposes a stub for every email check id", () => {
    expect(entries.length).toBeGreaterThan(30);
  });

  it.each(entries)("%s returns null (async-only, never fires inline)", (id) => {
    expect(typeof detectors[id]).toBe("function");
    expect(detectors[id](URL_UNDER_TEST, new Headers(), "")).toBe(null);
  });
});

// ── SPF ─────────────────────────────────────────────────────────────────

describe("checkSpfRecordQuality", () => {
  it("flags two SPF records at the apex", async () => {
    txtByName({
      "example.com": [
        "v=spf1 include:_spf.google.com ~all",
        "v=spf1 include:sendgrid.net ~all",
      ],
    });
    const findings = await checkSpfRecordQuality("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toEqual(["email-spf-multiple-records"]);
    expect(findings[0].severity).toBe("medium");
  });

  it("does not judge the policy further once there are two records", async () => {
    // With two records there is no single policy to evaluate, and the
    // permerror is the finding. Reporting "no all mechanism" on top would be
    // describing a record that is not being applied.
    txtByName({
      "example.com": ["v=spf1 include:a.example", "v=spf1 include:b.example"],
    });
    const findings = await checkSpfRecordQuality("example.com", URL_UNDER_TEST);
    expect(findings).toHaveLength(1);
  });

  it("flags a record with no all mechanism and no redirect", async () => {
    txtByName({ "example.com": ["v=spf1 ip4:203.0.113.0/24"] });
    const findings = await checkSpfRecordQuality("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toContain("email-spf-all-mechanism-missing");
  });

  it("flags redirect= sitting alongside an all mechanism", async () => {
    txtByName({
      "example.com": ["v=spf1 ip4:203.0.113.1 -all redirect=_spf.example.net"],
    });
    const findings = await checkSpfRecordQuality("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toContain("email-spf-redirect-ignored-with-all");
  });

  it("does not flag redirect= used on its own, which is the supported form", async () => {
    txtByName({ "example.com": ["v=spf1 redirect=_spf.example.net"] });
    const findings = await checkSpfRecordQuality("example.com", URL_UNDER_TEST);
    expect(ids(findings)).not.toContain("email-spf-redirect-ignored-with-all");
    expect(ids(findings)).not.toContain("email-spf-all-mechanism-missing");
  });

  it("flags a macro mechanism", async () => {
    txtByName({ "example.com": ["v=spf1 exists:%{l}._spf.%{d} -all"] });
    const findings = await checkSpfRecordQuality("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toContain("email-spf-macro-mechanism");
    expect(findings[0].severity).toBe("info");
  });

  it("flags an include target that publishes no SPF record", async () => {
    txtByName({
      "example.com": ["v=spf1 include:_spf.retired-vendor.example -all"],
      "_spf.retired-vendor.example": ["v=verification=abc"],
    });
    const findings = await checkSpfRecordQuality("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toContain("email-spf-include-unresolvable");
  });

  it("does not flag an include target that does publish SPF", async () => {
    txtByName({
      "example.com": ["v=spf1 include:_spf.google.com -all"],
      "_spf.google.com": ["v=spf1 ip4:35.190.247.0/24 ~all"],
    });
    expect(await checkSpfRecordQuality("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });

  it("does not flag an include target whose lookup never answered", async () => {
    dnsMock.resolveTxt.mockImplementation(async (name: string) => {
      if (name === "example.com") return [["v=spf1 include:slow.example -all"]];
      throw new Error("timeout");
    });
    expect(await checkSpfRecordQuality("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });

  it("reports nothing when the domain publishes no SPF at all", async () => {
    txtByName({ "example.com": ["google-site-verification=abc"] });
    expect(await checkSpfRecordQuality("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });

  it("reports nothing on a well-configured record", async () => {
    txtByName({
      "example.com": ["v=spf1 include:_spf.google.com -all"],
      "_spf.google.com": ["v=spf1 ip4:35.190.247.0/24 ~all"],
    });
    expect(await checkSpfRecordQuality("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });
});

// ── DMARC ───────────────────────────────────────────────────────────────

describe("checkDmarcReporting", () => {
  it("flags two DMARC records", async () => {
    txtByName({
      "_dmarc.example.com": [
        "v=DMARC1; p=reject; rua=mailto:a@example.com",
        "v=DMARC1; p=none; rua=mailto:b@example.com",
      ],
    });
    const findings = await checkDmarcReporting("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toEqual(["email-dmarc-multiple-records"]);
  });

  it("flags a rua entry written without the mailto: scheme", async () => {
    txtByName({
      "_dmarc.example.com": ["v=DMARC1; p=none; rua=dmarc@example.com"],
    });
    const findings = await checkDmarcReporting("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toContain("email-dmarc-rua-invalid-uri");
  });

  it("flags an external rua destination with no authorization record", async () => {
    txtByName({
      "_dmarc.example.com": [
        "v=DMARC1; p=reject; rua=mailto:agg@analyzer.example",
      ],
      // example.com._report._dmarc.analyzer.example is deliberately absent
    });
    const findings = await checkDmarcReporting("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toContain("email-dmarc-rua-external-unauthorized");
  });

  it("does not flag an external destination that published the authorization record", async () => {
    txtByName({
      "_dmarc.example.com": [
        "v=DMARC1; p=reject; rua=mailto:agg@analyzer.example",
      ],
      "example.com._report._dmarc.analyzer.example": ["v=DMARC1"],
    });
    expect(await checkDmarcReporting("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });

  it("does not treat a same-domain rua address as external", async () => {
    txtByName({
      "_dmarc.example.com": [
        "v=DMARC1; p=reject; rua=mailto:dmarc@example.com",
      ],
    });
    expect(await checkDmarcReporting("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });

  it("reports nothing when there is no DMARC record", async () => {
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENODATA"));
    expect(await checkDmarcReporting("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });
});

// ── DKIM selector flags ─────────────────────────────────────────────────

describe("checkDkimSelectorFlags", () => {
  it("flags a selector left in testing mode", async () => {
    txtByName({
      "default._domainkey.example.com": [
        "v=DKIM1; k=rsa; t=y; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A",
      ],
    });
    const findings = await checkDkimSelectorFlags(
      "example.com",
      URL_UNDER_TEST,
    );
    expect(ids(findings)).toContain("email-dkim-testing-mode");
  });

  it("flags a selector whose key has been emptied (revoked)", async () => {
    txtByName({
      "selector1._domainkey.example.com": ["v=DKIM1; k=rsa; p="],
    });
    const findings = await checkDkimSelectorFlags(
      "example.com",
      URL_UNDER_TEST,
    );
    expect(ids(findings)).toContain("email-dkim-revoked-key");
  });

  it("flags a selector restricted to h=sha1", async () => {
    txtByName({
      "google._domainkey.example.com": [
        "v=DKIM1; k=rsa; h=sha1; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A",
      ],
    });
    const findings = await checkDkimSelectorFlags(
      "example.com",
      URL_UNDER_TEST,
    );
    expect(ids(findings)).toContain("email-dkim-sha1-hash");
  });

  it("does not flag h=sha256:sha1, where sha256 is still offered", async () => {
    txtByName({
      "google._domainkey.example.com": [
        "v=DKIM1; k=rsa; h=sha256:sha1; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A",
      ],
    });
    const findings = await checkDkimSelectorFlags(
      "example.com",
      URL_UNDER_TEST,
    );
    expect(ids(findings)).not.toContain("email-dkim-sha1-hash");
  });

  it("reports nothing for a healthy selector", async () => {
    txtByName({
      "default._domainkey.example.com": [
        "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA",
      ],
    });
    expect(await checkDkimSelectorFlags("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });

  it("reports nothing when no selector on the fixed list resolves", async () => {
    // Providers that mint a random selector per tenant cannot be enumerated
    // by a fixed list, and producing no finding is the honest outcome.
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    expect(await checkDkimSelectorFlags("example.com", URL_UNDER_TEST)).toEqual(
      [],
    );
  });
});

// ── BIMI ────────────────────────────────────────────────────────────────

describe("checkBimiVmc", () => {
  it("flags a BIMI record with a logo and no VMC", async () => {
    txtByName({
      "default._bimi.example.com": [
        "v=BIMI1; l=https://example.com/bimi/logo.svg",
      ],
    });
    const findings = await checkBimiVmc("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toEqual(["email-bimi-without-vmc"]);
    expect(findings[0].severity).toBe("info");
  });

  it("does not flag a BIMI record that carries an a= tag", async () => {
    txtByName({
      "default._bimi.example.com": [
        "v=BIMI1; l=https://example.com/bimi/logo.svg; a=https://example.com/bimi/vmc.pem",
      ],
    });
    expect(await checkBimiVmc("example.com", URL_UNDER_TEST)).toEqual([]);
  });

  it("reports nothing when the domain publishes no BIMI record", async () => {
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENODATA"));
    expect(await checkBimiVmc("example.com", URL_UNDER_TEST)).toEqual([]);
  });
});

// ── MX hygiene ──────────────────────────────────────────────────────────

describe("checkMxIpLiteral", () => {
  it("flags an MX record whose exchange is an address literal", async () => {
    dnsMock.resolveMx.mockResolvedValue([
      { exchange: "203.0.113.25", priority: 10 },
    ]);
    const findings = await checkMxIpLiteral("example.com", URL_UNDER_TEST);
    expect(ids(findings)).toEqual(["email-mx-ip-literal"]);
    expect(findings[0].evidence).toContain("203.0.113.25");
  });

  it("does not flag a normal hostname exchange", async () => {
    dnsMock.resolveMx.mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 },
    ]);
    expect(await checkMxIpLiteral("example.com", URL_UNDER_TEST)).toEqual([]);
  });

  it("reports nothing when the MX lookup fails", async () => {
    dnsMock.resolveMx.mockRejectedValue(new Error("timeout"));
    expect(await checkMxIpLiteral("example.com", URL_UNDER_TEST)).toEqual([]);
  });
});

// ── MTA-STS policy content ──────────────────────────────────────────────

function policyResponse(text: string, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    text: async () => text,
  } as unknown as Response;
}

describe("checkMtaStsPolicyContent", () => {
  it("flags a max_age below one week", async () => {
    txtByName({ "_mta-sts.example.com": ["v=STSv1; id=20260101000000Z"] });
    dnsMock.resolveMx.mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 },
    ]);
    safeFetchMock.mockResolvedValue(
      policyResponse(
        "version: STSv1\nmode: enforce\nmx: mail.example.com\nmax_age: 86400\n",
      ),
    );
    const findings = await checkMtaStsPolicyContent(
      "example.com",
      URL_UNDER_TEST,
    );
    expect(ids(findings)).toContain("email-mta-sts-max-age-short");
  });

  it("flags a policy that does not cover a published MX host", async () => {
    txtByName({ "_mta-sts.example.com": ["v=STSv1; id=20260101000000Z"] });
    dnsMock.resolveMx.mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 },
      { exchange: "mail2.example.com", priority: 20 },
    ]);
    safeFetchMock.mockResolvedValue(
      policyResponse(
        "version: STSv1\nmode: enforce\nmx: mail.example.com\nmax_age: 1209600\n",
      ),
    );
    const findings = await checkMtaStsPolicyContent(
      "example.com",
      URL_UNDER_TEST,
    );
    expect(ids(findings)).toEqual(["email-mta-sts-mx-mismatch"]);
    expect(findings[0].evidence).toContain("mail2.example.com");
  });

  it("accepts a wildcard mx entry that covers the published hosts", async () => {
    txtByName({ "_mta-sts.example.com": ["v=STSv1; id=20260101000000Z"] });
    dnsMock.resolveMx.mockResolvedValue([
      { exchange: "a.mail.example.com", priority: 10 },
      { exchange: "b.mail.example.com", priority: 20 },
    ]);
    safeFetchMock.mockResolvedValue(
      policyResponse(
        "version: STSv1\nmode: enforce\nmx: *.mail.example.com\nmax_age: 1209600\n",
      ),
    );
    expect(
      await checkMtaStsPolicyContent("example.com", URL_UNDER_TEST),
    ).toEqual([]);
  });

  it("reports nothing on a correct, settled policy", async () => {
    txtByName({ "_mta-sts.example.com": ["v=STSv1; id=20260101000000Z"] });
    dnsMock.resolveMx.mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 },
    ]);
    safeFetchMock.mockResolvedValue(
      policyResponse(
        "version: STSv1\nmode: enforce\nmx: mail.example.com\nmax_age: 1209600\n",
      ),
    );
    expect(
      await checkMtaStsPolicyContent("example.com", URL_UNDER_TEST),
    ).toEqual([]);
  });

  it("does not fetch anything when the domain publishes no MTA-STS record", async () => {
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENODATA"));
    expect(
      await checkMtaStsPolicyContent("example.com", URL_UNDER_TEST),
    ).toEqual([]);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("reports nothing when the policy file is unreachable (a different check's finding)", async () => {
    txtByName({ "_mta-sts.example.com": ["v=STSv1; id=20260101000000Z"] });
    safeFetchMock.mockResolvedValue(policyResponse("Not Found", false));
    expect(
      await checkMtaStsPolicyContent("example.com", URL_UNDER_TEST),
    ).toEqual([]);
  });
});
