/**
 * The request-body shape both authenticated scan paths share.
 *
 * POST /api/v3/scan/authenticated (a single page) and POST /api/v3/scan/crawl
 * (a multi-page crawl) accept the exact same `auth` block, held to the same
 * admin-configurable limits (SCAN_AUTH_MAX_SECRET_LENGTH,
 * SCAN_AUTH_MAX_COOKIES). Building the discriminated union and the
 * `toEphemeralAuth` mapper here, once, keeps the two routes byte-for-byte
 * consistent instead of drifting apart across two hand-maintained copies.
 *
 * The schema depends on live admin settings, so it is built per request from
 * the resolved values rather than once at import time -- an admin edit must
 * take effect on the next request, not the next deploy. Zod construction is
 * cheap enough that this costs nothing meaningful per call.
 *
 * Nothing here stores, logs, or echoes credential material: it only shapes
 * and validates the request, then maps it to the in-memory
 * `EphemeralAuthInput` the login layer consumes.
 */

import { z } from "zod";
import type { EphemeralAuthInput } from "./types";

export interface AuthRequestSchemaLimits {
  maxSecretLength: number;
  maxCookies: number;
}

/**
 * The `auth` discriminated union shared by both authenticated scan routes.
 * Field definitions (and the per-field caps) are the single source of truth
 * for what an authenticated scan request may carry.
 */
export function buildAuthRequestSchema(opts: AuthRequestSchemaLimits) {
  const secretString = z.string().min(1).max(opts.maxSecretLength);

  const FormAuthSchema = z.object({
    method: z.literal("form"),
    username: secretString,
    password: secretString,
    loginUrl: z.string().url().max(2048).optional(),
    usernameField: z.string().max(200).optional(),
    passwordField: z.string().max(200).optional(),
  });

  const HeaderAuthSchema = z.object({
    method: z.literal("header"),
    headerName: z.string().max(200).optional(),
    headerValue: secretString,
  });

  const CookieAuthSchema = z.object({
    method: z.literal("cookie"),
    cookies: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          value: secretString,
        }),
      )
      .min(1)
      .max(opts.maxCookies),
  });

  return z.discriminatedUnion("method", [
    FormAuthSchema,
    HeaderAuthSchema,
    CookieAuthSchema,
  ]);
}

export type AuthRequestSchema = ReturnType<typeof buildAuthRequestSchema>;
export type AuthRequestInput = z.infer<AuthRequestSchema>;

/**
 * Map a validated `auth` block to the in-memory login input. The returned
 * value carries plaintext credential material and, exactly like
 * `EphemeralAuthInput` itself, must never be persisted, logged, or echoed.
 */
export function toEphemeralAuth(parsed: AuthRequestInput): EphemeralAuthInput {
  switch (parsed.method) {
    case "form":
      return {
        method: "form",
        username: parsed.username,
        password: parsed.password,
        loginUrl: parsed.loginUrl,
        usernameField: parsed.usernameField,
        passwordField: parsed.passwordField,
      };
    case "header":
      return {
        method: "header",
        headerName: parsed.headerName,
        headerValue: parsed.headerValue,
      };
    case "cookie":
      return { method: "cookie", cookies: parsed.cookies };
  }
}
