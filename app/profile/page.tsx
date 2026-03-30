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
import { ProfileDeveloperTab } from "@/components/profile/tabs/profile-developer-tab"
import { ProfileNotificationsTab } from "@/components/profile/tabs/profile-notifications-tab"
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
    setActiveProfileTab(tab)
    window.location.hash = tab
  }
  const [user, setUser] = useState<ProfileUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // API key state is now managed in ProfileDeveloperTab component

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

  // Data request state
  const [dataReqInfo, setDataReqInfo] = useState<DataRequestInfo | null>(null)
  const [requestingData, setRequestingData] = useState(false)

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

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
      const [userRes, dataReqRes, notifRes] = await Promise.all([
        fetch(API.AUTH.ME),
        fetch(API.DATA_REQUEST),
        fetch(API.ACCOUNT_NOTIFICATIONS),
      ])

      if (!userRes.ok) {
        router.push("/login")
        return
      }

      const userData = await userRes.json()
      const dataReqData = await dataReqRes.json()
      const notifData = notifRes.ok ? await notifRes.json() : null
      setUser(userData)
      setNameInput(userData.name || "")
      setEmailInput(userData.email || "")
      // Billing, 2FA, and Developer state are managed in their respective tab components
      setDataReqInfo(dataReqData)
      // Notification preferences are now managed in ProfileNotificationsTab component
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
              <ProfileDeveloperTab
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

            {/* ===================== NOTIFICATIONS TAB ===================== */}
            {activeProfileTab === "notifications" && (
              <ProfileNotificationsTab
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
