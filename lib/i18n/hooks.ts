import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { SeverityName } from "@/lib/config/client-constants";
import {
  createFormatters,
  type FormatterOptions,
  type Formatters,
} from "./format";
import { severityLabeller } from "./severity";

/**
 * Formatting and severity words for a component that renders in the reader's
 * language.
 *
 * This file does not say "use client" on purpose: next-intl's own hooks work
 * in a client component and in a synchronous server component, and so do
 * these. An async server component uses the equivalents in server.ts.
 */

/**
 * Dates, relative times and numbers in the reader's language.
 *
 *   const fmt = useFormatters();
 *   <time dateTime={iso}>{fmt.date(iso) ?? t("unknownDate")}</time>
 *
 * The language is the provider's, so it follows the account's setting like
 * every translated string does. The same object comes back every render.
 */
export function useFormatters(options?: FormatterOptions): Formatters {
  return createFormatters(useLocale(), options);
}

/**
 * The word for a severity in the reader's language, from `result.severity*`.
 *
 *   const severityLabel = useSeverityLabel();
 *   <Badge>{severityLabel(finding.severity)}</Badge>
 *
 * SEVERITY_TONE's `label` is the English one and stays what a surface that is
 * not translated yet prints; a translated surface uses this instead.
 */
export function useSeverityLabel(): (severity: SeverityName) => string {
  const t = useTranslations("result");
  return useMemo(() => severityLabeller(t), [t]);
}
