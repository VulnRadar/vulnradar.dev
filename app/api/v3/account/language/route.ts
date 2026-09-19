import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { cookiesRequireHttps } from "@/lib/auth/cookie-secure";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  type Locale,
} from "@/lib/i18n/config";

/**
 * GET/PUT /api/v3/account/language
 *
 * The language the site, its emails and its AI answers are written in.
 *
 * A signed-in account stores it (users.locale) so it follows the person to
 * their next browser and so the email sender, which has no request behind it,
 * can read it. Every visitor also gets it as a cookie, which is what rendering
 * reads (lib/i18n/request.ts): a page never waits on the database to know what
 * language to be in, and a visitor with no account still keeps their choice.
 */

export const GET = withErrorHandling(async () => {
  const [session, cookieStore] = await Promise.all([getSession(), cookies()]);
  const saved = session
    ? (
        await pool.query<{ locale: string | null }>(
          "SELECT locale FROM users WHERE id = $1",
          [session.userId],
        )
      ).rows[0]?.locale
    : null;

  return ApiResponse.success({
    locale: isLocale(saved)
      ? saved
      : (cookieStore.get(LOCALE_COOKIE)?.value ?? null),
  });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  const parsed = await parseBody<{ locale?: unknown }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);

  const locale = parsed.data.locale;
  if (!isLocale(locale)) {
    return ApiResponse.badRequest("That is not a language this site speaks.");
  }

  const session = await getSession();
  if (session) {
    await pool.query("UPDATE users SET locale = $1 WHERE id = $2", [
      locale,
      session.userId,
    ]);
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale satisfies Locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    path: "/",
    // Read by the server to render, never by scripts.
    httpOnly: true,
    secure: cookiesRequireHttps(),
  });

  return ApiResponse.success({ locale });
});
