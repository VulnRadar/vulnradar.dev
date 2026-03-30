"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { cn } from "@/lib/ui/utils"
import { APP_NAME, API, ROUTES } from "@/lib/config/constants"

const ImageCropDialog = dynamic(() => import("@/components/modals/image-crop-dialog").then(m => ({ default: m.ImageCropDialog })), { ssr: false })
import { ProfileGeneralTab } from "@/components/profile/tabs/profile-general-tab"
import { ProfileSecurityTab } from "@/components/profile/tabs/profile-security-tab"
import { ProfileSocialTab } from "@/components/profile/tabs/profile-social-tab"
import { ProfileBillingTab } from "@/components/profile/tabs/profile-billing-tab"
import type { ProfileUser, ApiKey, BillingInfo, DataRequestInfo, WebhookItem, ScheduleItem, NotificationPrefs, ProfileTab, PendingChanges } from "@/components/profile/types"
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
  LogIn,
  Fingerprint,
  MonitorSmartphone,
  Scan,
  XCircle,
  AlertCircle,
  CheckCircle2,
  Gift,
  Gauge,
  Zap,
  Users,
  Lightbulb,
  Megaphone,
  Smartphone,
  Award,
  Tag,
  Share2,
  LogOut,
  CreditCard,
  TrendingUp,
  Calendar,
  RefreshCw,
  ExternalLink,
  Unlink,
  Play,
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
import { SaveConfirmationModal, type ChangeItem } from "@/components/shared/save-confirmation-modal"

// Types imported from @/components/profile/types

export default function ProfilePage() {
  return <ProfileContent />
}

function ProfileContent() {

  const router = useRouter()
  const VALID_TABS: ProfileTab[] = ["general", "security", "social", "billing", "developer", "notifications", "privacy"]
  const [activeProfileTab, setActiveProfileTab] = useState<ProfileTab>("general")

  // On mount, read hash and listen for back/forward hash changes
  useEffect(() => {
    const getProfileTab = (): ProfileTab => {
      const hash = window.location.hash.replace("#", "") as ProfileTab
      return VALID_TABS.includes(hash) ? hash : "general"
    }
    // Set default hash to #general if none provided
    if (!window.location.hash) {
      window.history.replaceState(null, "", "/profile#general")
    }
    setActiveProfileTab(getProfileTab())
    const onHashChange = () => {
      const newProfileTab = getProfileTab()
      // Clear pending changes when hash changes (browser nav)
      setPendingChanges({})
      setShowSaveModal(false)
      setActiveProfileTab(newProfileTab)
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Change tab — just update the hash, no page reload
  const handleProfileTabChange = (tab: ProfileTab) => {
    // Clear any pending changes when switching tabs
    if (Object.keys(pendingChanges).length > 0 || showSaveModal) {
      setPendingChanges({})
      setShowSaveModal(false)
      setNameInput(user?.name || "")
      setEmailInput(user?.email || "")
    }
    // Reset notification prefs to original if switching away from notifications
    if (activeProfileTab === "notifications" && originalNotifPrefs) {
      setNotifPrefs(originalNotifPrefs)
    }
    setActiveProfileTab(tab)
    window.location.hash = tab
  }
  const [user, setUser] = useState<ProfileUser | null>(null)
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
  const [profileEditMode, setProfileEditMode] = useState(false)
  const [nameInput, setNameInput] = useState("")
  const [emailInput, setEmailInput] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)

  // Unified pending changes system
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({})
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [originalNotifPrefs, setOriginalNotifPrefs] = useState<NotificationPrefs | null>(null)

  // Data request state
  const [dataReqInfo, setDataReqInfo] = useState<DataRequestInfo | null>(null)
  const [requestingData, setRequestingData] = useState(false)

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  // Webhooks state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    email_security: true,
    email_new_login: true,
    email_password_change: true,
    email_2fa_change: true,
    email_session_revoked: true,
    email_scan_complete: true,
    email_critical_findings: true,
    email_regression_alert: true,
    email_schedules: true,
    email_api_keys: true,
    email_api_limit_warning: true,
    email_webhooks: true,
    email_webhook_failure: true,
    email_data_requests: true,
    email_account_deletion: true,
    email_team_invite: true,
    email_team_changes: true,
  })
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false)

  // Billing state is now managed in ProfileBillingTab component

  // Avatar state
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [cropDialogOpen, setCropDialogOpen] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [isGifUpload, setIsGifUpload] = useState(false)
  const avatarInputRef = React.useRef<HTMLInputElement>(null)

  function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.")
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB.")
      return
    }
    setError(null)
    const isGif = file.type === "image/gif"
    setIsGifUpload(isGif)
    if (isGif) {
      // Skip crop dialog for GIFs to preserve animation
      const reader = new FileReader()
      reader.onload = () => handleCroppedAvatar(reader.result as string)
      reader.readAsDataURL(file)
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        setCropImageSrc(reader.result as string)
        setCropDialogOpen(true)
      }
      reader.readAsDataURL(file)
    }
    if (avatarInputRef.current) avatarInputRef.current.value = ""
  }

  async function handleCroppedAvatar(croppedDataUrl: string) {
    setUploadingAvatar(true)
    setError(null)
    try {
      const res = await fetch(API.AUTH.UPDATE, {
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
      const res = await fetch(API.AUTH.UPDATE, {
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
        fetch(API.AUTH.ME),
        fetch(API.KEYS),
        fetch(API.DATA_REQUEST),
        fetch(API.WEBHOOKS),
        fetch(API.SCHEDULES),
        fetch(API.ACCOUNT_NOTIFICATIONS),
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
      setNameInput(userData.name || "")
      setEmailInput(userData.email || "")
      // Billing and 2FA state are managed in their respective tab components
      setKeys(keysData.keys || [])
      setDataReqInfo(dataReqData)
      setWebhooks(Array.isArray(webhooksData) ? webhooksData : [])
      setSchedules(Array.isArray(schedulesData) ? schedulesData : [])
      if (notifData) {
        setNotifPrefs((prev) => {
          const updated = { ...prev }
          for (const key of Object.keys(prev) as (keyof NotificationPrefs)[]) {
            if (key in notifData) updated[key] = notifData[key] ?? true
          }
          setOriginalNotifPrefs(updated) // Store original for change detection
          return updated
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
      const res = await fetch(API.AUTH.UPDATE, {
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
      const res = await fetch(API.AUTH.UPDATE, {
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

  // ---- API key handlers ----
  async function handleGenerateKey() {
    setGeneratingKey(true)
    setError(null)
    setNewlyCreatedKey(null)
    try {
      const res = await fetch(API.KEYS, {
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

  async function handleRotateKey(keyId: number) {
    setRevokingId(keyId)
    try {
      const res = await fetch(`${API.KEYS}/${keyId}/rotate`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to rotate key.")
        return
      }
      // Show the new key to the user
      if (data.key?.raw_key) {
        setNewlyCreatedKey(data.key.raw_key)
      }
      await fetchData()
    } catch {
      setError("Failed to rotate key.")
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
      const res = await fetch(API.DATA_REQUEST, { method: "POST" })
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
      const dlRes = await fetch(API.DATA_REQUEST)
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
      const res = await fetch(API.ACCOUNT_DELETE, { method: "POST" })
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
      const res = await fetch(API.ACCOUNT_NOTIFICATIONS, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notifPrefs),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to save notification preferences.")
        return
      }
      setNotifPrefs((prev) => {
        const updated = { ...prev }
        for (const key of Object.keys(prev) as (keyof NotificationPrefs)[]) {
          if (key in data) updated[key] = data[key]
        }
        setOriginalNotifPrefs(updated)
        return updated
      })
      setSuccess("Notification preferences saved.")
    } catch {
      setError("Failed to save notification preferences.")
    } finally {
      setSavingNotifPrefs(false)
    }
  }

  // Unified save all changes
  async function saveAllPendingChanges() {
    setSavingProfile(true)
    setError(null)
    let savedCount = 0

    try {
      // Save name if changed
      if (pendingChanges.name !== undefined) {
        const res = await fetch(API.ACCOUNT, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: pendingChanges.name }),
        })
        if (res.ok) {
          const data = await res.json()
          setUser((u) => u ? { ...u, name: data.name } : u)
          savedCount++
        }
      }

      // Save email if changed
      if (pendingChanges.email !== undefined) {
        const res = await fetch(API.ACCOUNT, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: pendingChanges.email }),
        })
        if (res.ok) {
          const data = await res.json()
          setUser((u) => u ? { ...u, email: data.email } : u)
          savedCount++
        }
      }

      // Save notification prefs if changed
      if (hasNotificationChanges) {
        const res = await fetch(API.ACCOUNT_NOTIFICATIONS, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(notifPrefs),
        })
        if (res.ok) {
          const data = await res.json()
          setNotifPrefs((prev) => {
            const updated = { ...prev }
            for (const key of Object.keys(prev) as (keyof NotificationPrefs)[]) {
              if (key in data) updated[key] = data[key]
            }
            setOriginalNotifPrefs(updated)
            return updated
          })
          savedCount++
        }
      }

      setPendingChanges({})
      setShowSaveModal(false)
      setSuccess(`Changes saved successfully.`)
    } catch {
      setError("Failed to save some changes.")
    } finally {
      setSavingProfile(false)
    }
  }

  // Notification pref labels for display
  const NOTIF_LABELS: Record<keyof NotificationPrefs, string> = {
    email_security: "Security Alerts",
    email_new_login: "Login Alerts",
    email_password_change: "Password Changes",
    email_2fa_change: "2FA Changes",
    email_session_revoked: "Session Revoked",
    email_scan_complete: "Scan Complete",
    email_critical_findings: "Critical Findings",
    email_regression_alert: "Regression Alerts",
    email_schedules: "Scheduled Scans",
    email_api_keys: "API Key Activity",
    email_api_limit_warning: "API Limit Warning",
    email_webhooks: "Webhook Activity",
    email_webhook_failure: "Webhook Failures",
    email_data_requests: "Data Requests",
    email_account_deletion: "Account Deletion",
    email_team_invite: "Team Invites",
    email_team_changes: "Team Changes",


  }

  // Check for notification changes and build list
  const changedNotifications: { key: keyof NotificationPrefs; oldVal: boolean; newVal: boolean }[] = []
  if (originalNotifPrefs) {
    for (const key of Object.keys(notifPrefs) as (keyof NotificationPrefs)[]) {
      if (notifPrefs[key] !== originalNotifPrefs[key]) {
        changedNotifications.push({ key, oldVal: originalNotifPrefs[key], newVal: notifPrefs[key] })
      }
    }
  }
  const hasNotificationChanges = changedNotifications.length > 0

  // Check for any pending changes
  const hasPendingChanges = Object.keys(pendingChanges).length > 0 || hasNotificationChanges

  // Build change items for modal
  const pendingChangeItems: ChangeItem[] = [
    ...(pendingChanges.name !== undefined ? [{
      field: "name",
      label: "Display Name",
      oldValue: user?.name || "",
      newValue: pendingChanges.name
    }] : []),
    ...(pendingChanges.email !== undefined ? [{
      field: "email",
      label: "Email Address",
      oldValue: user?.email || "",
      newValue: pendingChanges.email
    }] : []),
    ...changedNotifications.map(({ key, oldVal, newVal }) => ({
      field: key,
      label: NOTIF_LABELS[key] || key,
      oldValue: oldVal ? "Enabled" : "Disabled",
      newValue: newVal ? "Enabled" : "Disabled"
    })),
  ]

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
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading profile...</p>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  const activeKeys = keys.filter((k) => !k.revoked_at)
  const revokedKeys = keys.filter((k) => k.revoked_at)

  const TABS = [
    { id: "general" as ProfileTab, label: "General", icon: <UserCog className="h-4 w-4" /> },
    { id: "security" as ProfileTab, label: "Security", icon: <Lock className="h-4 w-4" /> },
    { id: "social" as ProfileTab, label: "Social", icon: <Share2 className="h-4 w-4" /> },
    { id: "billing" as ProfileTab, label: "Billing", icon: <CreditCard className="h-4 w-4" /> },
    { id: "developer" as ProfileTab, label: "Developer", icon: <Key className="h-4 w-4" /> },
    { id: "notifications" as ProfileTab, label: "Notifications", icon: <Bell className="h-4 w-4" /> },
    { id: "privacy" as ProfileTab, label: "Privacy", icon: <Shield className="h-4 w-4" /> },
  ]

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
      <Header />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-8 min-w-0">

        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Manage your account settings and preferences</p>
        </div>

        {/* Toast messages */}
        {(error || success) && (
          <div
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg text-sm",
              error ? "bg-destructive/10 text-destructive border border-destructive/20" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
            )}
          >
            {error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
            <span className="flex-1">{error || success}</span>
            <button onClick={() => { setError(null); setSuccess(null) }} className="text-xs hover:underline opacity-70 hover:opacity-100">
              Dismiss
            </button>
          </div>
        )}

        {/* Two-column layout: Sidebar + Content */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">

          {/* Sidebar Navigation */}
          <aside className="lg:w-48 lg:shrink-0">
            {/* Mobile: Scrollable horizontal tab bar */}
            <div className="lg:hidden overflow-x-auto scrollbar-hide -mx-4 px-4 border-b border-border/80">
              <div className="flex gap-0.5 min-w-max">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleProfileTabChange(tab.id)}
                    className={cn(
                      "flex items-center gap-2 px-3.5 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px",
                      activeProfileTab === tab.id
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Desktop: Vertical sidebar */}
            <nav className="hidden lg:block sticky top-24">
              <div className="flex flex-col gap-1">
                {TABS.map((tab) => (
                  <a
                    key={tab.id}
                    href={`/profile#${tab.id}`}
                    onClick={(e) => {
                      if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault()
                        handleProfileTabChange(tab.id)
                      }
                    }}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all",
                      activeProfileTab === tab.id
                        ? "bg-secondary text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                    )}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </a>
                ))}
              </div>
            </nav>
          </aside>

          {/* Main Content Area */}
          <div className="flex-1 min-w-0">

            {/* ===================== GENERAL TAB ===================== */}
            {activeProfileTab === "general" && (
              <ProfileGeneralTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
                onAvatarCrop={handleCroppedAvatar}
                onSetCropDialog={(open, src) => {
                  setCropDialogOpen(open)
                  setCropImageSrc(src)
                }}
              />
            )}

            {/* ===================== SOCIAL TAB ===================== */}
            {activeProfileTab === "social" && (
              <ProfileSocialTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
              />
            )}

            {/* ===================== BILLING TAB ===================== */}
            {activeProfileTab === "billing" && (
              <ProfileBillingTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
              />
            )}

            {/* ===================== SECURITY TAB ===================== */}
            {activeProfileTab === "security" && (
              <ProfileSecurityTab
                user={user}
                loading={loading}
                error={error}
                success={success}
                setError={setError}
                setSuccess={setSuccess}
                onTabChange={handleProfileTabChange}
                pendingChanges={pendingChanges}
                setPendingChanges={setPendingChanges}
              />
            )}

            {/* ===================== DEVELOPER TAB ===================== */}
            {activeProfileTab === "developer" && (
              <div className="flex flex-col gap-10">
                <section>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                        <Key className="h-4.5 w-4.5 text-primary" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-foreground">API Keys</h2>
                        <p className="text-sm text-muted-foreground">Rate limit based on your plan, max 3 keys</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="shrink-0" asChild>
                      <a href="/docs">View Docs</a>
                    </Button>
                  </div>
                  <Card className="border-border/60">
                    <CardContent className="pt-6 flex flex-col gap-6">
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
                                  <span className="text-sm font-medium text-foreground truncate">{key.name}</span>
                                  <Badge variant="outline" className="text-xs font-mono text-muted-foreground shrink-0">{key.key_prefix}...</Badge>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRotateKey(key.id)}
                                  disabled={revokingId === key.id}
                                  className="text-muted-foreground hover:text-foreground h-8 gap-1.5"
                                  aria-label="Rotate key"
                                >
                                  <RefreshCw className={cn("h-3.5 w-3.5", revokingId === key.id && "animate-spin")} />
                                  <span className="hidden sm:inline">Rotate</span>
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
                          <p className="text-xs text-muted-foreground">Generate a key above to start using the {APP_NAME} API.</p>
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
                </section>
              </div>
            )}

            {/* ===================== WEBHOOKS SECTION (renders in Developer tab) ===================== */}
            {activeProfileTab === "developer" && (
              <div className="flex flex-col gap-10 mt-10">
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                      <Webhook className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Webhooks</h2>
                      <p className="text-sm text-muted-foreground">Discord, Slack, and JSON webhook notifications</p>
                    </div>
                  </div>
                  <Card className="border-border/60">
                    <CardContent className="pt-6 space-y-4">
                      {/* Add webhook form */}
                      <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/30">
                        <Label className="text-sm font-medium">Add Endpoint</Label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            placeholder="Name (e.g. Discord Alerts)"
                            value={webhookName}
                            onChange={(e) => setWebhookName(e.target.value)}
                            className="sm:w-44 bg-card h-10"
                          />
                          <Input
                            placeholder="https://discord.com/api/webhooks/..."
                            value={webhookUrl}
                            onChange={(e) => setWebhookUrl(e.target.value)}
                            className="flex-1 bg-card h-10"
                          />
                          <Button
                            disabled={!webhookUrl || addingWebhook}
                            onClick={async () => {
                              setAddingWebhook(true)
                              try {
                                const res = await fetch(API.WEBHOOKS, {
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
                      </div>

                      {/* Webhook list */}
                      {webhooks.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No webhooks configured yet.</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {webhooks.map((wh) => (
                            <div key={wh.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border">
                              {wh.type === "discord" ? (
                                <svg className="h-4 w-4 text-[#5865F2] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
                              ) : wh.type === "slack" ? (
                                <svg className="h-4 w-4 text-[#E01E5A] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" /></svg>
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
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                                  disabled={testingWebhookId === wh.id}
                                  onClick={async () => {
                                    setTestingWebhookId(wh.id)
                                    try {
                                      const res = await fetch(API.WEBHOOKS, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ id: wh.id }),
                                      })
                                      const data = await res.json()
                                      if (res.ok) {
                                        setSuccess("Test webhook sent successfully!")
                                      } else {
                                        setError(data.error || "Failed to test webhook")
                                      }
                                    } catch {
                                      setError("Failed to test webhook")
                                    }
                                    setTestingWebhookId(null)
                                  }}
                                  title="Send test webhook"
                                >
                                  {testingWebhookId === wh.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive dark:text-red-400 hover:text-destructive dark:hover:text-red-400 hover:bg-destructive/10"
                                  onClick={async () => {
                                    await fetch(API.WEBHOOKS, {
                                      method: "DELETE",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ id: wh.id }),
                                    })
                                    setWebhooks((prev) => prev.filter((w) => w.id !== wh.id))
                                  }}
                                  title="Delete webhook"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}


                    </CardContent>
                  </Card>
                </section>

                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                      <CalendarClock className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Scheduled Scans</h2>
                      <p className="text-sm text-muted-foreground">Auto-scan URLs on a recurring schedule</p>
                    </div>
                  </div>
                  <Card className="border-border/60">
                    <CardContent className="pt-6 space-y-4">
                      {/* Add schedule form */}
                      <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/30">
                        <Label className="text-sm font-medium">Add Schedule</Label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            placeholder="https://example.com"
                            value={scheduleUrl}
                            onChange={(e) => setScheduleUrl(e.target.value)}
                            className="flex-1 bg-card h-10"
                          />
                          <select
                            value={scheduleFreq}
                            onChange={(e) => setScheduleFreq(e.target.value)}
                            className="h-10 px-3 rounded-md border border-border bg-card text-foreground text-sm"
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
                                const res = await fetch(API.SCHEDULES, {
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
                                className="h-7 w-7 text-destructive dark:text-red-400 hover:text-destructive dark:hover:text-red-400 hover:bg-destructive/10 shrink-0"
                                onClick={async () => {
                                  await fetch(API.SCHEDULES, {
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
                </section>
              </div>
            )}

            {/* ===================== NOTIFICATIONS TAB ===================== */}
            {activeProfileTab === "notifications" && (
              <div className="flex flex-col gap-10">
                {/* --- SECURITY --- */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                      <Shield className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Security Notifications</h2>
                      <p className="text-sm text-muted-foreground">Critical alerts for account access and auth</p>
                    </div>
                  </div>
                  <Card className="border-border/60">
                    <CardContent className="pt-6 pb-4 flex flex-col gap-4">
                      {([
                        { key: "email_security" as const, icon: Shield, label: "Security Alerts", desc: "Unusual activity, account compromise warnings, and critical security events.", badge: "Recommended" },
                        { key: "email_new_login" as const, icon: LogIn, label: "Login Alerts", desc: "Notifications when someone signs into your account from a new device or location." },
                        { key: "email_password_change" as const, icon: Lock, label: "Password Changes", desc: "Alerts when your password is changed or a reset is requested." },
                        { key: "email_2fa_change" as const, icon: Fingerprint, label: "2FA Changes", desc: "Notifications when two-factor authentication is enabled, disabled, or modified." },
                        { key: "email_session_revoked" as const, icon: MonitorSmartphone, label: "Session Alerts", desc: "Alerts about active sessions and session revocations." },
                      ] as const).map(({ key, icon: Icon, label, desc, badge }) => (
                        <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <p className="text-sm font-medium text-foreground">{label}</p>
                              {badge && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 uppercase font-semibold">{badge}</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 ml-5.5">{desc}</p>
                          </div>
                          <Switch checked={notifPrefs[key]} onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, [key]: checked }))} />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </section>

                {/* --- SCANNING --- */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                      <Scan className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Scanning Notifications</h2>
                      <p className="text-sm text-muted-foreground">Results and scheduled scan alerts</p>
                    </div>
                  </div>
                  <Card className="border-border/60">
                    <CardContent className="pt-6 pb-4 flex flex-col gap-4">
                      {([
                        { key: "email_scan_complete" as const, icon: CheckCircle2, label: "Scan Completed", desc: "Alerts when vulnerability scans are finished." },
                        { key: "email_critical_findings" as const, icon: AlertCircle, label: "Critical Issues Found", desc: "Immediate alerts when critical vulnerabilities are detected." },
                        { key: "email_schedules" as const, icon: CalendarClock, label: "Scheduled Scans Completed", desc: "Alerts when your scheduled scans finish." },
                      ] as const).map(({ key, icon: Icon, label, desc }) => (
                        <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <p className="text-sm font-medium text-foreground">{label}</p>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 ml-5.5">{desc}</p>
                          </div>
                          <Switch checked={notifPrefs[key]} onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, [key]: checked }))} />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </section>

                {/* --- API & INTEGRATIONS --- */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                      <Zap className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">{"API & Integrations"}</h2>
                      <p className="text-sm text-muted-foreground">API keys, limits, and webhook alerts</p>
                    </div>
                  </div>
                  <Card className="border-border/60">
                    <CardContent className="pt-6 pb-4 flex flex-col gap-4">
                      {([
                        { key: "email_api_keys" as const, icon: Key, label: "API Key Activity", desc: "Alerts when API keys are created, revoked, or approaching expiration." },
                        { key: "email_api_limit_warning" as const, icon: Gauge, label: "API Limit Warnings", desc: "Warnings when your API usage nears rate limits or daily quotas." },
                        { key: "email_webhooks" as const, icon: Webhook, label: "Webhook Events", desc: "Notifications when webhooks are created, modified, or disabled." },
                        { key: "email_webhook_failure" as const, icon: XCircle, label: "Webhook Failures", desc: "Alerts when webhook deliveries fail repeatedly." },
                      ] as const).map(({ key, icon: Icon, label, desc }) => (
                        <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <p className="text-sm font-medium text-foreground">{label}</p>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 ml-5.5">{desc}</p>
                          </div>
                          <Switch checked={notifPrefs[key]} onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, [key]: checked }))} />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </section>

                {/* --- ACCOUNT --- */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                      <UserCog className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Account Notifications</h2>
                      <p className="text-sm text-muted-foreground">Account and team activity alerts</p>
                    </div>
                  </div>
                  <Card className="border-border/60">
                    <CardContent className="pt-6 pb-4 flex flex-col gap-4">
                      {([
                        { key: "email_data_requests" as const, icon: Download, label: "Data Export Updates", desc: "Notifications when your data export is ready for download." },
                        { key: "email_account_deletion" as const, icon: UserCog, label: "Account Deletion", desc: "Confirmations and alerts when account deletion is requested or processed." },
                        { key: "email_team_invite" as const, icon: Users, label: "Team Invites", desc: "Notifications when you're invited to join a team or workspace." },
                        { key: "email_team_changes" as const, icon: Users, label: "Team Changes", desc: "Alerts about team membership changes, role updates, and team activity." },
                      ] as const).map(({ key, icon: Icon, label, desc }) => (
                        <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <p className="text-sm font-medium text-foreground">{label}</p>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 ml-5.5">{desc}</p>
                          </div>
                          <Switch checked={notifPrefs[key]} onCheckedChange={(checked) => setNotifPrefs(prev => ({ ...prev, [key]: checked }))} />
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                </section>

                {/* Info card */}
                <section>
                  <Card className="bg-muted/30 border-muted">
                    <CardContent className="pt-6">
                      <div className="flex gap-3">
                        <Mail className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-foreground">About Email Notifications</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            We only send essential notifications. Critical security alerts are always sent regardless of your preferences.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </section>
              </div>
            )}

            {/* ===================== PRIVACY TAB ===================== */}
            {activeProfileTab === "privacy" && (
              <div className="flex flex-col gap-10">
                {/* Privacy & Data Protection */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                      <Shield className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Privacy & Data Protection</h2>
                      <p className="text-sm text-muted-foreground">Protected under GDPR and privacy regulations</p>
                    </div>
                  </div>
                  <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="pt-6 space-y-3">
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
                </section>

                {/* Data Export */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
                      <Download className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Data Export</h2>
                      <p className="text-sm text-muted-foreground">Download your data, available every 30 days</p>
                    </div>
                  </div>
                  <Card className="border-border/60">
                    <CardContent className="pt-6">
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
                </section>

                {/* Danger Zone */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-destructive/10">
                      <AlertTriangle className="h-4.5 w-4.5 text-destructive" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-destructive">Danger Zone</h2>
                      <p className="text-sm text-muted-foreground">Permanent account deletion, cannot be undone</p>
                    </div>
                  </div>
                  <Card className="border-destructive/30">
                    <CardContent className="pt-6">
                      {!showDeleteConfirm ? (
                        <Button
                          variant="outline"
                          className="text-destructive dark:text-red-400 border-destructive/30 hover:bg-destructive/10 hover:text-destructive dark:hover:text-red-400 bg-transparent"
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
                </section>
              </div>
            )}
          </div>{/* End Main Content Area */}
        </div>{/* End Two-column layout */}

        {/* Bottom spacer for floating save bar */}
        {hasPendingChanges && <div className="h-20" />}
      </main>

      {/* Floating Save Bar */}
      {hasPendingChanges && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-card border border-border shadow-lg">
              <div className="flex items-center gap-3">
                <Save className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">
                  {pendingChangeItems.length} unsaved change{pendingChangeItems.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingChanges({})
                    setNameInput(user?.name || "")
                    setEmailInput(user?.email || "")
                    if (originalNotifPrefs) setNotifPrefs(originalNotifPrefs)
                  }}
                >
                  Discard
                </Button>
                <Button size="sm" onClick={() => setShowSaveModal(true)}>
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async () => {
          await saveAllPendingChanges()
        }}
        title="Save Changes"
        description="Review your pending changes before saving."
        changes={pendingChangeItems}
        loading={savingProfile}
        isAdminAction={false}
        confirmText="Save All Changes"
      />

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
