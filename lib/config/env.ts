import { z } from "zod";

/**
 * Centralized runtime environment validation.
 *
 * Replaces the previous pattern of "silently fall back to
 * hardcoded secrets" in `lib/auth/discord-state.ts` and `lib/api/api-keys.ts`.
 * Callers fail fast at startup with a clear error message instead of running
 * with a forgeable global default.
 *
 * Validation is lazy: the first call parses `process.env` and caches the
 * result. The cache is invalidated across hot reloads automatically because
 * `process.env` is the source of truth and the module is re-evaluated.
 */

const RequiredSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (PostgreSQL connection string)"),
  API_KEY_ENCRYPTION_KEY: z
    .string()
    .length(
      64,
      "API_KEY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    ),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url("NEXT_PUBLIC_APP_URL must be a valid URL"),
});

// Boolean-style envs accept only "true" / "false". Any other value
// ("yes", "1", "TRUE") previously slipped through as truthy strings
// and bypassed the strict-equal checks in lib/database/db.ts and
// elsewhere. Coerce at the schema boundary so callers get a clean bool.
const BoolString = z
  .union([z.literal("true"), z.literal("false")])
  .transform((v) => v === "true");

// An empty value means "not set". docker compose and most .env files spell an
// unset optional as `NAME=`, which reaches process.env as "", and every
// consumer already reads these with `||` or a strict compare, so "" behaves as
// unset at runtime. Validation has to agree: running the format checks on ""
// rejected an empty CONTACT_EMAIL as an invalid email and crash-looped the
// documented docker compose quick start.
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
}

const OptionalSchema = z.object({
  // The HMAC key for the OAuth and Discord state tokens (lib/auth/signed-envelope.ts)
  // when set. API_KEY_ENCRYPTION_KEY is the fallback; either one is sufficient.
  AUTH_SECRET: optional(
    z
      .string()
      .min(
        32,
        "AUTH_SECRET must be at least 32 chars (HMAC key; shorter is brute-forceable)",
      ),
  ),

  // SMTP
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: optional(z.string()),
  SMTP_USER: optional(z.string()),
  SMTP_PASS: optional(z.string()),
  SMTP_FROM: optional(z.string()),
  SMTP_EHLO_NAME: optional(z.string()),

  // Stripe
  STRIPE_SECRET_KEY: optional(z.string()),
  // Accepted, never read. The publishable key only matters client-side and
  // Next.js will only inline the NEXT_PUBLIC_ form below, so nothing
  // consumes the bare name. It stays in the schema (and in the CI and
  // Dockerfile placeholder envs) so an existing .env or compose file that
  // sets it does not have to change; same treatment as CONTACT_EMAIL
  // further down. Do not add a consumer for it: add one for the
  // NEXT_PUBLIC_ variant.
  STRIPE_PUBLISHABLE_KEY: optional(z.string()),
  STRIPE_WEBHOOK_SECRET: optional(z.string()),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optional(z.string()),

  // Discord OAuth (also used by app/api/v3/auth/oauth/discord/ -- the
  // sign-up/sign-in flow shares this same Discord application with the
  // account-linking flow above; one Discord app can register multiple
  // OAuth2 redirect URIs, so no second set of credentials is needed).
  DISCORD_CLIENT_ID: optional(z.string()),
  DISCORD_CLIENT_SECRET: optional(z.string()),
  DISCORD_BOT_TOKEN: optional(z.string()),
  DISCORD_GUILD_ID: optional(z.string()),

  // Google OAuth sign-up/sign-in (app/api/v3/auth/oauth/google/). Optional --
  // the "Sign in with Google" button only renders once both are set (see
  // lib/auth/oauth-providers.ts).
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_CLIENT_SECRET: optional(z.string()),

  // GitHub OAuth sign-up/sign-in (app/api/v3/auth/oauth/github/). Optional --
  // same "inert until configured" shape as Google/Discord above.
  GITHUB_CLIENT_ID: optional(z.string()),
  GITHUB_CLIENT_SECRET: optional(z.string()),

  // Contact. CONTACT_EMAIL is accepted and validated but read by nothing:
  // the contact form delivers to SMTP_FROM, then SMTP_USER, then the
  // NOREPLY_EMAIL setting. Kept so an existing .env does not fail
  // validation, and documented as a no-op on /docs/config rather than
  // quietly left to look like a bug.
  CONTACT_EMAIL: optional(z.string().email()),
  SUPPORT_EMAIL: optional(z.string().email()),

  // Turnstile
  TURNSTILE_SECRET_KEY: optional(z.string()),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optional(z.string()),

  // BrowserBase: live session viewer, browser-driven login and the opt-in
  // page screenshot all run through it (lib/browserbase/client.ts,
  // app/browser/[id]/page.tsx). The comment here used to say the
  // integration had been removed as unreliable, which stopped being true
  // several releases ago and would have sent the next reader looking for a
  // fallback that no longer exists. Optional: unset, the View Page button
  // hides and captures are skipped.
  BROWSERBASE_API_KEY: optional(z.string()),
  BROWSERBASE_PROJECT_ID: optional(z.string()),

  // Database: strict bool so "1" / "yes" can't slip through and
  // leave production running without SSL.
  DATABASE_SSL: optional(BoolString),

  // Proxy / IP trust: must be a valid CIDR or a comma-separated list of
  // CIDRs. Used by lib/api/request-utils.ts to walk X-Forwarded-For
  // right-to-left. A typo here silently disables IP trust.
  TRUSTED_PROXY_CIDR: optional(z.string()),

  // headers: when DISABLE_CSP is "1" the application strips every
  // CSP / COOP / CORP / X-Frame-Options / Permissions-Policy header.
  // Useful only for debugging third-party embed compatibility in
  // development. Must NOT be enabled in production. See
  // assertProductionSafe below.
  DISABLE_CSP: optional(z.string()),

  // security: when set to "1", mutating API requests skip the CSRF Origin
  // check in middleware.ts's enforceCsrf() and nothing else: the public-path
  // list and the auth gate still apply. Intended for local development with
  // API clients (curl, Postman, etc.) that cannot send an Origin header.
  // MUST NOT be set in production: enforceCsrf()
  // checks NODE_ENV === "production" as a secondary guard, but
  // the env-schema declaration here makes the flag visible at startup
  // validation so typos in the var name are caught immediately
  // (AUDIT-004#misc-01).
  SECURITY_ALLOW_NON_BROWSER_API: optional(z.string()),
});

/**
 * headers: production guardrail for DISABLE_CSP=1.
 *
 * The DISABLE_CSP escape hatch is intended for local debugging only.
 * Leaving it on in production silently disables the entire security
 * header set (CSP, COOP, CORP, X-Frame-Options, Permissions-Policy,
 * HSTS) and is exactly the kind of footgun that gets forgotten in
 * a deployment.
 *
 * This is a separate check from the zod schema above so the error
 * message can be explicit and the check can run before any header
 * mutation happens.
 */
export function assertProductionSafe(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.DISABLE_CSP === "1"
  ) {
    throw new Error(
      "[env] DISABLE_CSP=1 is not allowed in NODE_ENV=production. " +
        "Disable CSP only for local debugging of third-party embeds. " +
        "Remove DISABLE_CSP from your deployment environment.",
    );
  }
}

const EnvSchema = RequiredSchema.merge(OptionalSchema);

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Validate `process.env` against the required schema. Throws on the first
 * missing/invalid value with a clear, actionable message. Cached after first
 * successful call.
 *
 * Called from `instrumentation.ts` at server startup so the process fails
 * fast with a useful error instead of returning 500s on every request.
 */
export function validateEnv(): Env {
  if (cached) return cached;

  // headers: refuse DISABLE_CSP=1 in production. Runs before zod
  // parse so the operator gets an actionable error.
  assertProductionSafe();

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[env] Environment validation failed. Set the following in .env:\n${issues}`,
    );
  }
  cached = result.data;
  return cached;
}
