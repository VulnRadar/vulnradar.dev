import { createTranslator } from "next-intl";
import pool from "@/lib/database/db";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";
import { getMessages } from "./messages";

/**
 * Translations away from a request.
 *
 * The email sender runs from a background job, a webhook, a cron sweep: there
 * is no request to read a cookie from, and the recipient is not the person who
 * triggered it. So the locale is looked up from the account being written to,
 * and the translator is built by hand rather than by a React hook.
 */
export async function getTranslator(locale: Locale) {
  return createTranslator({ locale, messages: await getMessages(locale) });
}

/**
 * The language an account reads in, for something being sent TO them.
 *
 * Falls back to English rather than to the sender's language: an email is
 * written for the person opening it.
 */
export async function getUserLocale(
  userId: number | null | undefined,
): Promise<Locale> {
  if (!userId) return DEFAULT_LOCALE;
  try {
    const result = await pool.query<{ locale: string | null }>(
      "SELECT locale FROM users WHERE id = $1",
      [userId],
    );
    const saved = result.rows[0]?.locale;
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Same, by address, for a mail sent before an account has an id to hand. */
export async function getLocaleForEmail(email: string): Promise<Locale> {
  try {
    const result = await pool.query<{ locale: string | null }>(
      "SELECT locale FROM users WHERE LOWER(email) = LOWER($1)",
      [email],
    );
    const saved = result.rows[0]?.locale;
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
