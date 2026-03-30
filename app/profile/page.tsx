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
import { ProfilePrivacyTab } from "@/components/profile/tabs/profile-privacy-tab"
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

  // Data request and delete state are now managed in ProfilePrivacyTab component

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

  // ---- Account handlers ----
  // Data request and delete handlers are now managed in ProfilePrivacyTab component

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

      setPendingChanges({})
      setShowSaveModal(false)
      setSuccess(`Changes saved successfully.`)
    } catch {
      setError("Failed to save some changes.")
    } finally {
      setSavingProfile(false)
    }
  }

  // Check for pending changes
  const hasPendingChanges = Object.keys(pendingChanges).length > 0

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
  ]

  // ---- Helpers ----

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
              <ProfilePrivacyTab
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
                    setPendingChanges({})
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
