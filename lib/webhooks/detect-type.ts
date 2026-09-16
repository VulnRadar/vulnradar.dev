/**
 * What a webhook's `type` is allowed to be, and how it is worked out from a
 * URL. Shared by the create route (app/api/v3/webhooks/route.ts) and the edit
 * route (app/api/v3/webhooks/[id]/route.ts) so the rule lives in one place
 * instead of two copies drifting apart.
 */

/**
 * The three values that can be stored.
 *
 * `auto` is not one of them: it is an input value meaning "work it out from
 * the URL", and it is resolved to one of these before anything is written.
 */
export const WEBHOOK_TYPES = ["discord", "slack", "generic"] as const;
export type WebhookType = (typeof WEBHOOK_TYPES)[number];

export function isWebhookType(value: unknown): value is WebhookType {
  return (
    typeof value === "string" &&
    (WEBHOOK_TYPES as readonly string[]).includes(value)
  );
}

/** Auto-detects a webhook's platform type from its URL. */
export function detectWebhookType(url: string): WebhookType {
  if (
    /discord\.com\/api\/webhooks/i.test(url) ||
    /discordapp\.com\/api\/webhooks/i.test(url)
  )
    return "discord";
  if (/hooks\.slack\.com/i.test(url)) return "slack";
  return "generic";
}

/**
 * The type to store, or `null` when the caller sent one that is not a type.
 *
 * Both routes used to take any non-"auto" value the caller sent and write it
 * to the column unchanged. The create route did not even check it was a
 * string. Nothing downstream validates it either: scan-notifications.ts
 * branches on `webhookType === "discord"` and `=== "slack"` and treats
 * everything else as generic, so a Discord URL saved as "Discord" or "disc0rd"
 * quietly received flat JSON instead of an embed, for the rest of its life,
 * with no error at any point and the type shown back in the UI exactly as
 * sent. The API docs have always described this field as an enum.
 *
 * `undefined`, `null` and `"auto"` all mean detect, which is what a caller who
 * omits the field gets.
 */
export function resolveWebhookType(
  userType: unknown,
  url: string,
): WebhookType | null {
  if (userType === undefined || userType === null || userType === "auto") {
    return detectWebhookType(url);
  }
  return isWebhookType(userType) ? userType : null;
}

/** The 400 body both routes return for a rejected type. */
export const WEBHOOK_TYPE_ERROR = `type must be one of ${WEBHOOK_TYPES.map(
  (t) => `"${t}"`,
).join(", ")}, or "auto" to detect it from the URL.`;
