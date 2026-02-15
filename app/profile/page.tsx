"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { ImageCropDialog } from "@/components/image-crop-dialog"
import {
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Key,
  KeyRound,
  Clock,
  AlertTriangle,
  Download,
  Shield,
  FileDown,
  UserCog,
  Lock,
  Mail,
  Pencil,
  Save,
  X,
  Webhook,
  CalendarClock,
  Globe,
  Loader2,
  Bell,
  Camera,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"

interface ApiKey {
  id: number
  key_prefix: string
  name: string
  daily_limit: number
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  usage_today: number
}

interface User {
  userId: number
  email: string
  name: string | null
  totpEnabled?: boolean
  avatarUrl?: string | null
}

interface DataRequestInfo {
  hasData: boolean
  canDownloadNew: boolean
  cooldownEndsAt?: string
  lastDownloadAt?: string
}

type Tab = "account" | "api-keys" | "webhooks" | "schedules" | "notifications" | "data"

interface WebhookItem {
  id: number
  url: string
  name: string
  type: string
  active: boolean
  created_at: string
}

interface ScheduleItem {
  id: number
  url: string
  frequency: string
  created_at: string
  last_run: string | null
  next_run: string | null
}

interface NotificationPrefs {
  email_api_keys: boolean
  email_webhooks: boolean
  email_schedules: boolean
  email_data_requests: boolean
  email_security: boolean
}

export default function ProfilePage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>("account")
  const [user, setUser] = useState<User | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // API key state
  const [newKeyName, setNewKeyName] = useState("")
  const [generatingKey, setGeneratingKey] = useState(false)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  // Profile editing state
  const [editingName, setEditingName] = useState(false)
  const [editingEmail, setEditingEmail] = useState(false)
  const [nameInput, setNameInput] = useState("")
  const [emailInput, setEmailInput] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)

  // Password change state
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmNewPassword, setConfirmNewPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)

  // Data request state
  const [dataReqInfo, setDataReqInfo] = useState<DataRequestInfo | null>(null)
  const [requestingData, setRequestingData] = useState(false)

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [setting2FA, setSetting2FA] = useState(false)
  const [totpUri, setTotpUri] = useState("")
  const [totpSecret, setTotpSecret] = useState("")
  const [totpVerifyCode, setTotpVerifyCode] = useState("")
  const [disablePassword, setDisablePassword] = useState("")
  const [showDisable2FA, setShowDisable2FA] = useState(false)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number>(0)
  const [showRegenerateBackup, setShowRegenerateBackup] = useState(false)
  const [regenPassword, setRegenPassword] = useState("")

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([])
  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookName, setWebhookName] = useState("")
  const [addingWebhook, setAddingWebhook] = useState(false)

  // Schedules state
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [scheduleUrl, setScheduleUrl] = useState("")
  const [scheduleFreq, setScheduleFreq] = useState("weekly")
  const [addingSchedule, setAddingSchedule] = useState(false)

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    email_api_keys: true,
    email_webhooks: true,
    email_schedules: true,
    email_data_requests: true,
    email_security: true,
  })
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false)

  // Avatar state
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [cropDialogOpen, setCropDialogOpen] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const avatarInputRef = React.useRef<HTMLInputElement>(null)

  function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB.")
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      setCropImageSrc(reader.result as string)
      setCropDialogOpen(true)
    }
    reader.readAsDataURL(file)
    if (avatarInputRef.current) avatarInputRef.current.value = ""
  }

  async function handleCroppedAvatar(croppedDataUrl: string) {
    setUploadingAvatar(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: croppedDataUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
      } else {
        setUser((prev) => (prev ? { ...prev, avatarUrl: data.avatarUrl } : prev))
        setSuccess("Profile picture updated.")
        setCropDialogOpen(false)
        setCropImageSrc(null)
      }
    } catch {
      setError("Failed to upload profile picture.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleRemoveAvatar() {
    setUploadingAvatar(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: "" }),
      })
      if (res.ok) {
        setUser((prev) => (prev ? { ...prev, avatarUrl: null } : prev))
        setSuccess("Profile picture removed.")
      }
    } catch {
      setError("Failed to remove profile picture.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  const fetchData = useCallback(async () => {
    try {
      const [userRes, keysRes, dataReqRes, webhooksRes, schedulesRes, notifRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/keys"),
        fetch("/api/data-request"),
        fetch("/api/webhooks"),
        fetch("/api/schedules"),
        fetch("/api/account/notifications"),
      ])

      if (!userRes.ok) {
        router.push("/login")
        return
      }

      const userData = await userRes.json()
      const keysData = await keysRes.json()
      const dataReqData = await dataReqRes.json()
      const webhooksData = await webhooksRes.json()
      const schedulesData = await schedulesRes.json()
      const notifData = notifRes.ok ? await notifRes.json() : null
      setUser(userData)
      setTotpEnabled(userData.totpEnabled || false)
      if (userData.totpEnabled) {
        fetch("/api/auth/2fa/backup-codes").then(r => r.json()).then(d => setBackupCodesRemaining(d.remaining || 0)).catch(() => {})
      }
      setKeys(keysData.keys || [])
      setDataReqInfo(dataReqData)
      setWebhooks(Array.isArray(webhooksData) ? webhooksData : [])
      setSchedules(Array.isArray(schedulesData) ? schedulesData : [])
      if (notifData) {
        setNotifPrefs({
          email_api_keys: notifData.email_api_keys ?? true,
          email_webhooks: notifData.email_webhooks ?? true,
          email_schedules: notifData.email_schedules ?? true,
          email_data_requests: notifData.email_data_requests ?? true,
          email_security: notifData.email_security ?? true,
        })
      }
    } catch {
      setError("Failed to load profile data.")
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Clear messages after 5 seconds
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 5000)
      return () => clearTimeout(t)
    }
  }, [success])

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 8000)
      return () => clearTimeout(t)
    }
  }, [error])

  // ---- Profile handlers ----
  async function handleSaveName() {
    if (!nameInput.trim()) {
      setError("Name cannot be empty.")
      return
    }
    setSavingProfile(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setUser((prev) => (prev ? { ...prev, name: data.name } : prev))
      setEditingName(false)
      setSuccess("Name updated successfully.")
    } catch {
      setError("Failed to update name.")
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSaveEmail() {
    if (!emailInput.trim() || !emailInput.includes("@")) {
      setError("Please enter a valid email.")
      return
    }
    setSavingProfile(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setUser((prev) => (prev ? { ...prev, email: data.email } : prev))
      setEditingEmail(false)
      setSuccess("Email updated successfully.")
    } catch {
      setError("Failed to update email.")
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleChangePassword() {
    if (!currentPassword) {
      setError("Current password is required.")
      return
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.")
      return
    }
    if (newPassword !== confirmNewPassword) {
      setError("New passwords do not match.")
      return
    }
    setSavingPassword(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setShowPasswordForm(false)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmNewPassword("")
      setSuccess("Password changed successfully.")
    } catch {
      setError("Failed to change password.")
    } finally {
      setSavingPassword(false)
    }
  }

  // ---- API key handlers ----
  async function handleGenerateKey() {
    setGeneratingKey(true)
    setError(null)
    setNewlyCreatedKey(null)
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() || "Default" }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to generate API key.")
        return
      }
      setNewlyCreatedKey(data.key.raw_key)
      setNewKeyName("")
      setShowKey(true)
      await fetchData()
    } catch {
      setError("Failed to generate API key.")
    } finally {
      setGeneratingKey(false)
    }
  }

  async function handleRevokeKey(keyId: number) {
    setRevokingId(keyId)
    try {
      await fetch(`/api/keys/${keyId}/revoke`, { method: "POST" })
      await fetchData()
    } catch {
      setError("Failed to revoke key.")
    } finally {
      setRevokingId(null)
    }
  }

  function handleCopyKey() {
    if (newlyCreatedKey) {
      navigator.clipboard.writeText(newlyCreatedKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    }
  }

  // ---- Data request handlers ----
  async function handleRequestData() {
    setRequestingData(true)
    setError(null)
    try {
      const res = await fetch("/api/data-request", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to export data.")
        return
      }
      // Download the data
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `vulnradar-data-export-${new Date().toISOString().split("T")[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      await fetchData()
      setSuccess("Data export downloaded successfully.")
    } catch {
      setError("Failed to export data.")
    } finally {
      setRequestingData(false)
    }
  }

  async function handleDownloadPreviousData() {
    try {
      const dlRes = await fetch("/api/data-request")
      if (!dlRes.ok) {
        setError("Failed to download data.")
        return
      }
      const dlData = await dlRes.json()
      if (!dlData.data) {
        setError("No previous export data available.")
        return
      }
      const blob = new Blob([typeof dlData.data === "string" ? dlData.data : JSON.stringify(dlData.data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `vulnradar-data-export-${new Date().toISOString().split("T")[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setSuccess("Previous export downloaded successfully.")
    } catch {
      setError("Failed to download previous export.")
    }
  }

  // ---- Delete account ----
  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const res = await fetch("/api/account/delete", { method: "POST" })
      if (res.ok) {
        router.push("/login")
      } else {
        setError("Failed to delete account.")
      }
    } catch {
      setError("Failed to delete account.")
    } finally {
      setDeleting(false)
    }
  }

  // ---- Notification preferences ----
  async function handleSaveNotifPrefs() {
    setSavingNotifPrefs(true)
    setError(null)
    try {
      const res = await fetch("/api/account/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notifPrefs),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to save notification preferences.")
        return
      }
      setNotifPrefs({
        email_api_keys: data.email_api_keys,
        email_webhooks: data.email_webhooks,
        email_schedules: data.email_schedules,
        email_data_requests: data.email_data_requests,
        email_security: data.email_security,
      })
      setSuccess("Notification preferences saved.")
    } catch {
      setError("Failed to save notification preferences.")
    } finally {
      setSavingNotifPrefs(false)
    }
  }

  // ---- Helpers ----
  function formatDate(dateStr: string | null) {
    if (!dateStr) return "Never"
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function getTimeRemaining(endDate: string) {
    const diff = new Date(endDate).getTime() - Date.now()
    if (diff <= 0) return null
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    )
  }

  const activeKeys = keys.filter((k) => !k.revoked_at)
  const revokedKeys = keys.filter((k) => k.revoked_at)

  const TABS = [
    { id: "account" as Tab, label: "Account", icon: <UserCog className="h-4 w-4" /> },
    { id: "api-keys" as Tab, label: "API Keys", icon: <Key className="h-4 w-4" /> },
    { id: "webhooks" as Tab, label: "Webhooks", icon: <Webhook className="h-4 w-4" /> },
    { id: "schedules" as Tab, label: "Schedules", icon: <CalendarClock className="h-4 w-4" /> },
    { id: "notifications" as Tab, label: "Notifications", icon: <Bell className="h-4 w-4" /> },
    { id: "data" as Tab, label: "Data & Privacy", icon: <Shield className="h-4 w-4" /> },
  ]

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 flex flex-col gap-6">

        {/* Toast messages */}
        {(error || success) && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              error
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
            }`}
          >
            {error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
            <span className="flex-1">{error || success}</span>
            <button onClick={() => { setError(null); setSuccess(null) }} className="text-xs underline opacity-70 hover:opacity-100">
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary/50 border border-border overflow-x-auto scrollbar-thin scrollbar-thumb-muted/40 scrollbar-track-transparent min-w-0 -mx-4 px-4 sm:mx-0 sm:px-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={
                cn(
                  "flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 whitespace-nowrap flex-shrink-0",
                  activeTab === tab.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              {tab.icon}
              <span className="hidden sm:inline text-sm">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ===================== ACCOUNT TAB ===================== */}
        {activeTab === "account" && (
          <div className="flex flex-col gap-6">
            {/* Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Personal Information</CardTitle>
                <CardDescription>Manage your profile picture, name, and email address.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {/* Profile Picture */}
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium text-muted-foreground">Profile Picture</Label>
                  <div className="flex items-center gap-4">
                    <div className="relative group">
                      <div className="h-16 w-16 rounded-full border-2 border-border bg-secondary/40 flex items-center justify-center overflow-hidden">
                        {user?.avatarUrl ? (
                          <img src={user.avatarUrl} alt="Profile" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xl font-bold text-muted-foreground">
                            {user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "?"}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={uploadingAvatar}
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        {uploadingAvatar ? (
                          <Loader2 className="h-5 w-5 animate-spin text-foreground" />
                        ) : (
                          <Camera className="h-5 w-5 text-foreground" />
                        )}
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-transparent text-xs"
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={uploadingAvatar}
                        >
                          {uploadingAvatar ? "Uploading..." : "Upload"}
                        </Button>
                        {user?.avatarUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-destructive hover:text-destructive"
                            onClick={handleRemoveAvatar}
                            disabled={uploadingAvatar}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">JPG, PNG, or GIF. Max 5MB.</p>
                    </div>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarFileSelect}
                      className="hidden"
                    />
                  </div>
                </div>

                {/* Name field */}
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium text-muted-foreground">Name</Label>
                  {!editingName ? (
                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/20 gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{user?.name || "---"}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setNameInput(user?.name || "")
                          setEditingName(true)
                        }}
                        className="text-muted-foreground hover:text-foreground h-8 shrink-0"
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className="bg-card h-10"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false) }}
                      />
                      <Button size="icon" className="shrink-0 h-10 w-10" onClick={handleSaveName} disabled={savingProfile}>
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="shrink-0 h-10 w-10" onClick={() => setEditingName(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Email field */}
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium text-muted-foreground">Email</Label>
                  {!editingEmail ? (
                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/20 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate">{user?.email}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEmailInput(user?.email || "")
                          setEditingEmail(true)
                        }}
                        className="text-muted-foreground hover:text-foreground h-8 shrink-0"
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="bg-card h-10"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveEmail(); if (e.key === "Escape") setEditingEmail(false) }}
                      />
                      <Button size="icon" className="shrink-0 h-10 w-10" onClick={handleSaveEmail} disabled={savingProfile}>
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="shrink-0 h-10 w-10" onClick={() => setEditingEmail(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Password */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      Password
                    </CardTitle>
                    <CardDescription>Update your account password.</CardDescription>
                  </div>
                  {!showPasswordForm && (
                    <Button variant="outline" size="sm" onClick={() => setShowPasswordForm(true)}>
                      Change Password
                    </Button>
                  )}
                </div>
              </CardHeader>
              {showPasswordForm && (
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="current-pw" className="text-sm">Current Password</Label>
                    <Input
                      id="current-pw"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="bg-card h-10"
                      placeholder="Enter current password"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="new-pw" className="text-sm">New Password</Label>
                    <Input
                      id="new-pw"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="bg-card h-10"
                      placeholder="At least 8 characters"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="confirm-new-pw" className="text-sm">Confirm New Password</Label>
                    <Input
                      id="confirm-new-pw"
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
              )}
            </Card>

            {/* Two-Factor Authentication */}
            <Card className="bg-card border-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      Two-Factor Authentication
                    </CardTitle>
                    <CardDescription>
                      {totpEnabled
                        ? "2FA is currently enabled on your account."
                        : "Add an extra layer of security to your account."}
                    </CardDescription>
                  </div>
                  {totpEnabled ? (
                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Enabled</Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {totpEnabled ? (
                  <>
                    {/* Backup codes display (shown after enabling or regenerating) */}
                    {backupCodes.length > 0 && (
                      <div className="flex flex-col gap-3 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                        <div className="flex items-center gap-2">
                          <KeyRound className="h-4 w-4 text-amber-500" />
                          <p className="text-sm font-semibold text-foreground">Save Your Backup Codes</p>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          These codes can be used to sign in if you lose access to your authenticator app. Each code can only be used once. Store them securely, as you will not be able to see them again.
                        </p>
                        <div className="grid grid-cols-2 gap-2 p-3 bg-card border border-border rounded-lg font-mono text-sm">
                          {backupCodes.map((code, i) => (
                            <span key={i} className="text-foreground select-all text-center py-0.5">{code}</span>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="bg-transparent"
                            onClick={() => {
                              navigator.clipboard.writeText(backupCodes.join("\n"))
                              setSuccess("Backup codes copied to clipboard.")
                            }}
                          >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            Copy All
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="bg-transparent"
                            onClick={() => {
                              const blob = new Blob([`VulnRadar 2FA Backup Codes\n${"=".repeat(30)}\n\n${backupCodes.join("\n")}\n\nEach code can only be used once.\nStore these codes securely.`], { type: "text/plain" })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement("a")
                              a.href = url
                              a.download = "vulnradar-backup-codes.txt"
                              a.click()
                              URL.revokeObjectURL(url)
                            }}
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            Download
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setBackupCodes([])}
                            className="ml-auto text-muted-foreground"
                          >
                            I've saved them
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Backup code status */}
                    {backupCodes.length === 0 && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
                        <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm text-foreground font-medium">Backup Codes</p>
                          <p className="text-xs text-muted-foreground">
                            {backupCodesRemaining} of 8 codes remaining.
                            {backupCodesRemaining <= 2 && backupCodesRemaining > 0 && " Consider regenerating soon."}
                            {backupCodesRemaining === 0 && " Regenerate to get new codes."}
                          </p>
                        </div>
                        {!showRegenerateBackup && (
                          <Button variant="outline" size="sm" className="bg-transparent shrink-0" onClick={() => setShowRegenerateBackup(true)}>
                            Regenerate
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Regenerate backup codes form */}
                    {showRegenerateBackup && backupCodes.length === 0 && (
                      <div className="flex flex-col gap-3 p-4 rounded-lg bg-muted/50 border border-border">
                        <p className="text-sm text-foreground font-medium">Enter your password to regenerate backup codes</p>
                        <p className="text-xs text-muted-foreground">This will invalidate all existing backup codes.</p>
                        <Input
                          type="password"
                          placeholder="Current password"
                          value={regenPassword}
                          onChange={(e) => setRegenPassword(e.target.value)}
                          className="bg-card h-10"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            disabled={!regenPassword}
                            onClick={async () => {
                              try {
                                const res = await fetch("/api/auth/2fa/backup-codes", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ password: regenPassword }),
                                })
                                const data = await res.json()
                                if (res.ok) {
                                  setBackupCodes(data.backupCodes)
                                  setBackupCodesRemaining(data.backupCodes.length)
                                  setShowRegenerateBackup(false)
                                  setRegenPassword("")
                                  setSuccess("New backup codes generated. Save them now.")
                                } else {
                                  setError(data.error || "Failed to regenerate codes.")
                                }
                              } catch {
                                setError("Failed to regenerate codes.")
                              }
                            }}
                          >
                            Regenerate Codes
                          </Button>
                          <Button variant="ghost" onClick={() => { setShowRegenerateBackup(false); setRegenPassword("") }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {!showDisable2FA ? (
                      <Button
                        variant="outline"
                        className="self-start text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => setShowDisable2FA(true)}
                      >
                        Disable 2FA
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                        <p className="text-sm text-foreground font-medium">Enter your password to disable 2FA</p>
                        <Input
                          type="password"
                          placeholder="Current password"
                          value={disablePassword}
                          onChange={(e) => setDisablePassword(e.target.value)}
                          className="bg-card h-10"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            variant="destructive"
                            disabled={!disablePassword}
                            onClick={async () => {
                              try {
                                const res = await fetch("/api/auth/2fa/disable", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ password: disablePassword }),
                                })
                                const data = await res.json()
                                if (res.ok) {
                                  setTotpEnabled(false)
                                  setShowDisable2FA(false)
                                  setDisablePassword("")
                                  setSuccess("Two-factor authentication has been disabled.")
                                } else {
                                  setError(data.error || "Failed to disable 2FA.")
                                }
                              } catch {
                                setError("Failed to disable 2FA.")
                              }
                            }}
                          >
                            Confirm Disable
                          </Button>
                          <Button variant="ghost" onClick={() => { setShowDisable2FA(false); setDisablePassword("") }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {!setting2FA ? (
                      <div className="flex flex-col gap-3">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          When enabled, you will be required to enter a 6-digit code from your authenticator app (Google Authenticator, Authy, etc.) each time you sign in.
                        </p>
                        <Button
                          className="self-start"
                          onClick={async () => {
                            try {
                              const res = await fetch("/api/auth/2fa/setup")
                              const data = await res.json()
                              if (res.ok) {
                                setTotpUri(data.uri)
                                setTotpSecret(data.secret)
                                setSetting2FA(true)
                              } else {
                                setError(data.error || "Failed to start 2FA setup.")
                              }
                            } catch {
                              setError("Failed to start 2FA setup.")
                            }
                          }}
                        >
                          Enable 2FA
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-3 p-4 rounded-lg bg-muted/50 border border-border">
                          <p className="text-sm font-medium text-foreground">
                            1. Scan this QR code with your authenticator app:
                          </p>
                          <div className="flex justify-center p-4 bg-background rounded-lg border border-border">
                            {/* QR code using Google Charts API */}
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`}
                              alt="2FA QR Code"
                              className="w-[200px] h-[200px]"
                              crossOrigin="anonymous"
                            />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Or enter this secret manually:
                          </p>
                          <code className="text-xs bg-card border border-border px-3 py-2 rounded font-mono text-primary break-all select-all">
                            {totpSecret}
                          </code>
                        </div>

                        <div className="flex flex-col gap-3 p-4 rounded-lg bg-muted/50 border border-border">
                          <p className="text-sm font-medium text-foreground">
                            2. Enter the 6-digit code to verify:
                          </p>
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
                            <Button
                              disabled={totpVerifyCode.length !== 6}
                              onClick={async () => {
                                try {
                                  const res = await fetch("/api/auth/2fa/setup", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ code: totpVerifyCode }),
                                  })
                                  const data = await res.json()
                                  if (res.ok) {
                                    setTotpEnabled(true)
                                    setSetting2FA(false)
                                    setTotpUri("")
                                    setTotpSecret("")
                                    setTotpVerifyCode("")
                                    setBackupCodes(data.backupCodes || [])
                                    setBackupCodesRemaining(data.backupCodes?.length || 0)
                                    setSuccess("Two-factor authentication is now enabled! Save your backup codes below.")
                                  } else {
                                    setError(data.error || "Verification failed.")
                                  }
                                } catch {
                                  setError("Failed to verify code.")
                                }
                              }}
                            >
                              Verify & Enable
                            </Button>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          className="self-start text-muted-foreground"
                          onClick={() => {
                            setSetting2FA(false)
                            setTotpUri("")
                            setTotpSecret("")
                            setTotpVerifyCode("")
                          }}
                        >
                          Cancel Setup
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===================== API KEYS TAB ===================== */}
        {activeTab === "api-keys" && (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">API Keys</CardTitle>
                    <CardDescription className="mt-1">
                      Each key is rate-limited to 50 requests per 24 hours. Maximum 3 active keys.
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => router.push("/docs")} className="shrink-0">
                    View Docs
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {/* Newly created key banner */}
                {newlyCreatedKey && (
                  <div className="p-4 rounded-lg border border-primary/30 bg-primary/5">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">New API Key Generated</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Copy this key now. You will not be able to see it again.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-secondary px-3 py-2 rounded-md font-mono text-foreground overflow-x-auto">
                          {showKey ? newlyCreatedKey : newlyCreatedKey.slice(0, 12) + "..." + "*".repeat(32)}
                        </code>
                        <Button variant="ghost" size="icon" onClick={() => setShowKey(!showKey)} className="shrink-0">
                          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handleCopyKey} className="shrink-0">
                          {copiedKey ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Generate new key */}
                <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/30">
                  <Label htmlFor="key-name" className="text-sm font-medium">Generate New Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="key-name"
                      placeholder="Key name (e.g. Production, CI/CD)"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="bg-card h-10"
                      maxLength={100}
                      onKeyDown={(e) => { if (e.key === "Enter" && activeKeys.length < 3) handleGenerateKey() }}
                    />
                    <Button onClick={handleGenerateKey} disabled={generatingKey || activeKeys.length >= 3} className="shrink-0 h-10">
                      <Plus className="mr-2 h-4 w-4" />
                      {generatingKey ? "Generating..." : "Generate"}
                    </Button>
                  </div>
                  {activeKeys.length >= 3 && (
                    <p className="text-xs text-muted-foreground">Maximum 3 active keys. Revoke an existing key to create a new one.</p>
                  )}
                </div>

                {/* Active keys */}
                {activeKeys.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Active Keys ({activeKeys.length}/3)</h3>
                    {activeKeys.map((key) => (
                      <div key={key.id} className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium text-sm text-foreground truncate">{key.name}</span>
                            <Badge variant="secondary" className="text-xs font-mono shrink-0">{key.key_prefix}...</Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRevokeKey(key.id)}
                            disabled={revokingId === key.id}
                            className="text-muted-foreground hover:text-destructive h-8 w-8"
                            aria-label="Revoke key"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Usage today</span>
                            <span>{key.usage_today} / {key.daily_limit} requests</span>
                          </div>
                          <Progress value={(key.usage_today / key.daily_limit) * 100} className="h-2" />
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 shrink-0" />
                            Created {formatDate(key.created_at)}
                          </span>
                          {key.last_used_at && <span>Last used {formatDate(key.last_used_at)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Empty state */}
                {activeKeys.length === 0 && !newlyCreatedKey && (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <Key className="h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm font-medium text-foreground">No API keys yet</p>
                    <p className="text-xs text-muted-foreground">Generate a key above to start using the VulnRadar API.</p>
                  </div>
                )}

                {/* Revoked keys */}
                {revokedKeys.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">Revoked Keys ({revokedKeys.length})</h3>
                    {revokedKeys.map((key) => (
                      <div key={key.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg border border-border bg-secondary/20 opacity-60">
                        <div className="flex items-center gap-2 min-w-0">
                          <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm text-muted-foreground line-through truncate">{key.name}</span>
                          <Badge variant="outline" className="text-xs font-mono text-muted-foreground shrink-0">{key.key_prefix}...</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">Revoked {formatDate(key.revoked_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===================== WEBHOOKS TAB ===================== */}
        {activeTab === "webhooks" && (
          <div className="flex flex-col gap-6">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Webhook className="h-4 w-4 text-primary" />
                  Webhook Endpoints
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Get notified when scans complete. Supports Discord, Slack, and generic JSON webhooks. Max 5.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 flex flex-col gap-4">
                {/* Add webhook form */}
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      placeholder="Webhook name"
                      value={webhookName}
                      onChange={(e) => setWebhookName(e.target.value)}
                      className="sm:w-36"
                    />
                    <Input
                      placeholder="https://discord.com/api/webhooks/... or any URL"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      disabled={!webhookUrl || addingWebhook}
                      onClick={async () => {
                        setAddingWebhook(true)
                        try {
                          const res = await fetch("/api/webhooks", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url: webhookUrl, name: webhookName || "Default", type: "auto" }),
                          })
                          const data = await res.json()
                          if (res.ok) {
                            setWebhooks((prev) => [data, ...prev])
                            setWebhookUrl("")
                            setWebhookName("")
                            setSuccess(`Webhook added (detected as ${data.type}).`)
                          } else {
                            setError(data.error || "Failed to add webhook.")
                          }
                        } catch { setError("Failed to add webhook.") }
                        setAddingWebhook(false)
                      }}
                      className="shrink-0"
                    >
                      {addingWebhook ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      <span className="ml-1.5">Add</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Paste a Discord or Slack webhook URL and the type is auto-detected. Discord gets rich embeds with color-coded severity, Slack gets Block Kit messages, and other URLs get standard JSON.
                  </p>
                </div>

                {/* Webhook list */}
                {webhooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No webhooks configured yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {webhooks.map((wh) => (
                      <div key={wh.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border">
                        {wh.type === "discord" ? (
                          <svg className="h-4 w-4 text-[#5865F2] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                        ) : wh.type === "slack" ? (
                          <svg className="h-4 w-4 text-[#E01E5A] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z"/></svg>
                        ) : (
                          <Globe className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{wh.name}</p>
                            <span className={cn(
                              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border",
                              wh.type === "discord" ? "bg-[#5865F2]/10 text-[#5865F2] border-[#5865F2]/20" :
                              wh.type === "slack" ? "bg-[#E01E5A]/10 text-[#E01E5A] border-[#E01E5A]/20" :
                              "bg-muted text-muted-foreground border-border"
                            )}>
                              {wh.type}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{wh.url}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={async () => {
                            await fetch("/api/webhooks", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: wh.id }),
                            })
                            setWebhooks((prev) => prev.filter((w) => w.id !== wh.id))
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg bg-muted/50 border border-border p-3 flex flex-col gap-2">
                  <p className="text-xs font-medium text-foreground">Payload Formats:</p>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground"><span className="text-[#5865F2] font-semibold">Discord:</span> Rich embeds with color-coded severity (red for critical, orange for high, yellow for medium, green for clean).</p>
                    <p className="text-xs text-muted-foreground"><span className="text-[#E01E5A] font-semibold">Slack:</span> Block Kit messages with structured fields for each severity level.</p>
                    <p className="text-xs text-muted-foreground"><span className="text-primary font-semibold">Generic:</span> Standard JSON with <code className="text-primary">event</code> and <code className="text-primary">data</code> fields.</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Webhooks fire for all scans, both UI and API-triggered.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===================== SCHEDULES TAB ===================== */}
        {activeTab === "schedules" && (
          <div className="flex flex-col gap-6">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-primary" />
                  Scheduled Scans
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Set URLs to auto-scan on a recurring schedule. Max 10 schedules.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 flex flex-col gap-4">
                {/* Add schedule form */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="https://example.com"
                    value={scheduleUrl}
                    onChange={(e) => setScheduleUrl(e.target.value)}
                    className="flex-1"
                  />
                  <select
                    value={scheduleFreq}
                    onChange={(e) => setScheduleFreq(e.target.value)}
                    className="h-10 px-3 rounded-md border border-border bg-background text-foreground text-sm"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <Button
                    disabled={!scheduleUrl || addingSchedule}
                    onClick={async () => {
                      setAddingSchedule(true)
                      try {
                        const res = await fetch("/api/schedules", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ url: scheduleUrl, frequency: scheduleFreq }),
                        })
                        const data = await res.json()
                        if (res.ok) {
                          setSchedules((prev) => [data, ...prev])
                          setScheduleUrl("")
                          setSuccess("Schedule created successfully.")
                        } else {
                          setError(data.error || "Failed to create schedule.")
                        }
                      } catch { setError("Failed to create schedule.") }
                      setAddingSchedule(false)
                    }}
                    className="shrink-0"
                  >
                    {addingSchedule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    <span className="ml-1.5">Add</span>
                  </Button>
                </div>

                {/* Schedule list */}
                {schedules.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No scheduled scans configured yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {schedules.map((sch) => (
                      <div key={sch.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border">
                        <CalendarClock className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{sch.url}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 uppercase font-semibold">
                              {sch.frequency}
                            </Badge>
                            {sch.next_run && (
                              <span>Next: {new Date(sch.next_run).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            )}
                            {sch.last_run && (
                              <span>Last: {new Date(sch.last_run).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={async () => {
                            await fetch("/api/schedules", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: sch.id }),
                            })
                            setSchedules((prev) => prev.filter((s) => s.id !== sch.id))
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg bg-muted/50 border border-border p-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Scheduled scans run automatically at the configured frequency. Results are saved to your scan history and any active webhooks will be notified. Schedules require an active API key.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===================== NOTIFICATIONS TAB ===================== */}
        {activeTab === "notifications" && (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  Email Notifications
                </CardTitle>
                <CardDescription>
                  Choose which email notifications you&apos;d like to receive. These settings apply to automated emails only.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {/* Security notifications - always recommended */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium text-foreground">Security Alerts</p>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 uppercase font-semibold">Recommended</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Get notified about password changes, new logins, 2FA changes, and other security events.
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.email_security}
                    onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, email_security: checked }))}
                  />
                </div>

                {/* API Keys notifications */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground">API Key Activity</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Notifications when API keys are created, revoked, or near their usage limits.
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.email_api_keys}
                    onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, email_api_keys: checked }))}
                  />
                </div>

                {/* Webhooks notifications */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Webhook className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground">Webhook Events</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Get notified when webhooks fail to deliver or are automatically disabled.
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.email_webhooks}
                    onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, email_webhooks: checked }))}
                  />
                </div>

                {/* Schedules notifications */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground">Scheduled Scan Reports</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Receive email summaries when scheduled scans complete, including severity breakdowns.
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.email_schedules}
                    onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, email_schedules: checked }))}
                  />
                </div>

                {/* Data request notifications */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Download className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground">Data Export Updates</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Notifications when your data export is ready for download.
                    </p>
                  </div>
                  <Switch
                    checked={notifPrefs.email_data_requests}
                    onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, email_data_requests: checked }))}
                  />
                </div>

                {/* Save button */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Changes are saved when you click the button.
                  </p>
                  <Button onClick={handleSaveNotifPrefs} disabled={savingNotifPrefs}>
                    {savingNotifPrefs ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Preferences
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Info card */}
            <Card className="bg-muted/30 border-muted">
              <CardContent className="pt-4">
                <div className="flex gap-3">
                  <Mail className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-foreground">About Email Notifications</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      We only send essential notifications related to your account activity.
                      You will always receive critical security alerts for unusual activity regardless of your preferences.
                      We never share your email or send marketing content.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===================== DATA & PRIVACY TAB ===================== */}
        {activeTab === "data" && (
          <div className="flex flex-col gap-6">
            {/* Privacy & Data Protection */}
            <Card className="bg-blue-500/5 border-blue-500/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-500" />
                  Privacy & Data Protection
                </CardTitle>
                <CardDescription>
                  Your data is protected under GDPR and other privacy regulations. You have the right to request access to your data, request deletion, and manage your privacy settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-card/50 border border-border">
                    <Globe className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">GDPR Compliant</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Full compliance with EU data protection regulations</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-card/50 border border-border">
                    <Lock className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">Encrypted Storage</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Your data is encrypted at rest and in transit</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Data Export */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Download className="h-4 w-4 text-primary" />
                  Data Export
                </CardTitle>
                <CardDescription>
                  Download your complete account data anytime. Fresh exports available once every 30 days.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4">
                  {/* Download Fresh Data Section */}
                  <div className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-secondary/30">
                    {/* Can download fresh data - no cooldown or cooldown expired */}
                    {dataReqInfo?.canDownloadNew && (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Download Fresh Export</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {dataReqInfo?.lastDownloadAt 
                              ? "Your 30-day cooldown has expired. Get a fresh export now." 
                              : "Download your complete account data now."}
                          </p>
                        </div>
                        <Button 
                          onClick={handleRequestData} 
                          disabled={requestingData}
                          className="shrink-0"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          {requestingData ? "Downloading..." : "Download Now"}
                        </Button>
                      </div>
                    )}

                    {/* Cooldown active - can't get fresh data yet */}
                    {!dataReqInfo?.canDownloadNew && dataReqInfo?.lastDownloadAt && (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Fresh Export Cooldown</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Next fresh export available in{" "}
                            <span className="font-mono text-foreground font-semibold">
                              {dataReqInfo.cooldownEndsAt ? getTimeRemaining(dataReqInfo.cooldownEndsAt) || "soon" : "soon"}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Last downloaded: {formatDate(dataReqInfo.lastDownloadAt)}
                          </p>
                        </div>
                        <Button disabled className="shrink-0">
                          <Clock className="mr-2 h-4 w-4" />
                          On Cooldown
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Re-download Previous Export */}
                  {dataReqInfo?.hasData && (
                    <div className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-muted/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Previous Export Available</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Re-download your last export anytime. This data was last updated {dataReqInfo.lastDownloadAt ? formatDate(dataReqInfo.lastDownloadAt) : "recently"}.
                          </p>
                        </div>
                        <Button 
                          onClick={handleDownloadPreviousData}
                          variant="outline"
                          className="shrink-0"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Re-download
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* How It Works Box */}
                  <div className="flex gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                    <Download className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">How It Works</p>
                      <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                        <li>1. Click "Download Now" to get a fresh export</li>
                        <li>2. Your data downloads as a JSON file</li>
                        <li>3. Re-download anytime from "Previous Export"</li>
                        <li>4. Request a new fresh export after 30 days</li>
                      </ul>
                    </div>
                  </div>

                  {/* What's Included Box */}
                  <div className="flex gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                    <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{"What's Included"}</p>
                      <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                        <li>Your profile information</li>
                        <li>All API keys and metadata</li>
                        <li>Complete scan history and results</li>
                        <li>API usage logs and statistics</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Danger Zone */}
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Danger Zone                </CardTitle>
                <CardDescription>Permanently delete your account and all associated data. This action cannot be undone.</CardDescription>
              </CardHeader>
              <CardContent>
                {!showDeleteConfirm ? (
                  <Button
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive bg-transparent"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Account
                  </Button>
                ) : (
                  <div className="flex flex-col gap-4 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Are you absolutely sure?</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        This will permanently delete your account, all API keys, scan history, and data exports.
                        Type <span className="font-mono font-semibold text-destructive">DELETE</span> to confirm.
                      </p>
                    </div>
                    <Input
                      placeholder="Type DELETE to confirm"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      className="bg-card font-mono"
                    />
                    <div className="flex items-center gap-2">
                      <Button variant="destructive" disabled={deleteConfirmText !== "DELETE" || deleting} onClick={handleDeleteAccount}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {deleting ? "Deleting..." : "Permanently Delete Account"}
                      </Button>
                      <Button variant="ghost" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText("") }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <Footer />

      <ImageCropDialog
        open={cropDialogOpen}
        imageSrc={cropImageSrc}
        onClose={() => { setCropDialogOpen(false); setCropImageSrc(null) }}
        onCrop={handleCroppedAvatar}
        saving={uploadingAvatar}
      />
    </div>
  )
}
