/**
 * Input rules for an admin-authored site notification, in one place for the
 * create route, the edit route and the dialog that drafts one.
 *
 * The dialog used to send whatever was typed and learn about a bad link from
 * a 400 whose reason it threw away, so a notice with a mistyped URL appeared
 * to save and did nothing. With the rule here the dialog says what is wrong
 * before it sends, and when the server refuses anyway its reason is the same
 * sentence.
 */

export const ACTION_URL_FIELDS = ["action_url", "action_url_2"] as const;
export type ActionUrlField = (typeof ACTION_URL_FIELDS)[number];

const FIELD_LABELS: Record<ActionUrlField, string> = {
  action_url: "The first button's URL",
  action_url_2: "The second button's URL",
};

/**
 * Why this action URL cannot be saved, or null when it can (an empty one
 * means "no button").
 *
 * The URL is rendered as an <a href> in front of every visitor the notice
 * targets, so only http(s) and same-origin paths pass: a `javascript:` or
 * `data:` link stored here would run in this site's origin on one click, and
 * a `//host` path is another site.
 */
export function actionUrlProblem(
  field: ActionUrlField,
  value: unknown,
): string | null {
  if (value == null || value === "") return null;
  const label = FIELD_LABELS[field];
  if (typeof value !== "string") return `${label} must be text.`;
  const lower = value.trim().toLowerCase();
  const allowed =
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    (lower.startsWith("/") && !lower.startsWith("//"));
  return allowed
    ? null
    : `${label} must start with https://, http:// or a / path on this site. Other schemes such as javascript: and data: are refused.`;
}

/** The first action-URL problem in a body, or null. */
export function firstActionUrlProblem(
  body: Partial<Record<ActionUrlField, unknown>>,
): string | null {
  for (const field of ACTION_URL_FIELDS) {
    const problem = actionUrlProblem(field, body[field]);
    if (problem) return problem;
  }
  return null;
}

/**
 * A database refusal the person who typed the value can fix, said in their
 * terms, or null for anything else (which stays a generic 500).
 *
 * A start or end time the browser produced but Postgres cannot read, or a
 * number too large for its column, used to come back as "Failed to update
 * notification", which says nothing about which field to change.
 */
export function notificationInputError(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "22007" || code === "22008") {
    return "The start or end time is not a date and time the server can read.";
  }
  if (code === "22003") {
    return "Priority or the dismiss duration is too large.";
  }
  if (code === "22P02") {
    return "Priority and the dismiss duration must be whole numbers.";
  }
  if (code === "22001") {
    // The column widths in admin_notifications (lib/database/schema/01-core.mjs).
    return "A field is longer than it can hold: a title takes 255 characters, a button label 100 and a URL 500.";
  }
  if (code === "23514") {
    return "Type, variant or audience is not one of the listed options.";
  }
  return null;
}
