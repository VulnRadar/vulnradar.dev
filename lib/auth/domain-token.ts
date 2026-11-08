import { isKeyHex, requireSigningKey } from "@/lib/auth/key-hex";
import { openEnvelope, sealEnvelope } from "@/lib/auth/signed-envelope";

/**
 * Signed tokens keyed with API_KEY_ENCRYPTION_KEY and domain-separated, so a
 * tag minted for one purpose can never verify as another's. The pending-2FA
 * cookie and the IPv4 echo token are both this; each picks its own domain
 * string and its own wording for the "key not configured" error.
 *
 * The OAuth `state` tokens are not: they sign with AUTH_SECRET and carry no
 * domain (see resolveStateSecret in signed-envelope.ts).
 */

export interface DomainToken {
  /** Sign a payload into an opaque `body.signature` string. */
  sign(payload: unknown): string;
  /**
   * The payload if the token's signature verifies, otherwise null: missing,
   * malformed, forged, tampered, or signed under another key or domain, and
   * also when the configured key is not 64 hex characters, since a key that
   * could not have signed anything authenticates nothing. Only the signature
   * is checked; freshness and shape are the caller's.
   */
  verify<T>(token: string | undefined | null): T | null;
}

/**
 * @param domain  Fixed string mixed into the HMAC input, e.g.
 *                `vulnradar.2fa-pending.v1`. Changing it invalidates every
 *                token already issued.
 * @param purpose What is being signed, in words ("2FA pending tokens"), for
 *                the error thrown when the key is not configured.
 */
export function domainToken(domain: string, purpose: string): DomainToken {
  const key = () => requireSigningKey(purpose);
  return {
    sign: (payload) => sealEnvelope(payload, key, domain),
    verify: <T>(token: string | undefined | null): T | null => {
      if (!token || !isKeyHex(process.env.API_KEY_ENCRYPTION_KEY)) return null;
      const opened = openEnvelope(token, key, domain);
      return opened.ok ? (opened.payload as T) : null;
    },
  };
}
