"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm, Login2FAForm } from "@/components/auth";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { AuthHeading, AuthSteps } from "@/components/auth/auth-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_NAME, ROUTES } from "@/lib/config/client-constants";

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

/**
 * Restrict post-login redirects to a safe same-origin path. Anything
 * with a scheme/host (e.g. `https://evil.com`, `//evil.com`, `\\evil.com`,
 * `javascript:...`) is stripped to the dashboard default. Without
 * this, an attacker can phish credentials by sending a victim
 * `/login?redirect=https://evil.com` and capturing the post-login
 * bounce (the victim briefly sees the real domain, then is sent to
 * the attacker page styled as a "session expired" prompt).
 */
function safeRedirect(value: string | null): string {
  const fallback = ROUTES.DASHBOARD;
  if (!value) return fallback;
  const v = value.trim();
  if (!v || v.length > 512) return fallback;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\"))
    return fallback;
  return v;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get("redirect"));
  const authError = searchParams.get("error");
  const authErrorMessage = searchParams.get("message");
  const discord2FA = searchParams.get("discord_2fa");
  const oauth2FA = searchParams.get("oauth_2fa");
  const thirdPartyMethod = searchParams.get("method");

  const getInitialError = () => {
    if (authError === "discord_not_linked")
      return "No account is linked to that Discord login. Create an account with your email first, then connect Discord from your profile.";
    if (authError === "discord_denied")
      return "Discord login was cancelled. Nothing was shared with us.";
    if (authError === "discord_expired")
      return "That Discord login took too long and expired. Start it again.";
    if (authError === "invalid_token")
      return "That link is missing its token, so there is nothing to verify. Sign in and request a new verification email.";
    if (authError === "discord_not_configured")
      return "Discord sign-in is not set up on this instance yet.";
    if (
      authError === "discord_invalid_state" ||
      authError === "discord_invalid"
    )
      return "That Discord login could not be verified. Start it again from this page.";
    if (
      authError === "discord_token_failed" ||
      authError === "discord_failed" ||
      authError === "discord_user_failed"
    )
      return "Discord rejected the connection. If you run this instance, check that DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and the OAuth2 redirect URL match the Discord developer portal.";
    // Google/GitHub/Discord sign-up-or-sign-in (app/api/v3/auth/oauth/),
    // separate from the discord_* codes above, which belong to the
    // existing account-linking flow.
    if (authError === "oauth_email_in_use")
      return (
        (authErrorMessage && decodeURIComponent(authErrorMessage)) ||
        "An account with this email already exists. Sign in with your password instead."
      );
    if (authError === "oauth_no_account")
      return (
        (authErrorMessage && decodeURIComponent(authErrorMessage)) ||
        "No account uses that sign-in yet. Sign up first."
      );
    if (authError === "oauth_denied")
      return "That sign-in was cancelled. Nothing was shared with us.";
    if (authError === "oauth_expired" || authError === "oauth_invalid_state")
      return "That sign-in took too long and expired. Start it again.";
    if (authError === "oauth_email_unverified")
      return "That provider account has no verified email, so we cannot use it to sign in.";
    if (authError === "oauth_account_disabled")
      return "This account has been suspended. Please contact support.";
    if (authError === "oauth_not_configured")
      return "That sign-in option is not set up on this instance yet.";
    if (
      authError === "oauth_token_failed" ||
      authError === "oauth_user_failed" ||
      authError === "oauth_failed" ||
      authError === "oauth_invalid"
    )
      return "That sign-in did not go through. Try again.";
    if (authError === "session_expired")
      return "Your session expired. Sign in again to continue.";
    // Catch-all: the OAuth callbacks emit codes this mapper does not know
    // (discord_invalid, discord_user_failed, and anything added later). Without
    // this, an unmapped code rendered an empty string and the user got a normal
    // looking login form with no hint that their sign-in had failed.
    if (authError) return "Sign-in failed. Try again, or use another method.";
    return "";
  };

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
      router.push("/login");
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
          <AuthHeading title={title} description={description} focusOnMount />
          <Login2FAForm
            redirectTo={redirectTo}
            userId={pendingUserId}
            method={twoFactorMethod}
            _maskedEmail={maskedEmail}
            isDiscordAuth={isThirdPartyPending2FA}
            onCancel={handleCancel2FA}
          />
        </>
      ) : (
        <>
          <AuthHeading title={title} description={description} />
          <LoginForm
            redirectTo={redirectTo}
            initialError={getInitialError()}
            onRequires2FA={handleRequires2FA}
          />
        </>
      )}
    </AuthSplitLayout>
  );
}
