import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  signDiscordState,
  verifyDiscordState,
  parseDiscordAction,
  DISCORD_STATE_TTL_MS,
} from "@/lib/auth/discord-state";

/**
tests for HMAC-signed Discord OAuth state.
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
      // Flip a byte in the middle of the decoded signature. The naive
      // mutation (replace the last char with a constant) is flaky because
      // base64url's last char only encodes 2 meaningful bits per 6-bit
      // group, so a quarter of the time the decoded byte is unchanged
      // and the HMAC still matches. Decoding + XOR + re-encoding is
      // deterministic.
      const sigBytes = Buffer.from(sig!, "base64url");
      sigBytes[10] ^= 0xff;
      const tampered = `${payload}.${sigBytes.toString("base64url")}`;
      const result = verifyDiscordState(tampered);
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    });
  });

  it("rejects a signature re-spelled so that it decodes to the same bytes", () => {
    withSecret(() => {
      const state = signDiscordState({ action: "link" });
      const [payload, sig] = state.split(".");
      const alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      // Only the top four bits of the final character are data; flipping the
      // lowest bit changes the spelling and leaves the decoded bytes alone.
      const spareBits =
        sig!.slice(0, -1) + alphabet[alphabet.indexOf(sig!.slice(-1)) ^ 1];
      for (const respelled of [spareBits, `${sig}=`]) {
        expect(
          Buffer.from(respelled, "base64url").equals(
            Buffer.from(sig!, "base64url"),
          ),
        ).toBe(true);
        expect(verifyDiscordState(`${payload}.${respelled}`)).toEqual({
          ok: false,
          reason: "bad-signature",
        });
      }
    });
  });

  it("keeps the wire format: a fixed payload signs to the same string it always did", () => {
    withSecret(() => {
      const state = signDiscordState({
        action: "link",
        nonce: "n0nce",
        ts: 1_700_000_000_000,
        userId: 42,
      });
      expect(state).toBe(
        "eyJub25jZSI6Im4wbmNlIiwiYWN0aW9uIjoibGluayIsInRzIjoxNzAwMDAwMDAwMDAwLCJ1c2VySWQiOjQyfQ.MezJR34Tm2sFLVhmFuGt35iwe8vaSC9HSIeO3K3mjE4",
      );
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

// The start route and the callback both map a string onto the two actions the
// flow knows. They used to carry a private copy each, so the closed set lived
// in two places that could drift.
describe("parseDiscordAction", () => {
  it.each(["connect", "login"] as const)("accepts %s", (action) => {
    expect(parseDiscordAction(action)).toBe(action);
  });

  it.each(["link", "", "Login", "connect ", "__proto__", "admin"])(
    "refuses %j",
    (value) => {
      expect(parseDiscordAction(value)).toBeNull();
    },
  );
});
