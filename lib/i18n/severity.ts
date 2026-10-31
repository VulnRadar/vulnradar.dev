import type { SeverityName } from "@/lib/config/client-constants";

/**
 * Which `result` message holds the word for each severity.
 *
 * The word a reader sees is translated; the value stored in a scan and sent
 * over the API ("high") is not (lib/i18n/README.md). SEVERITY_LABELS in
 * lib/config/client-constants.ts is the English side of the same table and is
 * what an untranslated surface still prints.
 *
 * Written out rather than built as `severity${Capitalised}`, so a search for
 * "severityHigh" finds its user and tests/lib/i18n/key-parity.test.ts can see
 * the key is in use. The Record type makes a sixth severity a compile error
 * here instead of a missing label there.
 */
export const SEVERITY_LABEL_KEYS = {
  critical: "severityCritical",
  high: "severityHigh",
  medium: "severityMedium",
  low: "severityLow",
  info: "severityInfo",
} as const satisfies Record<SeverityName, string>;

export type SeverityLabelKey =
  (typeof SEVERITY_LABEL_KEYS)[keyof typeof SEVERITY_LABEL_KEYS];

/** A translator scoped to the `result` namespace. */
export type ResultTranslator = (key: SeverityLabelKey) => string;

/**
 * The function that turns a severity into its word, for a translator already
 * scoped to `result`. The hook, the server component and the email sender
 * each get that translator their own way and share this.
 *
 * A value outside the five (a row from an older engine) is printed as it is,
 * not as a dotted key.
 */
export function severityLabeller(
  t: ResultTranslator,
): (severity: SeverityName) => string {
  return (severity) => {
    const key = SEVERITY_LABEL_KEYS[severity];
    return key ? t(key) : String(severity);
  };
}
