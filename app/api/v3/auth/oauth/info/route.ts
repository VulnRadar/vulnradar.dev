import {
  OAUTH_PROVIDER_IDS,
  isOAuthProviderConfigured,
} from "@/lib/auth/oauth-providers";

export const runtime = "nodejs";

// Public, unauthenticated "tell the client what's configured" endpoint --
// same shape as /api/v3/ai/info's `configured` field. Never exposes a
// client secret, only whether each provider's client id + secret pair is
// present, so the login/signup forms know which buttons to render.
export async function GET() {
  const configured = Object.fromEntries(
    OAUTH_PROVIDER_IDS.map((id) => [id, isOAuthProviderConfigured(id)]),
  ) as Record<(typeof OAUTH_PROVIDER_IDS)[number], boolean>;

  return Response.json(configured);
}
