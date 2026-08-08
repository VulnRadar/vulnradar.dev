/**
 * lib/scanner/protocols/ftp.ts does no network I/O of its own — it takes a
 * URL string and returns findings. No network/DB boundary exists here, so
 * these tests call the real functions directly with real inputs.
 */
import { describe, it, expect } from "vitest";
import {
  runFtpChecks,
  isFtpCheck,
  getFtpCategories,
  FTP_CHECK_IDS,
  FTP_CATEGORIES,
} from "@/lib/scanner/protocols/ftp";

describe("runFtpChecks", () => {
  it("flags plain ftp:// as an insecure connection", () => {
    const findings = runFtpChecks("ftp://files.example.com/");
    const insecure = findings.find(
      (f) => f.id.split("--")[0] === "ftp-insecure-connection",
    );
    expect(insecure).toBeDefined();
    expect(insecure?.severity).toBe("critical");
    expect(insecure?.category).toBe("ssl");
    expect(insecure?.evidence).toBe("Protocol: ftp://");
  });

  it("does not flag ftps:// as insecure", () => {
    const findings = runFtpChecks("ftps://files.example.com/");
    const insecure = findings.find(
      (f) => f.id.split("--")[0] === "ftp-insecure-connection",
    );
    expect(insecure).toBeUndefined();
  });

  it("always includes the limited-scan informational note, for both ftp and ftps", () => {
    for (const url of [
      "ftp://files.example.com/",
      "ftps://files.example.com/",
    ]) {
      const findings = runFtpChecks(url);
      const note = findings.find(
        (f) => f.id.split("--")[0] === "ftp-limited-scan",
      );
      expect(note).toBeDefined();
      expect(note?.severity).toBe("info");
    }
  });

  it("evidence reflects the actual scheme used", () => {
    const findings = runFtpChecks("ftps://files.example.com/");
    const note = findings.find(
      (f) => f.id.split("--")[0] === "ftp-limited-scan",
    );
    expect(note?.evidence).toBe("Protocol: ftps://");
  });

  it("produces the same finding ids for the same URL (deterministic)", () => {
    const a = runFtpChecks("ftp://files.example.com/");
    const b = runFtpChecks("ftp://files.example.com/");
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
  });

  it("produces two findings for insecure ftp, one for ftps", () => {
    expect(runFtpChecks("ftp://x.com/")).toHaveLength(2);
    expect(runFtpChecks("ftps://x.com/")).toHaveLength(1);
  });
});

describe("isFtpCheck", () => {
  it("recognizes every declared FTP check id", () => {
    for (const id of FTP_CHECK_IDS) {
      expect(isFtpCheck(id)).toBe(true);
    }
  });

  it("rejects a check id from another protocol", () => {
    expect(isFtpCheck("hsts-missing")).toBe(false);
    expect(isFtpCheck("")).toBe(false);
  });
});

describe("getFtpCategories", () => {
  it("includes ssl for the secure (FTPS) variant", () => {
    expect(getFtpCategories(true)).toEqual(FTP_CATEGORIES);
    expect(getFtpCategories(true)).toContain("ssl");
  });

  it("excludes ssl for plain FTP", () => {
    const cats = getFtpCategories(false);
    expect(cats).not.toContain("ssl");
    expect(cats).toContain("configuration");
  });
});
