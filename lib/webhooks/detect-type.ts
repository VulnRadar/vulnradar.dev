/**
 * Auto-detects a webhook's platform type from its URL. Shared by the create
 * route (app/api/v3/webhooks/route.ts) and the edit route
 * (app/api/v3/webhooks/[id]/route.ts) so the detection rule lives in one
 * place instead of two copies drifting apart.
 */
export function detectWebhookType(url: string): string {
  if (
    /discord\.com\/api\/webhooks/i.test(url) ||
    /discordapp\.com\/api\/webhooks/i.test(url)
  )
    return "discord";
  if (/hooks\.slack\.com/i.test(url)) return "slack";
  return "generic";
}
