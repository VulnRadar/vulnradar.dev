"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm, Login2FAForm } from "@/components/auth";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { AuthHeading, AuthSteps } from "@/components/auth/auth-shell";
import { loginErrorCopy } from "@/components/auth/auth-error-copy";
import { withRedirect } from "@/components/auth/redirect-target";
import { Skeleton } from "@/components/ui/skeleton";
import { safeRedirect } from "@/lib/auth/safe-redirect";
import { APP_NAME, ROUTES } from "@/lib/config/client-constants";

const TWO_FACTOR_HEADING_ID = "login-2fa-heading";

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <LoginPageContent />
    </Suspense>
  );
}

/**
 * The fallback is what a phone paints first and what a crawler receives for
 * the indexable /login, because everything below it depends on
 * useSearchParams. It used to be one empty full-height div, so first paint was
 * a blank page. Rendering the real shell means the wordmark, the pitch rail
 * and the form's own frame are all there before hydration, and only the
 * fields themselves swap in.
 */
function AuthFormSkeleton() {
  return (
    <AuthSplitLayout>
      <div className="mb-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-3 h-4 w-full max-w-xs" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-4 w-32" />
      </div>
    </AuthSplitLayout>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Both forms router.push this after sign-in. Without the check, a link to
  // /login?redirect=<attacker page> bounces a freshly signed-in victim to a
  // fake "session expired" prompt on another origin.
  const redirectTo = safeRedirect(
    searchParams.get("redirect"),
    ROUTES.DASHBOARD,
  );
  const discord2FA = searchParams.get("discord_2fa");
  const oauth2FA = searchParams.get("oauth_2fa");
  const thirdPartyMethod = searchParams.get("method");

  const isDiscord2FA = discord2FA === "pending";
  const isOAuth2FA = oauth2FA === "pending";
  const isThirdPartyPending2FA = isDiscord2FA || isOAuth2FA;

  // Only the password flow's challenge is state. The third-party one is
  // derived from the query string on every render, because it lives there.
  //
  // This used to be a single `useState(isThirdPartyPending2FA)`, a one-time
  // initial value. "Start over" is router.push("/login"), a same-route soft
  // navigation, so the component never remounted and that initial value was
  // never recomputed: the query string lost discord_2fa=pending, but the
  // challenge form stayed on screen with pendingUserId reset to null, and
  // every subsequent submit posted a null userId. There was no way out of it
  // short of a hard reload.
  const [passwordNeeds2FA, setPasswordNeeds2FA] = useState(false);
  const needs2FA = isThirdPartyPending2FA || passwordNeeds2FA;
  const [twoFactorMethod, setTwoFactorMethod] = useState<string>(
    thirdPartyMethod || "app",
  );
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [maskedEmail, setMaskedEmail] = useState("");

  function handleRequires2FA(userId: number, method: string, email?: string) {
    setPasswordNeeds2FA(true);
    setPendingUserId(userId);
    setTwoFactorMethod(method);
    if (email) setMaskedEmail(email);
  }

  function handleCancel2FA() {
    setPasswordNeeds2FA(false);
    setPendingUserId(null);
    setMaskedEmail("");
    setTwoFactorMethod("app");
    // A third-party (Discord-link or OAuth) challenge is driven by the query
    // string, so clearing the state is not enough: the params have to go too
    // or `needs2FA` above resolves back to true on the next render.
    if (isThirdPartyPending2FA) {
      router.push(withRedirect(ROUTES.LOGIN, redirectTo));
    }
  }

  const title = needs2FA
    ? twoFactorMethod === "email"
      ? "Check your email for a code"
      : "Confirm it is you"
    : "Sign in";

  const description = needs2FA
    ? twoFactorMethod === "email"
      ? `We sent a 6-digit code to ${maskedEmail || "the email on your account"}. It is good for one sign-in.`
      : "Open your authenticator app and enter the current 6-digit code for this account."
    : `Your ${APP_NAME} scan history, API keys, and schedules are behind this form.`;

  return (
    <AuthSplitLayout>
      {needs2FA ? (
        <>
          <AuthSteps current={2} total={2} />
          <AuthHeading
            id={TWO_FACTOR_HEADING_ID}
            title={title}
            description={description}
          />
          <Login2FAForm
            redirectTo={redirectTo}
            userId={pendingUserId}
            method={twoFactorMethod}
            _maskedEmail={maskedEmail}
            isDiscordAuth={isThirdPartyPending2FA}
            onCancel={handleCancel2FA}
            headingId={TWO_FACTOR_HEADING_ID}
          />
        </>
      ) : (
        <>
          <AuthHeading title={title} description={description} />
          <LoginForm
            redirectTo={redirectTo}
            initialError={loginErrorCopy(
              searchParams.get("error"),
              searchParams.get("provider"),
            )}
            onRequires2FA={handleRequires2FA}
          />
        </>
      )}
    </AuthSplitLayout>
  );
}
