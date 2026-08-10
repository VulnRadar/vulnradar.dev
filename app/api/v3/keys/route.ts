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
import { ERROR_MESSAGES, DEFAULT_NEW_KEY_SCOPES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import {
  getUserPlanLimits,
  withinPlanLimit,
  planLimitMessage,
} from "@/lib/billing/plan-limits";
import { ALL_API_KEY_SCOPES, type ApiKeyScope } from "@/lib/api/api-key-scopes";

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

  if (!(await getSetting("FEATURE_API_KEYS"))) {
    return ApiResponse.forbidden("API keys are disabled on this deployment.");
  }

  const parsed = await parseBody<{ name?: string; scopes?: unknown }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const name = (parsed.data.name?.trim() || "Default").slice(0, 100);

  const nameError = Validate.string(name, "Key name", 1, 100);
  if (nameError) return ApiResponse.badRequest(nameError);

  // scoping: defaults to scan:write + scan:read (not scan:delete) when the
  // caller doesn't specify scopes at all -- a non-destructive default for a
  // freshly created integration token. An explicit scopes array must be
  // non-empty and contain only known scope strings; a key with literally
  // zero capabilities is a UI bug, not a valid state, so that's rejected
  // rather than silently accepted.
  let scopes: ApiKeyScope[] = DEFAULT_NEW_KEY_SCOPES;
  if (parsed.data.scopes !== undefined) {
    const requested = parsed.data.scopes;
    const isValid =
      Array.isArray(requested) &&
      requested.every(
        (s): s is ApiKeyScope =>
          typeof s === "string" && (ALL_API_KEY_SCOPES as string[]).includes(s),
      );
    if (!isValid) {
      return ApiResponse.badRequest(
        `scopes must be an array containing only: ${ALL_API_KEY_SCOPES.join(", ")}`,
      );
    }
    if (requested.length === 0) {
      return ApiResponse.badRequest("Select at least one scope for this key.");
    }
    scopes = Array.from(new Set(requested)) as ApiKeyScope[];
  }

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
    scopes,
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
