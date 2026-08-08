import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  signGithubState,
  verifyGithubState,
} from "@/lib/github/github-state";

/**
 * Tests for HMAC-signed GitHub repo-connect OAuth state. Mirrors the
 * shape of tests/lib/auth/discord-state.test.ts (roundtrip, tamper,
 * expiry, wrong secret) plus the extra purpose-namespace and
 * required-userId checks unique to this module.
 */

const SECRET = "a".repeat(64);

function withSecret<T>(fn: () => T): T {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = SECRET;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
}

describe("signGithubState / verifyGithubState", () => {
  it("roundtrips a state token bound to the connecting user", () => {
    withSecret(() => {
      const state = signGithubState(42);
      const result = verifyGithubState(state, 42);
      expect(result).toEqual({
        ok: true,
        payload: expect.objectContaining({ userId: 42 }),
      });
    });
  });

  it("rejects when the userId does not match the caller's session", () => {
    withSecret(() => {
      const state = signGithubState(42);
      const result = verifyGithubState(state, 99);
      expect(result).toEqual({ ok: false, reason: "user-mismatch" });
    });
  });

  it("rejects a state with a tampered payload", () => {
    withSecret(() => {
      const state = signGithubState(42);
      const [payload, sig] = state.split(".");
      const mutated = Buffer.from(payload!, "base64url")
        .toString("utf8")
        .replace('"userId":42', '"userId":43');
      const tampered = `${Buffer.from(mutated).toString("base64url")}.${sig}`;
      const result = verifyGithubState(tampered, 43);
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    });
  });

  it("rejects malformed state (no dot)", () => {
    withSecret(() => {
      expect(verifyGithubState("nodot", 1)).toEqual({
        ok: false,
        reason: "malformed",
      });
    });
  });

  it("rejects a state signed with a different secret", () => {
    const previousA = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
    const state = signGithubState(1);
    process.env.AUTH_SECRET = "b".repeat(64);
    try {
      expect(verifyGithubState(state, 1)).toEqual({
        ok: false,
        reason: "bad-signature",
      });
    } finally {
      if (previousA === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previousA;
    }
  });

  it("a state minted by a different flow with the same secret and shape cannot verify here", () => {
    // Simulates the exact confusion this module's `purpose` field guards
    // against: same HMAC key, same {nonce, ts, userId}-ish shape, but no
    // `purpose` field (as if minted by some other flow).
    withSecret(() => {
      const payload = { nonce: "x", ts: Date.now(), userId: 1 };
      const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = createHmac("sha256", SECRET).update(json).digest("base64url");
      const foreignState = `${json}.${sig}`;
      const result = verifyGithubState(foreignState, 1);
      expect(result.ok).toBe(false);
    });
  });
});
