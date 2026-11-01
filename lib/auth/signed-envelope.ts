import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The one construction behind every short-lived signed value in lib/auth:
 * the Discord and sign-in OAuth `state`, the pending-2FA cookie and the IPv4
 * echo token.
 *
 * Format: `base64url(JSON(payload)).base64url(HMAC-SHA256(key, mac input))`.
 * The mac input is the encoded payload, or `${domain}.${encoded payload}` when
 * a domain is given. The four tokens used to carry their own copy of this and
 * had drifted: two compared the decoded signature bytes and two compared the
 * tag strings, and only the string comparison was immune to a signature that
 * decodes to the right bytes while being spelled differently. Nothing here
 * changes what any of them looks like on the wire; a token minted before this
 * file existed still verifies.
 *
 * What it does not do: freshness, binding and payload shape. Those differ per
 * token (a TTL, a provider, a user id) and stay with the module that owns the
 * token.
 */

/** An HMAC key: a string secret, or raw key bytes. */
export type EnvelopeKey = string | Buffer;

/**
 * Callers pass the key as a function so it is only read once a token is
 * well-formed enough to be worth verifying: a request carrying
 * `state=garbage` has always been "malformed", not a server misconfiguration
 * error.
 */
type KeySource = EnvelopeKey | (() => EnvelopeKey);

function keyOf(source: KeySource): EnvelopeKey {
  return typeof source === "function" ? source() : source;
}

/**
 * The HMAC secret for the OAuth `state` tokens, from AUTH_SECRET or, failing
 * that, API_KEY_ENCRYPTION_KEY. Fails closed: the namespace used to be a
 * hardcoded string, and anyone who read the source could forge a state with
 * it. `label` names the calling module in the error so a missing secret says
 * which flow needs it.
 */
export function resolveStateSecret(label: string): string {
  const secret = process.env.AUTH_SECRET || process.env.API_KEY_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      `[${label}] Either AUTH_SECRET or API_KEY_ENCRYPTION_KEY must be ` +
        "configured to sign OAuth state. Set one in .env.",
    );
  }
  return secret;
}

function mac(
  key: EnvelopeKey,
  payloadB64: string,
  domain: string | undefined,
): Buffer {
  // A MAC, not a password hash. The key is a server secret (AUTH_SECRET, at
  // least 32 characters, or API_KEY_ENCRYPTION_KEY) and the input is the
  // token's own payload, which the token already carries in the clear: an
  // OAuth state's random nonce, provider or action, user id and timestamp, a
  // pending-2FA user id, email, 2FA method and timestamp, or an observed IPv4.
  // A slow KDF exists to stop offline guessing of a low-entropy secret; the
  // only secret here is the key, and the check runs on every request that
  // presents a token, so a fast keyed hash is the right primitive. Passwords
  // are hashed in lib/auth/password-hash.ts.
  return createHmac("sha256", key)
    .update(domain ? `${domain}.${payloadB64}` : payloadB64)
    .digest();
}

/** Sign `payload` into an opaque `body.signature` string. */
export function sealEnvelope(
  payload: unknown,
  key: KeySource,
  domain?: string,
): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${payloadB64}.${mac(keyOf(key), payloadB64, domain).toString("base64url")}`;
}

export type OpenResult =
  | { ok: true; payload: unknown }
  | { ok: false; reason: "malformed" | "bad-signature" };

/**
 * Check a sealed token's signature and return its decoded payload.
 *
 * `malformed` is a token that is not `body.signature` at all, or whose signed
 * body is not JSON; `bad-signature` is anything else that does not verify. The
 * payload comes back as `unknown`: nothing about it is validated beyond being
 * JSON, so the caller checks the fields it relies on.
 *
 * The signature must be the canonical base64url spelling of its bytes. Node's
 * decoder skips characters it does not recognise and ignores the spare bits
 * of the last one, so without this check several different strings decode to
 * the one valid signature and a token could be re-spelled without being
 * re-signed. Rejecting anything that does not re-encode to itself leaves
 * exactly one accepted spelling.
 */
export function openEnvelope(
  token: string,
  key: KeySource,
  domain?: string,
): OpenResult {
  const dot = token.lastIndexOf(".");
  if (dot < 1 || dot >= token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = mac(keyOf(key), payloadB64, domain);
  const provided = Buffer.from(signature, "base64url");
  if (
    provided.toString("base64url") !== signature ||
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return { ok: false, reason: "bad-signature" };
  }

  try {
    return {
      ok: true,
      payload: JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf8"),
      ),
    };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
