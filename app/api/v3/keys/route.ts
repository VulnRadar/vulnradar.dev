import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { generateApiKey, getUserApiKeys } from "@/lib/api/api-keys";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { apiKeyCreatedEmail } from "@/lib/email/email";
import {
  ApiResponse,
  parseBody,
  Validate,
  withErrorHandling,
} from "@/lib/api/api-utils";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import {
  getUserPlanLimits,
  withinPlanLimit,
  planLimitMessage,
} from "@/lib/billing/plan-limits";

export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  const keys = await getUserApiKeys(session.userId);
  return ApiResponse.success({ keys });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  const parsed = await parseBody<{ name?: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const name = (parsed.data.name?.trim() || "Default").slice(0, 100);

  const nameError = Validate.string(name, "Key name", 1, 100);
  if (nameError) return ApiResponse.badRequest(nameError);

  const existing = await getUserApiKeys(session.userId);
  const activeKeys = existing.filter(
    (k: { revoked_at: string | null }) => !k.revoked_at,
  );

  const planLimits = await getUserPlanLimits(session.userId);
  if (planLimits && !withinPlanLimit(activeKeys.length, planLimits.apiKeys)) {
    return ApiResponse.badRequest(
      planLimits.apiKeys === 0
        ? planLimitMessage("API keys", planLimits.apiKeys)
        : `${planLimitMessage("API keys", planLimits.apiKeys)} Rotate an existing key instead.`,
    );
  }

  // billing: reuse the plan limits already resolved above instead of a
  // second, separate lookup. planLimits is null when billing is off or the
  // caller is staff, both of which mean unlimited here too.
  const dailyLimit = planLimits ? planLimits.apiRequestsPerDay : -1;

  const key = await generateApiKey(
    session.userId,
    name,
    dailyLimit === -1 ? 999999 : dailyLimit,
  );

  // Send notification email in background
  const ip = await getClientIp();
  const userAgent = await getUserAgent();
  const emailContent = apiKeyCreatedEmail(name, key.key_prefix, {
    ipAddress: ip,
    userAgent,
  });

  setImmediate(() => {
    sendNotificationEmail({
      userId: session.userId,
      userEmail: session.email,
      type: "api_keys",
      emailContent,
    }).catch((err) =>
      console.error(
        "[Email Error] Failed to send API key created notification:",
        err,
      ),
    );
  });

  return ApiResponse.success({ key }, 201);
});
