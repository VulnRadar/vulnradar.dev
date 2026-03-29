"use client"

import { useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { Card, CardContent } from "@/components/ui/card"
import { Users, Loader2, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react"
import Link from "next/link"
import { APP_NAME, API } from "@/lib/config/constants"

function JoinForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get("token")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  async function handleAccept() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(API.TEAMS_ACCEPT_INVITE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setSuccess(true)
      setTimeout(() => router.push("/teams"), 2000)
    } catch {
      setError("Something went wrong.")
    } finally { setLoading(false) }
  }

  if (!token) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-12 flex flex-col items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/10">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Invalid Invite Link</p>
            <p className="text-xs text-muted-foreground mt-1">This link is missing a valid token.</p>
          </div>
          <Link href="/teams">
            <Button variant="outline" size="sm" className="gap-1.5">
              Go to Teams<ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (success) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-12 flex flex-col items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">You have joined the team!</p>
            <p className="text-xs text-muted-foreground mt-1">Redirecting to teams...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="py-10 px-8 flex flex-col items-center gap-6">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10">
          <Users className="h-7 w-7 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold">Team Invitation</p>
          <p className="text-sm text-muted-foreground mt-1.5">You have been invited to join a team on {APP_NAME}.</p>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 w-full">
            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}
        <div className="flex gap-3 w-full">
          <Button onClick={handleAccept} disabled={loading} className="flex-1 h-11">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Joining...</> : "Accept Invite"}
          </Button>
          <Link href="/teams" className="flex-1">
            <Button variant="outline" className="w-full h-11">Decline</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export default function JoinTeamPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <ThemedLogo width={36} height={36} className="h-9 w-9" alt={`${APP_NAME} logo`} />
          <span className="text-2xl font-bold font-mono tracking-tight">{APP_NAME}</span>
        </div>
        <Suspense fallback={
          <Card className="bg-card border-border">
            <CardContent className="py-12 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </CardContent>
          </Card>
        }>
          <JoinForm />
        </Suspense>
      </div>
    </div>
  )
}
