"use client"

import { useState, useEffect } from "react"
import { Shield, Key, Smartphone, Monitor, Globe, Loader2, Check, X, LogOut, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { API } from "@/lib/config/constants"
import { useProfile } from "../profile-context"
import { getRelativeTime } from "../profile-types"
import type { Session } from "../profile-types"

export function ProfileSecurityTab() {
  const { profile, sessions, setSessions } = useProfile()

  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [isEnabling2FA, setIsEnabling2FA] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(profile?.twoFactorEnabled || false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState("")

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions()
  }, [])

  const fetchSessions = async () => {
    try {
      setIsLoadingSessions(true)
      const res = await fetch(`${API.ME}/sessions`, { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error)
    } finally {
      setIsLoadingSessions(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordErrors([])

    // Validation
    const errors: string[] = []
    if (!passwordForm.currentPassword) errors.push("Current password is required")
    if (!passwordForm.newPassword) errors.push("New password is required")
    if (passwordForm.newPassword.length < 8) errors.push("Password must be at least 8 characters")
    if (passwordForm.newPassword !== passwordForm.confirmPassword) errors.push("Passwords do not match")

    if (errors.length > 0) {
      setPasswordErrors(errors)
      return
    }

    setIsChangingPassword(true)
    try {
      const res = await fetch(`${API.ME}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })

      if (res.ok) {
        toast.success("Password changed successfully")
        setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" })
      } else {
        const data = await res.json()
        toast.error(data.message || "Failed to change password")
      }
    } catch (error) {
      toast.error("Failed to change password")
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleEnable2FA = async () => {
    setIsEnabling2FA(true)
    try {
      const res = await fetch(`${API.ME}/2fa/setup`, {
        method: "POST",
        credentials: "include",
      })

      if (res.ok) {
        const data = await res.json()
        setQrCode(data.qrCode)
      } else {
        toast.error("Failed to setup 2FA")
      }
    } catch (error) {
      toast.error("Failed to setup 2FA")
    } finally {
      setIsEnabling2FA(false)
    }
  }

  const handleVerify2FA = async () => {
    if (verificationCode.length !== 6) {
      toast.error("Please enter a 6-digit code")
      return
    }

    try {
      const res = await fetch(`${API.ME}/2fa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: verificationCode }),
      })

      if (res.ok) {
        setTwoFactorEnabled(true)
        setQrCode(null)
        setVerificationCode("")
        toast.success("Two-factor authentication enabled")
      } else {
        toast.error("Invalid verification code")
      }
    } catch (error) {
      toast.error("Failed to verify code")
    }
  }

  const handleDisable2FA = async () => {
    try {
      const res = await fetch(`${API.ME}/2fa`, {
        method: "DELETE",
        credentials: "include",
      })

      if (res.ok) {
        setTwoFactorEnabled(false)
        toast.success("Two-factor authentication disabled")
      } else {
        toast.error("Failed to disable 2FA")
      }
    } catch (error) {
      toast.error("Failed to disable 2FA")
    }
  }

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch(`${API.ME}/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (res.ok) {
        setSessions(sessions.filter((s) => s.id !== sessionId))
        toast.success("Session revoked")
      } else {
        toast.error("Failed to revoke session")
      }
    } catch (error) {
      toast.error("Failed to revoke session")
    }
  }

  const handleRevokeAllSessions = async () => {
    try {
      const res = await fetch(`${API.ME}/sessions`, {
        method: "DELETE",
        credentials: "include",
      })

      if (res.ok) {
        setSessions(sessions.filter((s) => s.current))
        toast.success("All other sessions revoked")
      } else {
        toast.error("Failed to revoke sessions")
      }
    } catch (error) {
      toast.error("Failed to revoke sessions")
    }
  }

  const getDeviceIcon = (device: string) => {
    if (device.toLowerCase().includes("mobile") || device.toLowerCase().includes("phone")) {
      return <Smartphone className="h-4 w-4" />
    }
    return <Monitor className="h-4 w-4" />
  }

  return (
    <div className="space-y-6">
      {/* Password */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Key className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Password</h3>
            <p className="text-xs text-muted-foreground">Update your password to keep your account secure</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-xs">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                placeholder="••••••••"
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-xs">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                placeholder="••••••••"
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-xs">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                placeholder="••••••••"
                className="bg-background"
              />
            </div>
          </div>

          {passwordErrors.length > 0 && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              {passwordErrors.map((error, i) => (
                <p key={i} className="text-xs text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3" />
                  {error}
                </p>
              ))}
            </div>
          )}

          <Button onClick={handleChangePassword} disabled={isChangingPassword} size="sm">
            {isChangingPassword ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5 mr-1.5" />
            )}
            Update Password
          </Button>
        </div>
      </Card>

      {/* Two-Factor Authentication */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">Two-Factor Authentication</h3>
              <p className="text-xs text-muted-foreground">Add an extra layer of security to your account</p>
            </div>
          </div>
          {!qrCode && (
            <Switch
              checked={twoFactorEnabled}
              onCheckedChange={twoFactorEnabled ? handleDisable2FA : handleEnable2FA}
              disabled={isEnabling2FA}
            />
          )}
        </div>

        {qrCode && (
          <div className="space-y-4 p-4 rounded-lg bg-muted/50 border border-border/50">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-3">
                Scan this QR code with your authenticator app
              </p>
              <div className="inline-block p-4 bg-white rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrCode} alt="2FA QR Code" className="w-32 h-32" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="verification-code" className="text-xs">Verification Code</Label>
              <div className="flex gap-2">
                <Input
                  id="verification-code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="bg-background font-mono text-center tracking-widest"
                />
                <Button onClick={handleVerify2FA} disabled={verificationCode.length !== 6}>
                  Verify
                </Button>
                <Button variant="outline" onClick={() => { setQrCode(null); setVerificationCode("") }}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {twoFactorEnabled && !qrCode && (
          <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10">
            <Check className="h-3 w-3 mr-1" />
            Enabled
          </Badge>
        )}
      </Card>

      {/* Active Sessions */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Globe className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">Active Sessions</h3>
              <p className="text-xs text-muted-foreground">Manage your active sessions across devices</p>
            </div>
          </div>
          {sessions.length > 1 && (
            <Button variant="outline" size="sm" onClick={handleRevokeAllSessions}>
              <LogOut className="h-3.5 w-3.5 mr-1.5" />
              Revoke All
            </Button>
          )}
        </div>

        {isLoadingSessions ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No active sessions</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-background">
                    {getDeviceIcon(session.device)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                      {session.browser} on {session.device}
                      {session.current && (
                        <Badge variant="outline" className="text-primary border-primary/30 bg-primary/10 text-[10px]">
                          Current
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.location} · {session.ip} · {getRelativeTime(session.lastActive)}
                    </p>
                  </div>
                </div>
                {!session.current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevokeSession(session.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
