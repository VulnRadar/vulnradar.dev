/**
 * JWT structural analysis.
 *
 * The legacy `api-jwt-alg-none`, `api-jwt-hs256-weak-secret` and
 * `api-jwt-missing-exp-claim` detectors (`checks/api.ts`) are regexes over
 * the raw body (e.g. `/"alg"\s*:\s*"none"/i`), which matches the literal
 * text "alg":"none" appearing anywhere, including in unrelated JSON that
 * happens to contain those substrings. These checks instead find something
 * that is actually shaped like a JWT (three base64url segments), decode its
 * header and payload for real, and only report on what the decode reveals.
 * That is a strictly passive operation: base64url is decoded locally, no
 * signature verification or cracking is attempted, and no request is made.
 *
 * A self-contained base64url decoder is used (no `atob`/`Buffer` dependency)
 * so this runs the same way regardless of the scanner's execution runtime.
 */

import type { PageCheck } from "../../check-types";
import { excerpt } from "../../check-types";

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64UrlDecode(segment: string): string | null {
  if (!segment) return "";
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) return null;

  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const ch of padded) {
    if (ch === "=") break;
    const value = B64_CHARS.indexOf(ch);
    if (value === -1) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  try {
    return decodeURIComponent(
      output
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
  } catch {
    return output;
  }
}

interface DecodedJwt {
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
}

function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length < 2 || parts.length > 3) return null;
  const headerStr = base64UrlDecode(parts[0]);
  const payloadStr = base64UrlDecode(parts[1]);
  if (headerStr === null || payloadStr === null) return null;

  let header: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(headerStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      header = parsed as Record<string, unknown>;
    }
  } catch {
    return null; // an unparseable header means this wasn't really a JWT
  }
  if (!header) return null;

  let payload: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(payloadStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = null;
  }

  return { header, payload };
}

// Requires both header and payload segments to start with `eyJ`, the
// base64url encoding of `{"`, which is what every JSON JWT segment starts
// with. The trailing signature segment is optional so alg:none tokens that
// omit it (`header.payload` or `header.payload.`) still match.
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g;

function findJwts(text: string, max = 5): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  JWT_PATTERN.lastIndex = 0;
  while ((m = JWT_PATTERN.exec(text))) {
    const token = m[0];
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
      if (out.length >= max) break;
    }
  }
  return out;
}

const WEB_STORAGE_TOKEN_WRITE =
  /(?:localStorage|sessionStorage)\.setItem\(\s*["'`]([^"'`]*(?:token|jwt|auth|access_token|id_token)[^"'`]*)["'`]/gi;

export const jwtChecks: PageCheck[] = [
  {
    id: "page-jwt-alg-none",
    title: 'JWT with alg:"none" found in the response',
    category: "secrets-extended",
    severity: "critical",
    method: "script-analysis",
    confidence: 88,
    description:
      'A JSON Web Token visible in the response decodes to a header declaring alg:"none", meaning it carries no cryptographic signature at all.',
    riskImpact:
      "A token with alg:none is unsigned. Any client can construct one with an arbitrary payload, including a different user id or an elevated role, and a server that does not explicitly reject the none algorithm will accept it as valid.",
    explanation:
      "The JWT header is base64url-decoded directly from a token found in the page (a cookie value or inline script). This confirms the header's literal content, not that the server currently accepts it: some JWT libraries reject alg:none unconditionally, but historically many did not unless the caller opted in to an algorithm allowlist.",
    fixSteps: [
      "Configure the JWT verification library with an explicit algorithm allowlist (e.g. only RS256 or ES256) instead of trusting the alg named in the token.",
      "Never issue tokens with alg:none from the server.",
    ],
    codeExamples: [
      {
        label: "Explicit algorithm allowlist (jsonwebtoken)",
        language: "javascript",
        code: 'jwt.verify(token, publicKey, { algorithms: ["RS256"] });',
      },
    ],
    references: [
      "https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/",
    ],
    run(ctx) {
      const candidates = [
        ...findJwts(ctx.inlineScript),
        ...ctx.cookies.flatMap((c) => findJwts(c.value)),
      ];
      for (const token of candidates) {
        const decoded = decodeJwt(token);
        const alg = decoded?.header?.alg;
        if (typeof alg === "string" && alg.toLowerCase() === "none") {
          return {
            evidence: `A JWT in the response declares alg:"${alg}", disabling signature verification.`,
            excerpts: [excerpt("JWT header", JSON.stringify(decoded!.header))],
          };
        }
      }
      return null;
    },
  },

  {
    id: "page-jwt-missing-exp-claim",
    title: "JWT visible in the response has no expiration claim",
    category: "secrets-extended",
    severity: "medium",
    method: "script-analysis",
    confidence: 65,
    description:
      "A JSON Web Token found in the response decodes to a payload with no exp (expiration) claim.",
    riskImpact:
      "A token that never expires remains valid until explicitly revoked. If it is stolen (via XSS, a logging system, or a shared machine), it grants access indefinitely rather than for a bounded window.",
    explanation:
      "The JWT payload is base64url-decoded directly from a token found in the page. Some tokens are deliberately long-lived by design (an API key issued as a JWT); treat this as a prompt to confirm the lifetime is intentional, not an automatic defect.",
    fixSteps: [
      "Add an exp claim when issuing the token, sized to the sensitivity of what it grants access to.",
      "Pair a short-lived access token with a separate, revocable refresh token for long sessions.",
    ],
    codeExamples: [],
    run(ctx) {
      const candidates = [
        ...findJwts(ctx.inlineScript),
        ...ctx.cookies.flatMap((c) => findJwts(c.value)),
      ];
      for (const token of candidates) {
        const decoded = decodeJwt(token);
        if (!decoded?.payload) continue;
        if ("exp" in decoded.payload) continue;
        return {
          evidence: "A JWT in the response has no exp claim in its payload.",
          excerpts: [excerpt("JWT payload", JSON.stringify(decoded.payload))],
        };
      }
      return null;
    },
  },

  {
    id: "page-jwt-in-web-storage",
    title:
      "Inline script stores an auth token in localStorage or sessionStorage",
    category: "secrets-extended",
    severity: "medium",
    method: "script-analysis",
    confidence: 60,
    description:
      "An inline script writes a value with a token- or JWT-shaped key name to localStorage or sessionStorage.",
    riskImpact:
      "Unlike an HttpOnly cookie, anything in localStorage or sessionStorage is readable by any JavaScript running on the page, including script injected via an XSS bug anywhere else on the site.",
    explanation:
      "This is a heuristic on the key name passed to setItem (matching token, jwt, auth, access_token, id_token); it does not confirm the stored value is actually a credential.",
    fixSteps: [
      "Store session tokens in an HttpOnly, Secure cookie instead, so client-side script cannot read them.",
      "If a client-readable token is required for a specific API call, keep its lifetime short and scope its privileges narrowly.",
    ],
    codeExamples: [],
    needs: ["scripts"],
    run(ctx) {
      if (!ctx.inlineScript) return null;
      const hits: string[] = [];
      let m: RegExpExecArray | null;
      WEB_STORAGE_TOKEN_WRITE.lastIndex = 0;
      while ((m = WEB_STORAGE_TOKEN_WRITE.exec(ctx.inlineScript))) {
        hits.push(m[0]);
        if (hits.length >= 5) break;
      }
      if (hits.length === 0) return null;
      return {
        evidence: `${hits.length} localStorage/sessionStorage write(s) to a token-shaped key.`,
        excerpts: hits.map((h) => excerpt("web storage write", h)),
      };
    },
  },

  {
    id: "page-jwt-cookie-not-httponly",
    title: "Cookie holding a JWT is readable by JavaScript",
    category: "cookies",
    severity: "high",
    method: "cookie-attribute",
    confidence: 82,
    description:
      "A cookie whose value decodes as a JSON Web Token is set without the HttpOnly attribute.",
    riskImpact:
      "A bearer token in a script-readable cookie can be exfiltrated by any injected script, same as any other cookie, but a JWT specifically grants API-level access, so its theft is often more directly usable by an attacker than a generic session identifier.",
    explanation:
      "The cookie's value is base64url-decoded and matches the JWT structure (a header segment that decodes to a JSON object with an alg field), distinguishing it from a coincidentally dot-separated value.",
    fixSteps: [
      "Add the HttpOnly attribute to this cookie so client-side script cannot read the token value.",
    ],
    codeExamples: [],
    needs: ["cookies"],
    run(ctx) {
      const offending = ctx.cookies.filter((c) => {
        if (c.httpOnly) return false;
        const decoded = decodeJwt(c.value.trim());
        return (
          decoded !== null &&
          decoded.header !== null &&
          typeof decoded.header.alg === "string"
        );
      });
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} cookie(s) hold a JWT and are missing HttpOnly: ${offending.map((c) => c.name).join(", ")}.`,
        excerpts: offending.map((c) => excerpt("Set-Cookie", c.raw)),
      };
    },
  },
];
