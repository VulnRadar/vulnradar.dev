import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import {
  email2FACodeEmail,
  isEmailConfigured,
  sendEmail,
} from "@/lib/email/email";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { getSetting } from "@/lib/config/runtime-config";
import { getSession } from "@/lib/auth";
import { refuseWhileImpersonating } from "@/lib/auth/impersonation-guard";
import { resolvePendingUser } from "@/lib/auth/pending-user";
import { issueEmailCode, maskEmail } from "@/lib/auth/email-codes";
import { signedInCodeEmail } from "@/lib/auth/step-up-email";
import {
  STEP_UP_MAX_AGE_SECONDS,
  STEP_UP_SIGN_IN_MESSAGE,
} from "@/lib/auth/reauth";

export const POST = withErrorHandling(async (request: NextRequest) => {
  // The sign-in screen posts nothing; the step-up posts { purpose: "reauth" }.
  // A body that is not JSON is the sign-in screen, never an error.
  const body = (await request.json().catch(() => null)) as {
    purpose?: unknown;
  } | null;
  if (body && typeof body === "object" && body.purpose === "reauth") {
    return sendStepUpCode();
  }
  return sendLoginCode(request);
});

async function sendLoginCode(request: NextRequest) {
  // The user id comes ONLY from a signed pending cookie. A forgeable one here
  // would let anyone trigger a 2FA email to any account (and pin the userId
  // for the verify step). The same resolver as verify, so both agree on whose
  // sign-in this is when more than one pending cookie is present.
  const pending = await resolvePendingUser(request);
  if (!pending.ok) {
    return ApiResponse.unauthorized(
      pending.reason === "expired"
        ? "Login session expired. Please sign in again."
        : "No pending 2FA session.",
    );
  }
  const userId = pending.userId;

  const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [
    userId,
  ]);
  const user = userResult.rows[0];
  if (!user) return ApiResponse.badRequest("User not found.");

  const [cooldownSeconds, codeExpiryMinutes] = await Promise.all([
    getSetting("EMAIL_2FA_RESEND_COOLDOWN_SECONDS"),
    getSetting("EMAIL_2FA_CODE_EXPIRY_MINUTES"),
  ]);
  const issued = await issueEmailCode(
    userId,
    "login",
    codeExpiryMinutes,
    cooldownSeconds,
  );
  if (!issued.ok) {
    return ApiResponse.tooManyRequests(
      "Please wait before requesting another code.",
      issued.retryAfterSeconds,
    );
  }

  await sendEmail({
    to: user.email,
    ...email2FACodeEmail(issued.code, codeExpiryMinutes),
  });

  return ApiResponse.success({
    message: "Code sent.",
    maskedEmail: maskEmail(user.email),
  });
}

/**
 * The step-up for an account with no password: a code to the address on file,
 * which POST /auth/2fa/verify with { purpose: "reauth" } turns into the
 * ten-minute step-up cookie lib/auth/reauth.ts accepts. A signed-in session
 * is required, and an impersonation session is refused: the step-up stands in
 * for the account owner's password, which staff never have.
 */
async function sendStepUpCode() {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized();
  const refused = refuseWhileImpersonating(
    session,
    "Confirming a security change",
  );
  if (refused) return refused;

  // No mail, no code. The step-up on such a server is a fresh sign-in, and
  // `emailConfigured: false` tells the client to offer that instead.
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: STEP_UP_SIGN_IN_MESSAGE, emailConfigured: false },
      { status: 409 },
    );
  }

  const cooldownSeconds = await getSetting("EMAIL_2FA_RESEND_COOLDOWN_SECONDS");
  const issued = await issueEmailCode(
    session.userId,
    "reauth",
    STEP_UP_MAX_AGE_SECONDS / 60,
    cooldownSeconds,
  );
  if (!issued.ok) {
    return ApiResponse.tooManyRequests(
      "Please wait before requesting another code.",
      issued.retryAfterSeconds,
    );
  }

  await sendEmail({
    to: session.email,
    ...signedInCodeEmail("reauth", issued.code, STEP_UP_MAX_AGE_SECONDS / 60),
  });

  return ApiResponse.success({
    message: "Code sent.",
    maskedEmail: maskEmail(session.email),
  });
}
