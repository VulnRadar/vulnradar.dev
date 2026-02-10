"use client"

import { useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Users, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"
import Link from "next/link"

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
      const res = await fetch("/api/teams/accept-invite", {
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
        <CardContent className="py-12 flex flex-col items-center gap-3">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-foreground">Invalid Invite Link</p>
          <p className="text-xs text-muted-foreground">This link is missing a valid token.</p>
          <Link href="/teams"><Button variant="outline" size="sm" className="bg-transparent mt-2">Go to Teams</Button></Link>
        </CardContent>
      </Card>
    )
  }

  if (success) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-12 flex flex-col items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="text-sm font-medium text-foreground">You have joined the team!</p>
          <p className="text-xs text-muted-foreground">Redirecting to teams...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="py-8 flex flex-col items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Users className="h-6 w-6 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Team Invitation</p>
          <p className="text-xs text-muted-foreground mt-1">You have been invited to join a team on VulnRadar.</p>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 w-full max-w-xs">
            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={handleAccept} disabled={loading}>
            {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Joining...</> : "Accept Invite"}
          </Button>
          <Link href="/teams"><Button variant="outline" className="bg-transparent">Decline</Button></Link>
        </div>
      </CardContent>
    </Card>
  )
}

export default function JoinTeamPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Image
            src="/favicon.svg"
            alt="VulnRadar logo"
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="text-2xl font-bold text-foreground font-mono tracking-tight">VulnRadar</span>
        </div>
        <Suspense fallback={null}>
          <JoinForm />
        </Suspense>
      </div>
    </div>
  )
}
