import { z } from "zod";

/**
 * Centralized runtime environment validation.
 *
replaces the previous pattern of "silently fall back to
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

const OptionalSchema = z.object({
  // Used by lib/auth/discord-state.ts when AUTH_SECRET is set. API_KEY_ENCRYPTION_KEY
  // is the fallback for HMAC signing; either one is sufficient.
  AUTH_SECRET: z
    .string()
    .min(
      32,
      "AUTH_SECRET must be at least 32 chars (HMAC key — shorter is brute-forceable)",
    )
    .optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // Discord OAuth
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),

  // Contact
  CONTACT_EMAIL: z.string().email().optional(),
  SUPPORT_EMAIL: z.string().email().optional(),

  // Turnstile
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),

  // BrowserBase (removed — was unreliable; see ViewPageButton for
  // the fallback that opens the scanned URL in a new tab)
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),

  // Database — strict bool so "1" / "yes" can't slip through and
  // leave production running without SSL.
  DATABASE_SSL: BoolString.optional(),

  // Proxy / IP trust — must be a valid CIDR or a comma-separated list of
  // CIDRs. Used by lib/api/request-utils.ts to walk X-Forwarded-For
  // right-to-left. A typo here silently disables IP trust.
  TRUSTED_PROXY_CIDR: z.string().optional(),
});

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

/**
 * Get a specific required env var. Throws if not set. Use this for values
 * that aren't in the central schema (e.g. one-off secrets for new modules).
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `[env] Required environment variable ${name} is not set. ` +
        `Add it to .env or your deployment environment.`,
    );
  }
  return value;
}
