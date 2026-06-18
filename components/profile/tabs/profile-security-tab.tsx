"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Lock,
  Shield,
  Smartphone,
  Mail,
  Copy,
  Download,
  KeyRound,
  MonitorSmartphone,
  Bell,
  Save,
  Check,
  Loader2,
  LogOut,
  AlertTriangle,
} from "lucide-react"
import { API } from "@/lib/config/constants"
import type { ProfileTabProps } from "@/components/profile/types"

export function ProfileSecurityTab(props: ProfileTabProps) {
  const { user, setError, setSuccess } = props

  // Password change state
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmNewPassword, setConfirmNewPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)

  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState(user?.totpEnabled || false)
  const [twoFactorMethod, setTwoFactorMethod] = useState<string | null>(user?.twoFactorMethod || null)
  const [setting2FA, setSetting2FA] = useState(false)
  const [totpUri, setTotpUri] = useState("")
  const [totpSecret, setTotpSecret] = useState("")
  const [totpVerifyCode, setTotpVerifyCode] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [backupCodesRemaining, setBackupCodesRemaining] = useState(0)
  const [showRegenerateBackup, setShowRegenerateBackup] = useState(false)
  const [regenPassword, setRegenPassword] = useState("")
  const [showDisable2FA, setShowDisable2FA] = useState(false)
  const [disablePassword, setDisablePassword] = useState("")
  const [email2FAPassword, setEmail2FAPassword] = useState("")
  const [togglingEmail2FA, setTogglingEmail2FA] = useState(false)

  // Session state
  const [forceLoggingOut, setForceLoggingOut] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)

  // Fetch backup codes remaining count on mount when 2FA is enabled
  useEffect(() => {
    if (totpEnabled && twoFactorMethod === "app") {
      fetch(API.AUTH.TWO_FA.BACKUP_CODES)
        .then((res) => res.json())
        .then((data) => {
          if (typeof data.remaining === "number") {
            setBackupCodesRemaining(data.remaining)
          }
        })
        .catch(() => {
          // Silently fail - backup codes count is not critical
        })
    }
  }, [totpEnabled, twoFactorMethod])

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setError("All fields are required.")
      return
    }
    if (newPassword !== confirmNewPassword) {
      setError("New passwords do not match.")
      return
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.")
      return
    }

    setSavingPassword(true)
    try {
      const res = await fetch(API.AUTH.UPDATE, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess("Password updated successfully!")
        setShowPasswordForm(false)
        setCurrentPassword("")
        setNewPassword("")
        setConfirmNewPassword("")
      } else {
        setError(data.error || "Failed to change password.")
      }
    } catch {
      setError("Failed to change password.")
    } finally {
      setSavingPassword(false)
    }
  }

  async function handleForceLogout() {
    setForceLoggingOut(true)
    try {
      const res = await fetch(API.AUTH.SESSIONS, { method: "DELETE" })
      if (res.ok) {
        setSuccess("All sessions have been terminated.")
        setShowLogoutModal(false)
        setTimeout(() => window.location.href = "/login", 2000)
      } else {
        setError("Failed to log out all devices.")
      }
    } catch {
      setError("Failed to log out all devices.")
    } finally {
      setForceLoggingOut(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Password */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Lock className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Password</h2>
              <p className="text-sm text-muted-foreground">Update your account password</p>
            </div>
          </div>
          {!showPasswordForm && (
            <Button variant="outline" size="sm" onClick={() => setShowPasswordForm(true)}>
              Change Password
            </Button>
          )}
        </div>
        {showPasswordForm && (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="sec-current-pw" className="text-sm">Current Password</Label>
                <Input
                  id="sec-current-pw"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="bg-card h-10"
                  placeholder="Enter current password"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sec-new-pw" className="text-sm">New Password</Label>
                <Input
                  id="sec-new-pw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-card h-10"
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sec-confirm-new-pw" className="text-sm">Confirm New Password</Label>
                <Input
                  id="sec-confirm-new-pw"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="bg-card h-10"
                  placeholder="Re-enter new password"
                  onKeyDown={(e) => { if (e.key === "Enter") handleChangePassword() }}
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button onClick={handleChangePassword} disabled={savingPassword}>
                  <Save className="mr-2 h-4 w-4" />
                  {savingPassword ? "Saving..." : "Update Password"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowPasswordForm(false)
                    setCurrentPassword("")
                    setNewPassword("")
                    setConfirmNewPassword("")
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Two-Factor Authentication */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Two-Factor Authentication</h2>
              <p className="text-sm text-muted-foreground">
                {totpEnabled
                  ? `Active via ${twoFactorMethod === "email" ? "email" : "authenticator app"}`
                  : "Add an extra layer of security"}
              </p>
            </div>
          </div>
          {totpEnabled ? (
            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
              {twoFactorMethod === "email" ? "Email" : "App"} Enabled
            </Badge>
          ) : (
            <Badge variant="secondary">Disabled</Badge>
          )}
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-4">

            {/* ── Authenticator App ── */}
            <div className="rounded-lg border border-border p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 border border-primary/20">
                    <Smartphone className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Authenticator App</p>
                    <p className="text-xs text-muted-foreground">Use Google Authenticator, Authy, or similar apps.</p>
                  </div>
                </div>
                {twoFactorMethod === "app" && totpEnabled && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 shrink-0">Active</Badge>
                )}
              </div>

              {/* App 2FA enabled — show manage options */}
              {totpEnabled && twoFactorMethod === "app" && (
                <>
                  {backupCodes.length > 0 && (
                    <div className="flex flex-col gap-3 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <div className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-amber-500" />
                        <p className="text-sm font-semibold">Save Your Backup Codes</p>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        These codes can be used to sign in if you lose access to your authenticator app. Each code can only be used once.
                      </p>
                      <div className="grid grid-cols-2 gap-2 p-3 bg-card border border-border rounded-lg font-mono text-sm">
                        {backupCodes.map((code, i) => (
                          <span key={i} className="text-foreground select-all text-center py-0.5">{code}</span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(backupCodes.join("\n")); setSuccess("Backup codes copied.") }}>
                          <Copy className="mr-1.5 h-3.5 w-3.5" />Copy All
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => {
                          const blob = new Blob([`VulnRadar 2FA Backup Codes\n${"=".repeat(30)}\n\n${backupCodes.join("\n")}\n\nEach code can only be used once.`], { type: "text/plain" })
                          const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "vulnradar-backup-codes.txt"; a.click(); URL.revokeObjectURL(url)
                        }}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />Download
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setBackupCodes([])} className="ml-auto text-muted-foreground">{`I've saved them`}</Button>
                      </div>
                    </div>
                  )}

                  {backupCodes.length === 0 && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
                      <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Backup Codes</p>
                        <p className="text-xs text-muted-foreground">
                          {backupCodesRemaining} of 8 codes remaining.
                          {backupCodesRemaining <= 2 && backupCodesRemaining > 0 && " Consider regenerating soon."}
                          {backupCodesRemaining === 0 && " Regenerate to get new codes."}
                        </p>
                      </div>
                      {!showRegenerateBackup && (
                        <Button variant="outline" size="sm" onClick={() => setShowRegenerateBackup(true)}>Regenerate</Button>
                      )}
                    </div>
                  )}

                  {showRegenerateBackup && backupCodes.length === 0 && (
                    <div className="flex flex-col gap-3 p-4 rounded-lg bg-secondary/30 border border-border">
                      <p className="text-sm font-medium">Enter your password to regenerate backup codes</p>
                      <p className="text-xs text-muted-foreground">This will invalidate all existing backup codes.</p>
                      <Input type="password" placeholder="Current password" value={regenPassword} onChange={(e) => setRegenPassword(e.target.value)} className="bg-card h-10" />
                      <div className="flex gap-2">
                        <Button disabled={!regenPassword} onClick={async () => {
                          try {
                            const res = await fetch(API.AUTH.TWO_FA.BACKUP_CODES, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: regenPassword }) })
                            const data = await res.json()
                            if (res.ok) { setBackupCodes(data.backupCodes); setBackupCodesRemaining(data.backupCodes.length); setShowRegenerateBackup(false); setRegenPassword(""); setSuccess("New backup codes generated.") }
                            else setError(data.error || "Failed to regenerate codes.")
                          } catch { setError("Failed to regenerate codes.") }
                        }}>Regenerate Codes</Button>
                        <Button variant="ghost" onClick={() => { setShowRegenerateBackup(false); setRegenPassword("") }}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {!showDisable2FA ? (
                    <Button variant="outline" className="self-start text-destructive dark:text-red-400 border-destructive/30 hover:bg-destructive/10" onClick={() => setShowDisable2FA(true)}>
                      Disable Authenticator App
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                      <p className="text-sm font-medium">Enter your password to disable authenticator app 2FA</p>
                      <Input type="password" placeholder="Current password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} className="bg-card h-10" />
                      <div className="flex gap-2">
                        <Button variant="destructive" disabled={!disablePassword} onClick={async () => {
                          try {
                            const res = await fetch(API.AUTH.TWO_FA.DISABLE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: disablePassword }) })
                            const data = await res.json()
                            if (res.ok) { setTotpEnabled(false); setTwoFactorMethod(null); setShowDisable2FA(false); setDisablePassword(""); setSuccess("Authenticator app 2FA has been disabled.") }
                            else setError(data.error || "Failed to disable 2FA.")
                          } catch { setError("Failed to disable 2FA.") }
                        }}>Confirm Disable</Button>
                        <Button variant="ghost" onClick={() => { setShowDisable2FA(false); setDisablePassword("") }}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Setup app 2FA (when not enabled or email is active) */}
              {(!totpEnabled || twoFactorMethod === "email") && (
                <>
                  {!setting2FA ? (
                    <Button
                      className="self-start"
                      disabled={twoFactorMethod === "email" && totpEnabled}
                      onClick={async () => {
                        try {
                          const res = await fetch(API.AUTH.TWO_FA.SETUP)
                          const data = await res.json()
                          if (res.ok) { setTotpUri(data.uri); setTotpSecret(data.secret); setSetting2FA(true) }
                          else setError(data.error || "Failed to start 2FA setup.")
                        } catch { setError("Failed to start 2FA setup.") }
                      }}
                    >
                      {twoFactorMethod === "email" && totpEnabled ? "Disable email 2FA first" : "Enable Authenticator App"}
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 p-4 rounded-lg bg-secondary/30 border border-border">
                        <p className="text-sm font-medium">1. Scan this QR code with your authenticator app:</p>
                        <div className="flex justify-center p-4 bg-background rounded-lg border border-border">
                          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`} alt="2FA QR Code" className="w-[200px] h-[200px]" crossOrigin="anonymous" />
                        </div>
                        <p className="text-sm text-muted-foreground">Or enter this secret manually:</p>
                        <code className="text-xs bg-card border border-border px-3 py-2 rounded font-mono text-primary break-all select-all">{totpSecret}</code>
                      </div>
                      <div className="flex flex-col gap-3 p-4 rounded-lg bg-secondary/30 border border-border">
                        <p className="text-sm font-medium">2. Enter the 6-digit code to verify:</p>
                        <div className="flex gap-2">
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            placeholder="000000"
                            value={totpVerifyCode}
                            onChange={(e) => setTotpVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            className="bg-card h-10 text-center text-lg tracking-[0.3em] font-mono max-w-[180px]"
                          />
                          <Button disabled={totpVerifyCode.length !== 6} onClick={async () => {
                            try {
                              const res = await fetch(API.AUTH.TWO_FA.SETUP, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: totpVerifyCode }) })
                              const data = await res.json()
                              if (res.ok) { setTotpEnabled(true); setTwoFactorMethod("app"); setSetting2FA(false); setTotpUri(""); setTotpSecret(""); setTotpVerifyCode(""); setBackupCodes(data.backupCodes || []); setBackupCodesRemaining(data.backupCodes?.length || 0); setSuccess("Authenticator app 2FA is now enabled! Save your backup codes.") }
                              else setError(data.error || "Verification failed.")
                            } catch { setError("Failed to verify code.") }
                          }}>Verify & Enable</Button>
                        </div>
                      </div>
                      <Button variant="ghost" className="self-start text-muted-foreground" onClick={() => { setSetting2FA(false); setTotpUri(""); setTotpSecret(""); setTotpVerifyCode("") }}>Cancel Setup</Button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Email 2FA ── */}
            <div className="rounded-lg border border-border p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 border border-primary/20">
                    <Mail className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Email Verification</p>
                    <p className="text-xs text-muted-foreground">Receive a 6-digit code via email each time you sign in.</p>
                  </div>
                </div>
                {twoFactorMethod === "email" && totpEnabled && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 shrink-0">Active</Badge>
                )}
              </div>

              {/* Email 2FA enabled */}
              {totpEnabled && twoFactorMethod === "email" && (
                <>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <Check className="h-4 w-4 text-emerald-500" />
                    <p className="text-sm">A verification code will be sent to your email on each login.</p>
                  </div>
                  {!showDisable2FA ? (
                    <Button variant="outline" className="self-start text-destructive dark:text-red-400 border-destructive/30 hover:bg-destructive/10" onClick={() => setShowDisable2FA(true)}>
                      Disable Email 2FA
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                      <p className="text-sm font-medium">Enter your password to disable email 2FA</p>
                      <Input type="password" placeholder="Current password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} className="bg-card h-10" />
                      <div className="flex gap-2">
                        <Button variant="destructive" disabled={!disablePassword} onClick={async () => {
                          try {
                            const res = await fetch(API.AUTH.TWO_FA.EMAIL_SETUP, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: disablePassword }) })
                            const data = await res.json()
                            if (res.ok) { setTotpEnabled(false); setTwoFactorMethod(null); setShowDisable2FA(false); setDisablePassword(""); setSuccess("Email 2FA has been disabled.") }
                            else setError(data.error || "Failed to disable email 2FA.")
                          } catch { setError("Failed to disable email 2FA.") }
                        }}>Confirm Disable</Button>
                        <Button variant="ghost" onClick={() => { setShowDisable2FA(false); setDisablePassword("") }}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Enable email 2FA (when disabled or app is active) */}
              {(!totpEnabled || twoFactorMethod === "app") && (
                <div className="flex flex-col gap-3">
                  {!email2FAPassword ? (
                    <Button
                      className="self-start"
                      variant="outline"
                      disabled={twoFactorMethod === "app" && totpEnabled}
                      onClick={() => {
                        if (twoFactorMethod === "app" && totpEnabled) return
                        setEmail2FAPassword(" ")
                      }}
                    >
                      {twoFactorMethod === "app" && totpEnabled ? "Disable app 2FA first" : "Enable Email 2FA"}
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-3 p-4 rounded-lg bg-secondary/30 border border-border">
                      <p className="text-sm font-medium">Enter your password to enable email 2FA</p>
                      <p className="text-xs text-muted-foreground">A 6-digit code will be sent to your email every time you log in.</p>
                      <Input
                        type="password"
                        placeholder="Current password"
                        value={email2FAPassword.trim() === "" ? "" : email2FAPassword}
                        onChange={(e) => setEmail2FAPassword(e.target.value)}
                        className="bg-card h-10"
                      />
                      <div className="flex gap-2">
                        <Button
                          disabled={!email2FAPassword.trim() || togglingEmail2FA}
                          onClick={async () => {
                            setTogglingEmail2FA(true)
                            try {
                              const res = await fetch(API.AUTH.TWO_FA.EMAIL_SETUP, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: email2FAPassword.trim() }) })
                              const data = await res.json()
                              if (res.ok) { setTotpEnabled(true); setTwoFactorMethod("email"); setEmail2FAPassword(""); setSuccess("Email 2FA is now enabled.") }
                              else setError(data.error || "Failed to enable email 2FA.")
                            } catch { setError("Failed to enable email 2FA.") } finally { setTogglingEmail2FA(false) }
                          }}
                        >
                          {togglingEmail2FA ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enabling...</> : "Enable Email 2FA"}
                        </Button>
                        <Button variant="ghost" onClick={() => setEmail2FAPassword("")}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </CardContent>
        </Card>
      </section>

      {/* Active Sessions / Force Logout */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <MonitorSmartphone className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Active Sessions</h2>
            <p className="text-sm text-muted-foreground">Log out of all devices at once</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                If you suspect unauthorized access or want to sign out everywhere, this will invalidate all active sessions including this one.
              </p>
              <Button
                variant="outline"
                className="self-start text-destructive dark:text-red-400 border-destructive/30 hover:bg-destructive/10"
                onClick={() => setShowLogoutModal(true)}
              >
                <LogOut className="mr-2 h-4 w-4" />Log Out All Devices
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Logout All Devices Confirmation Modal */}
      <Dialog open={showLogoutModal} onOpenChange={setShowLogoutModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <DialogTitle>Log Out All Devices</DialogTitle>
            </div>
            <DialogDescription className="text-left">
              This will terminate all active sessions including this one. You will be redirected to the login page and will need to sign in again on all devices.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowLogoutModal(false)}
              disabled={forceLoggingOut}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleForceLogout}
              disabled={forceLoggingOut}
            >
              {forceLoggingOut ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Logging out...</>
              ) : (
                <><LogOut className="mr-2 h-4 w-4" />Log Out All Devices</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Security Notifications Quick Link */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
            <Bell className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Security Notifications</h2>
            <p className="text-sm text-muted-foreground">Configure security-related email notifications</p>
          </div>
        </div>
        <Card className="border-border/60">
          <CardContent className="pt-6">
            <Button
              variant="outline"
              onClick={() => {
                window.location.hash = "notifications"
              }}
            >
              Manage Notification Settings
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
