/**
 * What makes a URL a Discord webhook: one of Discord's hosts, and the
 * webhooks path under its API.
 *
 * The webhook type detector (lib/webhooks/detect-type.ts) and the scanner's
 * leaked-webhook pattern (lib/scanner/checks/code.ts) both ask this. Each
 * used to carry its own host list and its own path regex, so the versioned
 * path had to be taught to them one at a time, and they disagreed on case:
 * the detector matched the path case-insensitively and the scanner matched
 * neither the host nor the path that way.
 *
 * The case rule, decided once here: hosts compare case-insensitively
 * (hostMatches lower-cases them), and so does the path, because every
 * pattern built on it goes through discordWebhookPattern. What identifies a
 * webhook is its id and token, and a URL that spells /API/WEBHOOKS/ still
 * hands both to whoever reads it.
 */

import { hostMatches, type HostSpec } from "@/lib/net/host-match";

// ptb. and canary. are Discord's own client hosts and serve the same API.
export const DISCORD_WEBHOOK_HOSTS: readonly HostSpec[] = [
  { host: "discord.com", subdomains: true },
  { host: "discordapp.com", subdomains: true },
];

/** True when `host` is one of Discord's hosts or a subdomain of one. */
export function isDiscordHost(host: string): boolean {
  return DISCORD_WEBHOOK_HOSTS.some((spec) => hostMatches(host, spec));
}

// Discord accepts webhooks on the unversioned path and on every versioned one
// (/api/v10/webhooks/...), and its docs and client libraries write the latter.
const DISCORD_WEBHOOK_PATH = String.raw`\/api\/(?:v\d+\/)?webhooks\/`;

/**
 * A regex with the Discord webhook path between `before` and `after` (both
 * regex source), compiled case-insensitively. `global` is for a pattern run
 * with matchAll over a body.
 */
export function discordWebhookPattern(
  before: string,
  after: string,
  { global = false }: { global?: boolean } = {},
): RegExp {
  return new RegExp(
    `${before}${DISCORD_WEBHOOK_PATH}${after}`,
    global ? "gi" : "i",
  );
}
