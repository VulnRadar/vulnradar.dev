import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { scanFormPrivacy } from "@/lib/scanner/scan-form-privacy";

describe("scanFormPrivacy", () => {
  it("never asks to publish a signed-in scan on an untouched public-default account", () => {
    expect(
      scanFormPrivacy({ hasLogin: true, chosen: false, keepPrivate: false }),
    ).toEqual({ keepPrivate: true, isPublic: undefined });
  });

  it("publishes a signed-in scan when the person turned the switch off themselves", () => {
    expect(
      scanFormPrivacy({ hasLogin: true, chosen: true, keepPrivate: false }),
    ).toEqual({ keepPrivate: false, isPublic: true });
  });

  it("keeps a signed-in scan private when the person left the switch on", () => {
    expect(
      scanFormPrivacy({ hasLogin: true, chosen: true, keepPrivate: true }),
    ).toEqual({ keepPrivate: true, isPublic: false });
  });

  it("follows the account default on a scan with no login", () => {
    expect(
      scanFormPrivacy({ hasLogin: false, chosen: false, keepPrivate: false }),
    ).toEqual({ keepPrivate: false, isPublic: true });
    expect(
      scanFormPrivacy({ hasLogin: false, chosen: false, keepPrivate: true }),
    ).toEqual({ keepPrivate: true, isPublic: false });
  });

  it("omits the field while the account default is unknown", () => {
    expect(
      scanFormPrivacy({ hasLogin: false, chosen: false, keepPrivate: null }),
    ).toEqual({ keepPrivate: null, isPublic: undefined });
  });

  it("is what the form sends and shows", () => {
    const form = readFileSync("components/scanner/scan-form.tsx", "utf8");
    expect(form).toContain("isPublic: privacy.isPublic,");
    expect(form).toContain("checked={privacy.keepPrivate ?? false}");
  });
});
