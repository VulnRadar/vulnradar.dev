import {
  resolveProviderName,
  resolveAiBaseUrl,
  resolveAiDefaultModel,
} from "@/lib/ai/provider";
import { isAiDisabledForUser } from "@/lib/ai/user-ai-config";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const baseUrl = resolveAiBaseUrl();
  const configured = !!baseUrl && !!process.env.AI_API_KEY;

  // The chat widget, the dashboard and the scan menu hide their AI actions on
  // aiDisabled. When the switch cannot be read, it is reported as off: this
  // route answering "on" was how a database error offered AI to someone who
  // had turned it off. /scan/verify, /scan/verify-batch and the scan summary
  // refuse on the same failure (isAiDisabledForUser).
  let aiDisabled = false;
  try {
    const session = await getSession();
    if (session) aiDisabled = await isAiDisabledForUser(session.userId);
  } catch (error) {
    console.error("AI info: could not read the AI setting:", error);
    aiDisabled = true;
  }

  return Response.json({
    configured,
    model: resolveAiDefaultModel(baseUrl),
    provider: resolveProviderName(baseUrl),
    aiDisabled,
  });
}
