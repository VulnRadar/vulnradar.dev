import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { redactPathTokens } from "@/lib/logging/redact-path";

/**
 * Two log lines name the route that threw (withErrorHandling and
 * onRequestError), and both used to quote the pathname whole. Some routes
 * carry their secret in the path, so the pathname has to be masked before it
 * goes into a table every error-log reader can open.
 */
describe("redactPathTokens", () => {
  it("masks a staff invite token, a raw 64-character hex string", () => {
    const token = randomBytes(32).toString("hex");

    expect(redactPathTokens(`/api/v3/auth/staff-invite/${token}`)).toBe(
      "/api/v3/auth/staff-invite/[redacted]",
    );
    expect(redactPathTokens(`/staff-invite/${token}`)).toBe(
      "/staff-invite/[redacted]",
    );
  });

  it("masks a base64url capability token, whatever its length", () => {
    const token = randomBytes(24).toString("base64url");

    expect(redactPathTokens(`/shared/${token}`)).toBe("/shared/[redacted]");
  });

  it("masks a UUID, which is also a bearer for some links", () => {
    expect(
      redactPathTokens("/badge/3f9a1c2e-1111-4222-8333-444455556666/svg"),
    ).toBe("/badge/[redacted]/svg");
  });

  it("leaves the numeric ids and short segments the log is for alone", () => {
    expect(redactPathTokens("/api/v3/scan/status/4812")).toBe(
      "/api/v3/scan/status/4812",
    );
    expect(redactPathTokens("/api/v3/admin/users/17/sessions")).toBe(
      "/api/v3/admin/users/17/sessions",
    );
  });

  it("leaves a hostname and a long lowercase slug alone", () => {
    expect(redactPathTokens("/host/example.com")).toBe("/host/example.com");
    expect(redactPathTokens("/checks/missing-content-security-policy")).toBe(
      "/checks/missing-content-security-policy",
    );
  });

  it("keeps the root and an empty path as they are", () => {
    expect(redactPathTokens("/")).toBe("/");
    expect(redactPathTokens("")).toBe("");
  });
});
