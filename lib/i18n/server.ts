import { getLocale, getTranslations } from "next-intl/server";
import type { SeverityName } from "@/lib/config/client-constants";
import {
  createFormatters,
  type FormatterOptions,
  type Formatters,
} from "./format";
import { severityLabeller } from "./severity";

/**
 * hooks.ts for an async server component, the way next-intl pairs
 * useTranslations with getTranslations. Kept in its own file because
 * next-intl/server must never end up in a client bundle.
 *
 * Code with no request behind it (the email sender, a cron sweep) has neither
 * a hook nor these: it calls createFormatters(locale) from format.ts, and
 * getSeverityLabeller(locale) from translate.ts, with the recipient's locale.
 */

/** The formatters for this request's language. */
export async function getFormatters(
  options?: FormatterOptions,
): Promise<Formatters> {
  return createFormatters(await getLocale(), options);
}

/** The word for a severity in this request's language. */
export async function getSeverityLabel(): Promise<
  (severity: SeverityName) => string
> {
  return severityLabeller(await getTranslations("result"));
}
