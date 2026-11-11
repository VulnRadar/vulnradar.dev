import type { NextResponse } from "next/server";

import { ApiResponse } from "@/lib/api/api-utils";
import {
  apiKeyScopeErrorMessage,
  hasApiKeyScope,
  type ApiKeyScope,
} from "@/lib/api/api-key-scopes";
import { validateApiKey } from "@/lib/api/api-keys";
import { parseBearer } from "@/lib/api/bearer";
import type { ErrorCode } from "@/lib/api/error-codes";

/**
 * A bad, revoked, IP-mismatched and disabled-account key all get this one
 * sentence, so a leaked key cannot be probed for which of those it is.
 */
export const INVALID_API_KEY_MESSAGE = "Invalid or revoked API key.";

export const TERMS_ACCEPTANCE_REQUIRED_MESSAGE =
  "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.";

export type ApiKeyAuth = NonNullable<
  Awaited<ReturnType<typeof validateApiKey>>
>;

export type ApiKeyAuthResult =
  { ok: true; auth: ApiKeyAuth } | { ok: false; response: NextResponse };

/**
 * The block every key-authenticated route used to copy: read the header,
 * validate the key, refuse an account behind on the Terms, check the scope.
 * Copied seventeen times, four copies had lost the Terms check.
 *
 * Deliberately not here: charging the key's budget, and deciding between a
 * key and a session. Which routes charge and in what order differs per route
 * and is part of what each one means.
 *
 * Which API version and client the key was used with is recorded by
 * validateApiKey itself, so it covers this path and the routes that still
 * validate directly, metered or not.
 */
export async function authenticateApiKey(
  request: Request,
  options: { scope?: ApiKeyScope } = {},
): Promise<ApiKeyAuthResult> {
  const token = parseBearer(request.headers.get("authorization"));
  if (token === null) {
    return refuse(request, 401, "UNAUTHENTICATED", INVALID_API_KEY_MESSAGE);
  }

  const auth = await validateApiKey(token);
  if (!auth) {
    return refuse(request, 401, "INVALID_API_KEY", INVALID_API_KEY_MESSAGE);
  }
  if (auth.needsTermsAcceptance) {
    return refuse(
      request,
      403,
      "TERMS_ACCEPTANCE_REQUIRED",
      TERMS_ACCEPTANCE_REQUIRED_MESSAGE,
    );
  }
  if (options.scope && !hasApiKeyScope(auth.scopes, options.scope)) {
    return refuse(
      request,
      403,
      "SCOPE_MISSING",
      apiKeyScopeErrorMessage(options.scope),
    );
  }
  return { ok: true, auth };
}

function refuse(
  request: Request,
  status: number,
  code: ErrorCode,
  message: string,
): ApiKeyAuthResult {
  return {
    ok: false,
    response: ApiResponse.fail({ code, message, status, request }),
  };
}
