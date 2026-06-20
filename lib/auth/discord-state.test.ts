import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  signDiscordState,
  verifyDiscordState,
  DISCORD_STATE_TTL_MS,
} from "@/lib/auth/discord-state";

/**
 * Phase 8C Commit 1 (C-4): tests for HMAC-signed Discord OAuth state.
 *
 * Verifies the round-trip, that tampered / malformed / expired states
 * are rejected, and that the wrong secret can't verify.
 */

const SECRET = "a".repeat(64);

function withSecret<T>(fn: () => T): T {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = SECRET;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previous;
    }
  }
}

describe("signDiscordState / verifyDiscordState", () => {
  it("roundtrips a state token", () => {
    withSecret(() => {
      const state = signDiscordState({ action: "link" });
      const result = verifyDiscordState(state);
      expect(result).toEqual({
        ok: true,
        payload: expect.objectContaining({ action: "link" }),
      });
    });
  });

  it("rejects a state with a tampered payload", () => {
    withSecret(() => {
      const state = signDiscordState({ action: "link" });
      const [payload, sig] = state.split(".");
      // Flip a byte in the base64url payload.
      const mutated = Buffer.from(payload!, "base64url")
        .toString("utf8")
        .replace("link", "LI NK");
      const tampered = `${Buffer.from(mutated).toString("base64url")}.${sig}`;
      const result = verifyDiscordState(tampered);
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    });
  });

  it("rejects a state with a tampered signature", () => {
    withSecret(() => {
      const state = signDiscordState({ action: "link" });
      const [payload, sig] = state.split(".");
      const tampered = `${payload}.${sig!.slice(0, -1)}A`;
      const result = verifyDiscordState(tampered);
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    });
  });

  it("rejects malformed state (no dot)", () => {
    withSecret(() => {
      expect(verifyDiscordState("nodot")).toEqual({
        ok: false,
        reason: "malformed",
      });
    });
  });

  it("rejects malformed state (empty signature)", () => {
    withSecret(() => {
      const state = signDiscordState({ action: "link" });
      const [payload] = state.split(".");
      expect(verifyDiscordState(`${payload}.`)).toEqual({
        ok: false,
        reason: "malformed",
      });
    });
  });

  it("rejects an expired state", () => {
    withSecret(() => {
      // Construct a state with a timestamp far in the past.
      const payload = JSON.stringify({
        nonce: "abc",
        action: "link",
        ts: Date.now() - DISCORD_STATE_TTL_MS - 1000,
      });
      const json = Buffer.from(payload).toString("base64url");
      const sig = createHmac("sha256", process.env.AUTH_SECRET!)
        .update(json)
        .digest("base64url");
      const state = `${json}.${sig}`;
      expect(verifyDiscordState(state)).toEqual({
        ok: false,
        reason: "expired",
      });
    });
  });

  it("rejects a state signed with a different secret", () => {
    const previousA = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
    const state = signDiscordState({ action: "link" });
    process.env.AUTH_SECRET = "b".repeat(64);
    try {
      const result = verifyDiscordState(state);
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    } finally {
      if (previousA === undefined) {
        delete process.env.AUTH_SECRET;
      } else {
        process.env.AUTH_SECRET = previousA;
      }
    }
  });
});

describe("signing without a secret throws (fail-closed)", () => {
  it("throws when neither AUTH_SECRET nor API_KEY_ENCRYPTION_KEY is set", () => {
    const prevAuth = process.env.AUTH_SECRET;
    const prevKey = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.AUTH_SECRET;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      expect(() => signDiscordState({ action: "link" })).toThrow(
        /AUTH_SECRET|API_KEY_ENCRYPTION_KEY/,
      );
    } finally {
      if (prevAuth !== undefined) process.env.AUTH_SECRET = prevAuth;
      if (prevKey !== undefined) process.env.API_KEY_ENCRYPTION_KEY = prevKey;
    }
  });
});
