"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LoginForm, Login2FAForm } from "@/components/auth";
import { AuthLayout } from "@/components/auth/auth-layout";
import { APP_NAME } from "@/lib/config/constants";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginPageContent />
    </Suspense>
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
  const fallback = "/dashboard";
  if (!value) return fallback;
  const v = value.trim();
  if (!v || v.length > 512) return fallback;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\"))
    return fallback;
  return v;
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get("redirect"));
  const discordError = searchParams.get("error");
  const discord2FA = searchParams.get("discord_2fa");
  const discord2FAMethod = searchParams.get("method");

  const getInitialError = () => {
    if (discordError === "discord_not_linked")
      return "This Discord account is not linked to any account. Please sign up first, then connect your Discord in Profile settings.";
    if (discordError === "discord_denied")
      return "Discord authorization was cancelled.";
    if (discordError === "discord_expired")
      return "Discord login session expired. Please try again.";
    if (
      discordError === "discord_token_failed" ||
      discordError === "discord_failed"
    )
      return "Discord rejected the connection (invalid_client). Check that DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env.local match the Discord developer portal, and that the OAuth2 redirect URL there matches the app.";
    return "";
  };

  const [needs2FA, setNeeds2FA] = useState(discord2FA === "pending");
  const [twoFactorMethod, setTwoFactorMethod] = useState<string>(
    discord2FAMethod || "app",
  );
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [maskedEmail, setMaskedEmail] = useState("");
  const isDiscord2FA = discord2FA === "pending";

  function handleRequires2FA(userId: number, method: string, email?: string) {
    setNeeds2FA(true);
    setPendingUserId(userId);
    setTwoFactorMethod(method);
    if (email) setMaskedEmail(email);
  }

  const title = needs2FA
    ? twoFactorMethod === "email"
      ? "Check your email"
      : "Two-factor auth"
    : "Welcome back";

  const subtitle = needs2FA
    ? twoFactorMethod === "email"
      ? `We sent a 6-digit code to ${maskedEmail || "your email address"}`
      : "Enter the 6-digit code from your authenticator app"
    : `Sign in to your ${APP_NAME} account`;

  return (
    <AuthLayout>
      <div style={{ animation: "fade-in 0.2s ease-out both" }}>
        <div className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">{subtitle}</p>
        </div>
        {needs2FA ? (
          <Login2FAForm
            redirectTo={redirectTo}
            userId={pendingUserId}
            method={twoFactorMethod}
            _maskedEmail={maskedEmail}
            isDiscordAuth={isDiscord2FA}
          />
        ) : (
          <LoginForm
            redirectTo={redirectTo}
            initialError={getInitialError()}
            onRequires2FA={handleRequires2FA}
          />
        )}
      </div>
    </AuthLayout>
  );
}
