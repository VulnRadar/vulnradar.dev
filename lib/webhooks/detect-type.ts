/**
 * What a webhook's `type` is allowed to be, and how it is worked out from a
 * URL. Shared by the create route (app/api/v3/webhooks/route.ts) and the edit
 * route (app/api/v3/webhooks/[id]/route.ts) so the rule lives in one place
 * instead of two copies drifting apart.
 */

import {
  discordWebhookPattern,
  isDiscordHost,
} from "@/lib/net/discord-webhook";

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

const DISCORD_WEBHOOK_PATH = discordWebhookPattern("^", "");

// Discord serves two compatibility endpoints under every webhook, after the
// id and the token: /slack reads a Slack payload and /github reads a GitHub
// event. Neither reads an embed.
const DISCORD_COMPAT_ENDPOINT = discordWebhookPattern(
  "^",
  String.raw`[^/]+\/[^/]+\/(slack|github)\/?$`,
);

/**
 * The format a Discord compatibility endpoint is sent, or null when the path
 * is not one. /github gets the generic body: no GitHub-shaped payload is
 * built anywhere, and an embed is the one thing it certainly does not read.
 */
function discordCompatFormat(pathname: string): WebhookType | null {
  const m = DISCORD_COMPAT_ENDPOINT.exec(pathname);
  if (!m) return null;
  return m[1].toLowerCase() === "slack" ? "slack" : "generic";
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Auto-detects a webhook's platform type from its URL.
 *
 * Compares the parsed hostname rather than matching the provider's name
 * anywhere in the string: an unanchored match took
 * https://hooks.slack.com.example.net/ or https://example.net/?u=hooks.slack.com
 * as Slack and sent that host a Slack-shaped payload. A string that does not
 * parse as a URL is generic.
 */
export function detectWebhookType(url: string): WebhookType {
  const parsed = parseUrl(url);
  if (!parsed) return "generic";
  const host = parsed.hostname.toLowerCase();
  if (isDiscordHost(host)) {
    const compat = discordCompatFormat(parsed.pathname);
    if (compat) return compat;
    if (DISCORD_WEBHOOK_PATH.test(parsed.pathname)) return "discord";
  }
  if (host === "hooks.slack.com") return "slack";
  return "generic";
}

/**
 * The payload format a stored webhook is sent.
 *
 * The stored type wins, with one exception: a row stored as discord whose
 * URL is one of Discord's own compatibility endpoints. Rows saved before the
 * detector knew about /slack and /github hold discord, and no caller can
 * have meant an embed for an endpoint that does not read one. A discord type
 * pinned on any other URL, a proxy included, is kept.
 */
export function deliveryFormat(storedType: string, url: string): string {
  if (storedType !== "discord") return storedType;
  const parsed = parseUrl(url);
  if (!parsed || !isDiscordHost(parsed.hostname)) return storedType;
  return discordCompatFormat(parsed.pathname) ?? storedType;
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
