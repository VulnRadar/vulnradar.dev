import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import {
  hashAuthToken,
  legacyHashAuthToken,
  authTokenHashCandidates,
} from "@/lib/auth/token-hash";

/**
 * The shared hasher for emailed single-use auth tokens (password reset and
 * email verification). Previously five copies of a raw sha256 one-liner
 * (AUDIT-002#secrets-03).
 */
const saved = {
  auth: process.env.AUTH_SECRET,
  key: process.env.API_KEY_ENCRYPTION_KEY,
};

beforeEach(() => {
  delete process.env.AUTH_SECRET;
  delete process.env.API_KEY_ENCRYPTION_KEY;
});

afterAll(() => {
  if (saved.auth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = saved.auth;
  if (saved.key === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = saved.key;
});

describe("hashAuthToken", () => {
  it("is a keyed HMAC, not the unkeyed digest, when a secret is configured", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    const token = "a-single-use-token";
    expect(hashAuthToken(token)).not.toBe(legacyHashAuthToken(token));
    expect(hashAuthToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same token and secret", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    expect(hashAuthToken("t")).toBe(hashAuthToken("t"));
  });

  it("changes with the secret, which is what makes it keyed", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    const withFirst = hashAuthToken("t");
    process.env.AUTH_SECRET = "d".repeat(32);
    expect(hashAuthToken("t")).not.toBe(withFirst);
  });

  it("falls back to API_KEY_ENCRYPTION_KEY when AUTH_SECRET is absent", () => {
    process.env.API_KEY_ENCRYPTION_KEY = "k".repeat(64);
    expect(hashAuthToken("t")).not.toBe(legacyHashAuthToken("t"));
  });

  // A deployment with neither variable set must keep working exactly as it
  // did rather than having password reset start throwing.
  it("degrades to the previous unkeyed digest when no secret is configured", () => {
    expect(hashAuthToken("t")).toBe(legacyHashAuthToken("t"));
    expect(hashAuthToken("t")).toBe(
      createHash("sha256").update("t").digest("hex"),
    );
  });

  it("never returns the raw token", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    const token = "plaintext-token-value";
    expect(hashAuthToken(token)).not.toBe(token);
    expect(hashAuthToken(token)).not.toContain(token);
  });
});

describe("authTokenHashCandidates", () => {
  it("offers the new digest first and the pre-HMAC one as a fallback", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    const candidates = authTokenHashCandidates("t");
    expect(candidates).toEqual([hashAuthToken("t"), legacyHashAuthToken("t")]);
  });

  it("collapses to one entry when both derivations agree (no secret set)", () => {
    expect(authTokenHashCandidates("t")).toEqual([legacyHashAuthToken("t")]);
  });

  it("derives every candidate from the presented token, so it widens nothing", () => {
    process.env.AUTH_SECRET = "s".repeat(32);
    const mine = authTokenHashCandidates("my-token");
    const theirs = authTokenHashCandidates("someone-elses-token");
    for (const candidate of mine) {
      expect(theirs).not.toContain(candidate);
    }
  });
});
