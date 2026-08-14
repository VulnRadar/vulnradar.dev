/**
 * Staff SSO: generic OIDC login for staff/admin accounts (AUDIT-010,
 * admin-feature-gap: "privileged accounts authenticate the same as
 * customers, so a self-hosting org can't put admin access behind their own
 * IdP"). Protocol-generic on purpose -- points at any OIDC-compliant
 * issuer via its own /.well-known/openid-configuration discovery document,
 * rather than hardcoding one vendor's SDK the way the Google/GitHub/Discord
 * sign-up providers do (lib/auth/oauth-providers.ts).
 *
 * Deliberately NOT unified into that OAUTH_PROVIDERS registry: those three
 * have static, compile-time-known authorize/token endpoints; OIDC's are
 * discovered at runtime from an admin-configured issuer, which doesn't fit
 * that registry's shape. Kept as its own small, purpose-built module
 * instead of forcing a mismatched abstraction.
 *
 * Security posture, deliberately different from the public sign-up
 * providers: this NEVER creates a new account and NEVER elevates an
 * existing customer account's role. A successful OIDC login only signs
 * into an account that (a) already exists with this exact email and (b)
 * already has a staff-tier-or-above role. A misconfigured or compromised
 * IdP therefore cannot mint a new privileged account -- at worst it can
 * authenticate as an account an admin already provisioned.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getSettings } from "@/lib/config/runtime-config";

export interface StaffOidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}

/** All three must be set for staff SSO to be active. */
export async function getStaffOidcConfig(): Promise<StaffOidcConfig | null> {
  const settings = await getSettings([
    "STAFF_OIDC_ISSUER_URL",
    "STAFF_OIDC_CLIENT_ID",
    "STAFF_OIDC_CLIENT_SECRET",
  ]);
  const issuerUrl = settings.STAFF_OIDC_ISSUER_URL?.trim();
  const clientId = settings.STAFF_OIDC_CLIENT_ID?.trim();
  const clientSecret = settings.STAFF_OIDC_CLIENT_SECRET?.trim();
  if (!issuerUrl || !clientId || !clientSecret) return null;
  return { issuerUrl, clientId, clientSecret };
}

interface DiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

// Discovery documents change essentially never; a short cache avoids one
// extra network round trip on every single login attempt. Keyed by issuer
// URL so a config change (or a self-hosted instance switching IdPs) is
// picked up within the TTL rather than requiring a restart.
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const discoveryCache = new Map<
  string,
  { doc: DiscoveryDocument; fetchedAt: number }
>();

export async function getDiscoveryDocument(
  issuerUrl: string,
): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(issuerUrl);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
    return cached.doc;
  }

  const base = issuerUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(
      `OIDC discovery failed: ${base}/.well-known/openid-configuration returned ${res.status}`,
    );
  }
  const doc = (await res.json()) as Partial<DiscoveryDocument>;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error(
      "OIDC discovery document is missing required fields (authorization_endpoint/token_endpoint/jwks_uri)",
    );
  }
  const resolved = doc as DiscoveryDocument;
  discoveryCache.set(issuerUrl, { doc: resolved, fetchedAt: Date.now() });
  return resolved;
}

// One JWKS client per issuer, reused across requests -- createRemoteJWKSet
// handles its own key caching/rotation internally, so this only needs to
// avoid constructing a new one on every single callback.
const jwksClients = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwksClient(jwksUri: string) {
  let client = jwksClients.get(jwksUri);
  if (!client) {
    client = createRemoteJWKSet(new URL(jwksUri));
    jwksClients.set(jwksUri, client);
  }
  return client;
}

export interface VerifiedOidcIdToken {
  email: string;
  emailVerified: boolean;
  name: string | null;
  sub: string;
}

/**
 * Verify an ID token's signature (against the issuer's live JWKS),
 * issuer, audience, expiry, and the anti-replay nonce (bound to the same
 * signed state this app already uses for its other OAuth flows -- see
 * lib/auth/oauth-state.ts). Throws on any failure; never returns a
 * "probably fine" result.
 */
export async function verifyStaffOidcIdToken(
  idToken: string,
  config: StaffOidcConfig,
  doc: DiscoveryDocument,
  expectedNonce: string,
): Promise<VerifiedOidcIdToken> {
  const jwks = getJwksClient(doc.jwks_uri);
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: doc.issuer,
    audience: config.clientId,
  });

  const claims = payload as JWTPayload & {
    email?: string;
    email_verified?: boolean;
    name?: string;
    nonce?: string;
  };

  if (!claims.nonce || claims.nonce !== expectedNonce) {
    throw new Error("OIDC ID token nonce mismatch (possible replay)");
  }
  if (!claims.email) {
    throw new Error("OIDC ID token has no email claim");
  }
  if (!claims.sub) {
    throw new Error("OIDC ID token has no sub claim");
  }

  return {
    email: claims.email.toLowerCase().trim(),
    emailVerified: claims.email_verified !== false,
    name: claims.name ?? null,
    sub: claims.sub,
  };
}

/**
 * Exchange an authorization code for tokens at the issuer's token
 * endpoint. Standard OIDC authorization_code grant.
 */
export async function exchangeStaffOidcCode(
  doc: DiscoveryDocument,
  config: StaffOidcConfig,
  code: string,
  redirectUri: string,
): Promise<{ idToken: string }> {
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`OIDC token exchange failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) {
    throw new Error("OIDC token response has no id_token");
  }
  return { idToken: data.id_token };
}
