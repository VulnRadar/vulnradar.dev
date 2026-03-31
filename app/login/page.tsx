"use client"

import React, { Suspense } from "react"
import { useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoginForm, Login2FAForm } from "@/components/auth"
import { APP_NAME } from "@/lib/config/constants"

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginPageContent />
    </Suspense>
  )
}

function LoginPageContent() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect") || "/dashboard"
  const discordError = searchParams.get("error")
  const discord2FA = searchParams.get("discord_2fa")
  const discord2FAMethod = searchParams.get("method")
  
  // Map Discord error codes to user-friendly messages
  const getInitialError = () => {
    if (discordError === "discord_not_linked") {
      return "This Discord account is not linked to any account. Please sign up first, then connect your Discord in Profile settings."
    }
    if (discordError === "discord_denied") {
      return "Discord authorization was cancelled."
    }
    if (discordError === "discord_expired") {
      return "Discord login session expired. Please try again."
    }
    if (discordError === "discord_failed") {
      return "Discord login failed. Please try again."
    }
    return ""
  }

  // 2FA state
  const [needs2FA, setNeeds2FA] = useState(discord2FA === "pending")
  const [twoFactorMethod, setTwoFactorMethod] = useState<string>(discord2FAMethod || "app")
  const [pendingUserId, setPendingUserId] = useState<number | null>(null)
  const [maskedEmail, setMaskedEmail] = useState("")
  const isDiscord2FA = discord2FA === "pending"

  function handleRequires2FA(userId: number, method: string, email?: string) {
    setNeeds2FA(true)
    setPendingUserId(userId)
    setTwoFactorMethod(method)
    if (email) setMaskedEmail(email)
  }

  // Determine card title and description based on state
  const getCardTitle = () => {
    if (!needs2FA) return "Welcome back"
    if (twoFactorMethod === "email") return "Check Your Email"
    return "Two-Factor Authentication"
  }

  const getCardDescription = () => {
    if (!needs2FA) return `Sign in to your ${APP_NAME} account`
    if (twoFactorMethod === "email") {
      return `We sent a 6-digit code to ${maskedEmail || "your email address"}`
    }
    return "Enter the 6-digit code from your authenticator app"
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Background glow orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
      
      <div className="w-full max-w-sm relative z-10 animate-fade-in">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2.5 mb-8 group transition-colors">
          <ThemedLogo width={28} height={28} className="h-7 w-7 transition-transform group-hover:scale-105" alt={`${APP_NAME} logo`} />
          <span className="text-xl font-semibold text-foreground tracking-tight">{APP_NAME}</span>
        </Link>
        
        <Card className="border-border/50 bg-card/95 backdrop-blur-sm shadow-xl">
          <CardHeader className="text-center pb-4 pt-8 px-6">
            <CardTitle className="text-xl font-semibold tracking-tight">
              {getCardTitle()}
            </CardTitle>
            <CardDescription className="mt-2 text-muted-foreground">
              {getCardDescription()}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8 px-6">
            {needs2FA ? (
              <Login2FAForm
                redirectTo={redirectTo}
                userId={pendingUserId}
                method={twoFactorMethod}
                maskedEmail={maskedEmail}
                isDiscordAuth={isDiscord2FA}
              />
            ) : (
              <LoginForm
                redirectTo={redirectTo}
                initialError={getInitialError()}
                onRequires2FA={handleRequires2FA}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
