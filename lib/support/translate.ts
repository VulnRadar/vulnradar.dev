import pool from "@/lib/database/db";
import { completeShortText } from "@/lib/ai/complete";
import { resolveServerEndpoint } from "@/lib/ai/verify-findings";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_ENGLISH_NAMES,
  isLocale,
  type Locale,
} from "@/lib/i18n/config";

/**
 * Support in the language the person actually wrote in.
 *
 * A ticket has two sides that may not share a language. Rather than making
 * either of them translate by hand, each message carries the language it was
 * written in and a cache of translations, and the thread shows every reader
 * the version they can read, with the original one click away.
 *
 * Three rules this follows, all for the same reason: a support reply is a
 * record of what was said.
 *
 * - The original is never replaced. `body` is exactly what the author typed;
 *   a translation is stored beside it, keyed by language.
 * - A translation is never re-generated once cached, so the same message
 *   cannot say two different things to the same reader on two visits.
 * - Nothing here is required. No AI provider, a refusal, a timeout: the
 *   thread shows the original, which is what it showed before this existed.
 *
 * The operator's own provider pays for this (resolveServerEndpoint), not the
 * account's: it is the product answering its own support, not the user
 * spending their AI allowance on it.
 */

/** Long enough for a real support message, short enough to bound the bill. */
const MAX_TRANSLATABLE_CHARS = 6000;

/** Enough for the answer to be at most a couple of times the question. */
const MAX_TRANSLATION_TOKENS = 3000;

const DETECT_SYSTEM = `You identify what language a message is written in.
Answer with exactly one code from this list and nothing else: ${LOCALES.join(", ")}, other.
Judge the prose only. Code, URLs, product names, header names and error strings are not evidence of a language.
If the message is too short or too mixed to tell, answer: other`;

function translateSystem(target: Locale): string {
  return `You translate customer-support messages into ${LOCALE_ENGLISH_NAMES[target]}.

Rules:
- Output only the translation. No preamble, no notes, no quotes around it.
- Keep the meaning and the tone, including how formal or blunt it is. Do not soften a complaint, do not add pleasantries, do not summarize, do not answer the message.
- Leave these exactly as they are: URLs, file paths, email addresses, code, commands, configuration keys, HTTP header names and values, status codes, error strings, finding and check IDs, product and company names, and anything inside backticks.
- Keep the line breaks, lists and paragraph structure.
- If part of it is already in ${LOCALE_ENGLISH_NAMES[target]}, leave that part alone.`;
}

/** The language a message is written in, as far as the model can tell. */
export async function detectMessageLanguage(
  text: string,
): Promise<Locale | null> {
  const endpoint = resolveServerEndpoint();
  if (!endpoint) return null;
  const sample = text.trim().slice(0, 600);
  if (sample.length < 12) return null;

  const answer = await completeShortText(endpoint, {
    system: DETECT_SYSTEM,
    prompt: sample,
    maxTokens: 16,
    timeoutMs: 15_000,
  });
  if (!answer) return null;
  const code = answer
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "");
  const match = LOCALES.find((locale) => locale.toLowerCase() === code);
  return match ?? null;
}

/** The message in `target`, or null when it cannot be produced. */
export async function translateText(
  text: string,
  target: Locale,
): Promise<string | null> {
  const endpoint = resolveServerEndpoint();
  if (!endpoint) return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TRANSLATABLE_CHARS) return null;

  return completeShortText(endpoint, {
    system: translateSystem(target),
    prompt: trimmed,
    maxTokens: MAX_TRANSLATION_TOKENS,
    timeoutMs: 45_000,
  });
}

export interface TicketMessageRow {
  id: number;
  body: string;
  body_locale: string | null;
  translations: Record<string, string> | null;
}

/**
 * The message as `target` reads it: the cache, then the model, then null.
 *
 * Writes what it generates back to the row, so the second reader in that
 * language pays nothing and sees the same words as the first.
 */
export async function translateTicketMessage(
  message: TicketMessageRow,
  target: Locale,
): Promise<{ text: string; cached: boolean } | null> {
  const cached = message.translations?.[target];
  if (typeof cached === "string" && cached.trim()) {
    return { text: cached, cached: true };
  }
  // Already in that language: the original IS the translation.
  if (message.body_locale === target) {
    return { text: message.body, cached: true };
  }

  const text = await translateText(message.body, target);
  if (!text) return null;

  await pool
    .query(
      `UPDATE support_ticket_messages
          SET translations = COALESCE(translations, '{}'::jsonb) || $1::jsonb
        WHERE id = $2`,
      [JSON.stringify({ [target]: text }), message.id],
    )
    .catch(() => {
      // A cache that could not be written costs the next reader one more
      // call. It does not cost this one their translation.
    });
  return { text, cached: false };
}

/**
 * Detect a new message's language and translate it for the other side, once,
 * at the moment it is sent.
 *
 * Called fire-and-forget after the insert: the reply must not wait on a model,
 * and the thread reads fine without it. By the time the other side opens the
 * ticket the translation is usually already there.
 */
export async function prepareMessageTranslation(input: {
  messageId: number;
  body: string;
  authorLocale: Locale | null;
  counterpartLocales: (Locale | null)[];
}): Promise<void> {
  const detected =
    (await detectMessageLanguage(input.body)) ?? input.authorLocale;
  if (detected) {
    await pool
      .query(
        "UPDATE support_ticket_messages SET body_locale = $1 WHERE id = $2",
        [detected, input.messageId],
      )
      .catch(() => {});
  }

  const wanted = new Set(
    input.counterpartLocales
      .filter((locale): locale is Locale => isLocale(locale))
      .filter((locale) => locale !== detected),
  );
  // The side with no language of its own reads the default one, which is the
  // case for staff on a deployment where nobody has chosen.
  if (wanted.size === 0 && detected && detected !== DEFAULT_LOCALE) {
    wanted.add(DEFAULT_LOCALE);
  }

  for (const locale of wanted) {
    const text = await translateText(input.body, locale);
    if (!text) continue;
    await pool
      .query(
        `UPDATE support_ticket_messages
            SET translations = COALESCE(translations, '{}'::jsonb) || $1::jsonb
          WHERE id = $2`,
        [JSON.stringify({ [locale]: text }), input.messageId],
      )
      .catch(() => {});
  }
}
