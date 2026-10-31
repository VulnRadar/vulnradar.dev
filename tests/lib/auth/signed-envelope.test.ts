import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  openEnvelope,
  resolveStateSecret,
  sealEnvelope,
} from "@/lib/auth/signed-envelope";

/**
 * The envelope is the one construction behind the OAuth state tokens, the
 * pending-2FA cookie and the IPv4 echo token. These tests pin two things:
 * that it still produces and accepts exactly what the four per-token copies
 * did (tokens already in browsers must keep verifying), and that the
 * canonical-spelling check closes the gap those copies left open.
 */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** The construction as it was written before the envelope existed. */
function legacyToken(
  payload: unknown,
  key: string | Buffer,
  domain?: string,
): string {
  const body = b64(JSON.stringify(payload));
  const input = domain ? `${domain}.${body}` : body;
  return `${body}.${createHmac("sha256", key).update(input).digest("base64url")}`;
}

const STRING_KEY = "a".repeat(64);
const BYTE_KEY = Buffer.from("ab".repeat(32), "hex");

// Produced by the pre-envelope code paths, kept as literals so a change to the
// wire format cannot pass by changing the reference above in step.
const GOLDEN_STATE =
  "eyJub25jZSI6Im4wbmNlIiwiYWN0aW9uIjoibGluayIsInRzIjoxNzAwMDAwMDAwMDAwLCJ1c2VySWQiOjQyfQ.MezJR34Tm2sFLVhmFuGt35iwe8vaSC9HSIeO3K3mjE4";
const GOLDEN_STATE_PAYLOAD = {
  nonce: "n0nce",
  action: "link",
  ts: 1_700_000_000_000,
  userId: 42,
};
const GOLDEN_DOMAIN =
  "eyJ1c2VySWQiOjcsIm1ldGhvZCI6ImVtYWlsIiwidHMiOjE3MDAwMDAwMDAwMDB9.VsV1NXz4ZhPhV0wWAfMYuty16gl00H3cBl5e6KK79dI";
const GOLDEN_DOMAIN_PAYLOAD = {
  userId: 7,
  method: "email",
  ts: 1_700_000_000_000,
};
const GOLDEN_DOMAIN_NAME = "vulnradar.2fa-pending.v1";

describe("wire format", () => {
  it("seals a keyed-by-string, undomained token exactly as the state modules did", () => {
    expect(sealEnvelope(GOLDEN_STATE_PAYLOAD, STRING_KEY)).toBe(GOLDEN_STATE);
    expect(sealEnvelope(GOLDEN_STATE_PAYLOAD, STRING_KEY)).toBe(
      legacyToken(GOLDEN_STATE_PAYLOAD, STRING_KEY),
    );
  });

  it("seals a hex-key, domain-separated token exactly as pending-2fa and the echo token did", () => {
    expect(
      sealEnvelope(GOLDEN_DOMAIN_PAYLOAD, BYTE_KEY, GOLDEN_DOMAIN_NAME),
    ).toBe(GOLDEN_DOMAIN);
  });

  it("opens tokens minted before the envelope existed", () => {
    expect(openEnvelope(GOLDEN_STATE, STRING_KEY)).toEqual({
      ok: true,
      payload: GOLDEN_STATE_PAYLOAD,
    });
    expect(openEnvelope(GOLDEN_DOMAIN, BYTE_KEY, GOLDEN_DOMAIN_NAME)).toEqual({
      ok: true,
      payload: GOLDEN_DOMAIN_PAYLOAD,
    });
  });

  it("round-trips arbitrary JSON payloads", () => {
    const payload = { a: [1, 2, { b: "ü€" }], c: null, d: true };
    const token = sealEnvelope(payload, STRING_KEY);
    expect(openEnvelope(token, STRING_KEY)).toEqual({ ok: true, payload });
  });
});

describe("what a signature is bound to", () => {
  const token = sealEnvelope({ x: 1 }, STRING_KEY, "domain.a");

  it("rejects the same token under another key", () => {
    expect(openEnvelope(token, "b".repeat(64), "domain.a")).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects the same token under another domain, or none", () => {
    expect(openEnvelope(token, STRING_KEY, "domain.b")).toEqual({
      ok: false,
      reason: "bad-signature",
    });
    expect(openEnvelope(token, STRING_KEY)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a payload swapped under the original signature", () => {
    const sig = token.slice(token.lastIndexOf(".") + 1);
    expect(
      openEnvelope(
        `${b64(JSON.stringify({ x: 2 }))}.${sig}`,
        STRING_KEY,
        "domain.a",
      ),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a flipped signature byte", () => {
    const dot = token.lastIndexOf(".");
    const bytes = Buffer.from(token.slice(dot + 1), "base64url");
    bytes[10] ^= 0xff;
    expect(
      openEnvelope(
        `${token.slice(0, dot)}.${bytes.toString("base64url")}`,
        STRING_KEY,
        "domain.a",
      ),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });
});

describe("malformed input", () => {
  it.each(["", "nodot", ".", ".sig", "body.", "a.b.", "..."])(
    "calls %j malformed without reading the key",
    (input) => {
      const key = vi.fn(() => STRING_KEY);
      expect(openEnvelope(input, key)).toEqual({
        ok: false,
        reason: "malformed",
      });
      expect(key).not.toHaveBeenCalled();
    },
  );

  it("calls a correctly signed body that is not JSON malformed", () => {
    const body = b64("this is not json");
    const signature = createHmac("sha256", STRING_KEY)
      .update(body)
      .digest("base64url");
    expect(openEnvelope(`${body}.${signature}`, STRING_KEY)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("reads a lazily supplied key once the token is well formed", () => {
    const token = sealEnvelope({ ok: 1 }, STRING_KEY);
    const key = vi.fn(() => STRING_KEY);
    expect(openEnvelope(token, key).ok).toBe(true);
    expect(key).toHaveBeenCalledTimes(1);
  });

  it("lets a key that throws surface, so a missing secret is never read as a forged token", () => {
    const token = sealEnvelope({ ok: 1 }, STRING_KEY);
    expect(() =>
      openEnvelope(token, () => {
        throw new Error("secret not configured");
      }),
    ).toThrow("secret not configured");
  });
});

describe("one accepted spelling per signature", () => {
  const token = sealEnvelope({ nonce: "n", ts: 1 }, STRING_KEY);
  const dot = token.lastIndexOf(".");
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const decoded = Buffer.from(signature, "base64url");

  const ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  // The 43rd character of a 32-byte digest carries four bits of data and two
  // spare ones, so flipping the lowest bit of its index changes the spelling
  // and nothing else.
  const lastCharFlipped =
    signature.slice(0, -1) +
    ALPHABET[ALPHABET.indexOf(signature.slice(-1)) ^ 1];

  const respelled: Array<[string, string]> = [
    ["spare trailing bits changed", lastCharFlipped],
    ["padding appended", `${signature}=`],
    ["a newline inside", `${signature.slice(0, 20)}\n${signature.slice(20)}`],
    ["whitespace appended", `${signature} `],
    ["a stray character appended", `${signature}!`],
  ];

  it.each(respelled)(
    "rejects a signature with %s, although Node decodes it to the same bytes",
    (_label, spelling) => {
      // Guard against the test going vacuous if the decoder ever tightens.
      expect(Buffer.from(spelling, "base64url").equals(decoded)).toBe(true);
      expect(spelling).not.toBe(signature);

      expect(openEnvelope(`${body}.${spelling}`, STRING_KEY)).toEqual({
        ok: false,
        reason: "bad-signature",
      });
    },
  );

  it("still accepts the canonical spelling", () => {
    expect(openEnvelope(`${body}.${signature}`, STRING_KEY).ok).toBe(true);
  });
});

describe("resolveStateSecret", () => {
  const original = {
    auth: process.env.AUTH_SECRET,
    key: process.env.API_KEY_ENCRYPTION_KEY,
  };

  afterEach(() => {
    for (const [name, value] of [
      ["AUTH_SECRET", original.auth],
      ["API_KEY_ENCRYPTION_KEY", original.key],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("prefers AUTH_SECRET", () => {
    process.env.AUTH_SECRET = "auth-secret";
    process.env.API_KEY_ENCRYPTION_KEY = "encryption-key";
    expect(resolveStateSecret("x")).toBe("auth-secret");
  });

  it("falls back to API_KEY_ENCRYPTION_KEY", () => {
    delete process.env.AUTH_SECRET;
    process.env.API_KEY_ENCRYPTION_KEY = "encryption-key";
    expect(resolveStateSecret("x")).toBe("encryption-key");
  });

  it("fails closed, naming the module that asked", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    expect(() => resolveStateSecret("discord-state")).toThrow(
      /^\[discord-state\] Either AUTH_SECRET or API_KEY_ENCRYPTION_KEY must be configured/,
    );
    expect(() => resolveStateSecret("oauth-state")).toThrow(
      /^\[oauth-state\] /,
    );
  });
});
