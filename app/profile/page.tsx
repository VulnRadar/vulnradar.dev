"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { APP_NAME, API, ROUTES } from "@/lib/constants"

const ImageCropDialog = dynamic(() => import("@/components/image-crop-dialog").then(m => ({ default: m.ImageCropDialog })), { ssr: false })
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
  Search,
  ChevronRight,
  Settings,
  User,
  Code2,
  ShieldCheck,
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
import { SaveConfirmationModal, type ChangeItem } from "@/components/save-confirmation-modal"

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

interface UserBadge {
  id: number
  name: string
  display_name: string
  description: string | null
  icon: string | null
  color: string | null
  priority: number
  awarded_at: string
}

interface User {
  userId: number
  email: string
  name: string | null
  totpEnabled?: boolean
  twoFactorMethod?: string | null
  avatarUrl?: string | null
  role?: string
  badges?: UserBadge[]
  discordId?: string
  discordUsername?: string
  discordAvatar?: string
}

interface DataRequestInfo {
  hasData: boolean
  canDownloadNew: boolean
  cooldownEndsAt?: string
  lastDownloadAt?: string
}

interface BillingInfo {
  billingEnabled: boolean
  plan: string
  subscriptionStatus: string | null
  stripeCustomerId: string | null
  subscription: {
    id: string
    status: string
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    cancelAt: string | null
  } | null
  giftedSubscription: {
    plan: string
    expiresAt: string
    startedAt: string
  } | null
  usage: {
    used: number
    limit: number
    remaining: number
    resetsAt: string
    unlimited: boolean
  }
  limits: {
    free: number
    core_supporter: number
    pro_supporter: number
    elite_supporter: number
  }
}

type Tab = "general" | "security" | "social" | "billing" | "developer" | "notifications" | "privacy"

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
  email_security: boolean
  email_new_login: boolean
  email_password_change: boolean
  email_2fa_change: boolean
  email_session_revoked: boolean
  email_scan_complete: boolean
  email_critical_findings: boolean
  email_regression_alert: boolean
  email_schedules: boolean
  email_api_keys: boolean
  email_api_limit_warning: boolean
  email_webhooks: boolean
  email_webhook_failure: boolean
  email_data_requests: boolean
  email_account_deletion: boolean
  email_team_invite: boolean
  email_team_changes: boolean
  email_product_updates: boolean
  email_tips_guides: boolean
}

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: User },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "social", label: "Connected Accounts", icon: Share2 },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "developer", label: "Developer", icon: Code2 },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "privacy", label: "Privacy", icon: Lock },
]

export default function ProfilePage() {
  return <ProfileContent />
}

function ProfileContent() {
  const router = useRouter()
  const VALID_TABS: Tab[] = ["general", "security", "social", "billing", "developer", "notifications", "privacy"]
  const [activeTab, setActiveTab] = useState<Tab>("general")
  const [sidebarSearch, setSidebarSearch] = useState("")

  // On mount, read hash and listen for back/forward hash changes
  useEffect(() => {
    const getTab = (): Tab => {
      const hash = window.location.hash.replace("#", "") as Tab
      return VALID_TABS.includes(hash) ? hash : "general"
    }
    if (!window.location.hash) {
      window.history.replaceState(null, "", "/profile#general")
    }
    setActiveTab(getTab())
    const onHashChange = () => {
      const newTab = getTab()
      setPendingChanges({})
      setShowSaveModal(false)
      setActiveTab(newTab)
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTabChange = (tab: Tab) => {
    if (Object.keys(pendingChanges).length > 0 || showSaveModal) {
      setPendingChanges({})
      setShowSaveModal(false)
      setNameInput(user?.name || "")
      setEmailInput(user?.email || "")
    }
    if (activeTab === "notifications" && originalNotifPrefs) {
      setNotifPrefs(originalNotifPrefs)
    }
    setActiveTab(tab)
    window.location.hash = tab
  }

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
  const [profileEditMode, setProfileEditMode] = useState(false)
  const [nameInput, setNameInput] = useState("")
  const [emailInput, setEmailInput] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)
  
  // Unified pending changes system
  const [pendingChanges, setPendingChanges] = useState<{
    name?: string
    email?: string
    notifications?: Partial<NotificationPrefs>
  }>({})
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [originalNotifPrefs, setOriginalNotifPrefs] = useState<NotificationPrefs | null>(null)

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
  const [testingWebhookId, setTestingWebhookId] = useState<number | null>(null)

  // Schedules state
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [scheduleUrl, setScheduleUrl] = useState("")
  const [scheduleFreq, setScheduleFreq] = useState("weekly")
  const [addingSchedule, setAddingSchedule] = useState(false)

  // Email 2FA state
  const [twoFactorMethod, setTwoFactorMethod] = useState<string | null>(null)
  const [email2FAPassword, setEmail2FAPassword] = useState("")
  const [togglingEmail2FA, setTogglingEmail2FA] = useState(false)

  // Force logout state
  const [forceLoggingOut, setForceLoggingOut] = useState(false)

  // Notification preferences state
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
    email_product_updates: true,
    email_tips_guides: false,
  })
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false)

  // Billing state
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [cancelingSubscription, setCancelingSubscription] = useState(false)
  const [reactivatingSubscription, setReactivatingSubscription] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelType, setCancelType] = useState<"period_end" | "immediate">("period_end")

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
      const [userRes, keysRes, dataReqRes, webhooksRes, schedulesRes, notifRes, billingRes] = await Promise.all([
        fetch(API.AUTH.ME),
        fetch(API.KEYS),
        fetch(API.DATA_REQUEST),
        fetch(API.WEBHOOKS),
        fetch(API.SCHEDULES),
        fetch(API.ACCOUNT_NOTIFICATIONS),
        fetch(API.BILLING),
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
      const billingData = billingRes.ok ? await billingRes.json() : null
      setUser(userData)
      setNameInput(userData.name || "")
      setEmailInput(userData.email || "")
      if (billingData) {
        setBillingInfo(billingData)
      } else if (billingRes.status === 500) {
        try {
          const retryRes = await fetch(API.BILLING)
          if (retryRes.ok) {
            const retryData = await retryRes.json()
            setBillingInfo(retryData)
          }
        } catch {
          // Silently fail
        }
      }
      setTotpEnabled(userData.totpEnabled || false)
      setTwoFactorMethod(userData.twoFactorMethod || null)
      if (userData.totpEnabled && userData.twoFactorMethod === "app") {
        fetch(API.AUTH.TWO_FA.BACKUP_CODES).then(r => r.json()).then(d => setBackupCodesRemaining(d.remaining || 0)).catch(() => { })
      }
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
          setOriginalNotifPrefs(updated)
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

  // Profile handlers
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
      const res = await fetch(API.AUTH.UPDATE, {
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

  // API key handlers
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

  async function handleRevokeKey(keyId: number) {
    setRevokingId(keyId)
    try {
      await fetch(`${API.KEYS}/${keyId}/revoke`, { method: "POST" })
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

  // Data request handlers
  async function handleRequestData() {
    setRequestingData(true)
    setError(null)
    try {
      const res = await fetch(API.DATA_REQUEST, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to request data export.")
        return
      }
      setSuccess("Data export requested. You'll receive an email when ready.")
      await fetchData()
    } catch {
      setError("Failed to request data export.")
    } finally {
      setRequestingData(false)
    }
  }

  // Delete account handlers
  async function handleDeleteAccount() {
    if (deleteConfirmText !== "DELETE") {
      setError("Please type DELETE to confirm.")
      return
    }
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(API.AUTH.DELETE, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to delete account.")
        return
      }
      router.push("/")
    } catch {
      setError("Failed to delete account.")
    } finally {
      setDeleting(false)
    }
  }

  // 2FA handlers
  async function handleEnable2FA() {
    setSetting2FA(true)
    setError(null)
    try {
      const res = await fetch(API.AUTH.TWO_FA.SETUP, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setTotpUri(data.uri)
      setTotpSecret(data.secret)
    } catch {
      setError("Failed to setup 2FA.")
    } finally {
      setSetting2FA(false)
    }
  }

  async function handleVerify2FA() {
    if (totpVerifyCode.length !== 6) {
      setError("Enter a 6-digit code.")
      return
    }
    setSetting2FA(true)
    setError(null)
    try {
      const res = await fetch(API.AUTH.TWO_FA.VERIFY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpVerifyCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setTotpEnabled(true)
      setTwoFactorMethod("app")
      setTotpUri("")
      setTotpSecret("")
      setTotpVerifyCode("")
      setBackupCodes(data.backupCodes || [])
      setBackupCodesRemaining(data.backupCodes?.length || 0)
      setSuccess("2FA enabled successfully.")
    } catch {
      setError("Failed to verify 2FA.")
    } finally {
      setSetting2FA(false)
    }
  }

  async function handleDisable2FA() {
    if (!disablePassword) {
      setError("Password required.")
      return
    }
    setSetting2FA(true)
    setError(null)
    try {
      const res = await fetch(API.AUTH.TWO_FA.DISABLE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setTotpEnabled(false)
      setTwoFactorMethod(null)
      setShowDisable2FA(false)
      setDisablePassword("")
      setSuccess("2FA disabled.")
    } catch {
      setError("Failed to disable 2FA.")
    } finally {
      setSetting2FA(false)
    }
  }

  async function handleRegenerateBackupCodes() {
    if (!regenPassword) {
      setError("Password required.")
      return
    }
    setSetting2FA(true)
    setError(null)
    try {
      const res = await fetch(API.AUTH.TWO_FA.REGENERATE_BACKUP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: regenPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setBackupCodes(data.backupCodes || [])
      setBackupCodesRemaining(data.backupCodes?.length || 0)
      setShowRegenerateBackup(false)
      setRegenPassword("")
      setSuccess("Backup codes regenerated.")
    } catch {
      setError("Failed to regenerate backup codes.")
    } finally {
      setSetting2FA(false)
    }
  }

  // Email 2FA handlers
  async function handleToggleEmail2FA() {
    if (!email2FAPassword) {
      setError("Password required.")
      return
    }
    setTogglingEmail2FA(true)
    setError(null)
    try {
      const endpoint = twoFactorMethod === "email" ? API.AUTH.EMAIL_2FA.DISABLE : API.AUTH.EMAIL_2FA.ENABLE
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: email2FAPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setTwoFactorMethod(twoFactorMethod === "email" ? null : "email")
      setEmail2FAPassword("")
      setSuccess(twoFactorMethod === "email" ? "Email 2FA disabled." : "Email 2FA enabled.")
    } catch {
      setError("Failed to toggle email 2FA.")
    } finally {
      setTogglingEmail2FA(false)
    }
  }

  // Webhook handlers
  async function handleAddWebhook() {
    if (!webhookUrl.trim()) {
      setError("Webhook URL required.")
      return
    }
    setAddingWebhook(true)
    setError(null)
    try {
      const res = await fetch(API.WEBHOOKS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl.trim(), name: webhookName.trim() || "Webhook" }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setWebhookUrl("")
      setWebhookName("")
      await fetchData()
      setSuccess("Webhook added.")
    } catch {
      setError("Failed to add webhook.")
    } finally {
      setAddingWebhook(false)
    }
  }

  async function handleDeleteWebhook(id: number) {
    try {
      await fetch(`${API.WEBHOOKS}/${id}`, { method: "DELETE" })
      await fetchData()
    } catch {
      setError("Failed to delete webhook.")
    }
  }

  async function handleTestWebhook(id: number) {
    setTestingWebhookId(id)
    try {
      const res = await fetch(`${API.WEBHOOKS}/${id}/test`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Webhook test failed.")
      } else {
        setSuccess("Webhook test sent.")
      }
    } catch {
      setError("Failed to test webhook.")
    } finally {
      setTestingWebhookId(null)
    }
  }

  // Schedule handlers
  async function handleAddSchedule() {
    if (!scheduleUrl.trim()) {
      setError("Schedule URL required.")
      return
    }
    setAddingSchedule(true)
    setError(null)
    try {
      const res = await fetch(API.SCHEDULES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scheduleUrl.trim(), frequency: scheduleFreq }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setScheduleUrl("")
      await fetchData()
      setSuccess("Schedule added.")
    } catch {
      setError("Failed to add schedule.")
    } finally {
      setAddingSchedule(false)
    }
  }

  async function handleDeleteSchedule(id: number) {
    try {
      await fetch(`${API.SCHEDULES}/${id}`, { method: "DELETE" })
      await fetchData()
    } catch {
      setError("Failed to delete schedule.")
    }
  }

  // Force logout handler
  async function handleForceLogout() {
    setForceLoggingOut(true)
    setError(null)
    try {
      const res = await fetch(API.AUTH.FORCE_LOGOUT, { method: "POST" })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to logout other sessions.")
        return
      }
      setSuccess("All other sessions have been logged out.")
    } catch {
      setError("Failed to logout other sessions.")
    } finally {
      setForceLoggingOut(false)
    }
  }

  // Notification prefs handlers
  async function handleSaveNotifPrefs() {
    setSavingNotifPrefs(true)
    setError(null)
    try {
      const res = await fetch(API.ACCOUNT_NOTIFICATIONS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notifPrefs),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to save preferences.")
        return
      }
      setOriginalNotifPrefs(notifPrefs)
      setSuccess("Notification preferences saved.")
    } catch {
      setError("Failed to save preferences.")
    } finally {
      setSavingNotifPrefs(false)
    }
  }

  // Billing handlers
  async function handleCancelSubscription() {
    setCancelingSubscription(true)
    setError(null)
    try {
      const res = await fetch(API.BILLING_CANCEL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelType }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to cancel subscription.")
        return
      }
      setShowCancelDialog(false)
      await fetchData()
      setSuccess("Subscription canceled.")
    } catch {
      setError("Failed to cancel subscription.")
    } finally {
      setCancelingSubscription(false)
    }
  }

  async function handleReactivateSubscription() {
    setReactivatingSubscription(true)
    setError(null)
    try {
      const res = await fetch(API.BILLING_REACTIVATE, { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to reactivate subscription.")
        return
      }
      await fetchData()
      setSuccess("Subscription reactivated.")
    } catch {
      setError("Failed to reactivate subscription.")
    } finally {
      setReactivatingSubscription(false)
    }
  }

  // Build changes for save modal
  const buildModalChanges = (): ChangeItem[] => {
    const changes: ChangeItem[] = []
    if (pendingChanges.name !== undefined && pendingChanges.name !== (user?.name || "")) {
      changes.push({ field: "name", label: "Display Name", oldValue: user?.name || "Not set", newValue: pendingChanges.name })
    }
    if (pendingChanges.email !== undefined && pendingChanges.email !== user?.email) {
      changes.push({ field: "email", label: "Email", oldValue: user?.email || "", newValue: pendingChanges.email })
    }
    return changes
  }

  const hasPendingChanges = Object.keys(pendingChanges).length > 0 && buildModalChanges().length > 0

  // Filtered nav items
  const filteredNavItems = NAV_ITEMS.filter(item => 
    item.label.toLowerCase().includes(sidebarSearch.toLowerCase())
  )

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      {/* Toast messages */}
      {(error || success) && (
        <div className="fixed top-20 right-4 z-50 max-w-sm">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm mb-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto"><X className="h-4 w-4" /></button>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm">
              <Check className="h-4 w-4 shrink-0" />
              <span>{success}</span>
              <button onClick={() => setSuccess(null)} className="ml-auto"><X className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      )}

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex flex-col gap-1 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Account Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account, security, and preferences</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Navigation */}
          <aside className="lg:w-56 shrink-0">
            <div className="lg:sticky lg:top-24 space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  className="pl-9 h-9 bg-card"
                />
              </div>

              {/* Nav items */}
              <nav className="flex flex-col gap-1">
                {filteredNavItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleTabChange(item.id)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left",
                        isActive
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  )
                })}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Floating save bar */}
            {hasPendingChanges && (
              <div className="sticky top-20 z-40 flex items-center justify-between p-3 rounded-lg bg-card border border-border shadow-lg">
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-muted-foreground">You have unsaved changes</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => {
                    setPendingChanges({})
                    setNameInput(user?.name || "")
                    setEmailInput(user?.email || "")
                    setProfileEditMode(false)
                  }}>
                    Discard
                  </Button>
                  <Button size="sm" onClick={() => setShowSaveModal(true)}>
                    Review Changes
                  </Button>
                </div>
              </div>
            )}

            {/* ===================== GENERAL TAB ===================== */}
            {activeTab === "general" && (
              <div className="space-y-6">
                {/* Profile Card */}
                <Card>
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                      {/* Avatar */}
                      <div className="relative group">
                        <div className="relative h-20 w-20 rounded-full overflow-hidden border-2 border-border bg-muted">
                          {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center bg-primary/10">
                              <span className="text-2xl font-semibold text-primary">
                                {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?"}
                              </span>
                            </div>
                          )}
                          {uploadingAvatar && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                              <Loader2 className="h-5 w-5 animate-spin text-white" />
                            </div>
                          )}
                        </div>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAvatarFileSelect}
                        />
                        <button
                          onClick={() => avatarInputRef.current?.click()}
                          className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        >
                          <Camera className="h-5 w-5 text-white" />
                        </button>
                      </div>

                      {/* User info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-lg font-semibold truncate">{user?.name || "No name set"}</h2>
                          {user?.role && user.role !== "user" && (
                            <Badge variant="outline" className="text-xs capitalize">{user.role}</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
                        
                        {/* Badges */}
                        {user?.badges && user.badges.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-3">
                            {user.badges.map((badge) => (
                              <Badge
                                key={badge.id}
                                variant="outline"
                                className="text-xs"
                                style={{
                                  backgroundColor: badge.color ? `${badge.color}15` : undefined,
                                  borderColor: badge.color ? `${badge.color}40` : undefined,
                                  color: badge.color || undefined,
                                }}
                              >
                                {badge.icon && <span className="mr-1">{badge.icon}</span>}
                                {badge.display_name}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Avatar actions */}
                        <div className="flex items-center gap-2 mt-4">
                          <Button variant="outline" size="sm" onClick={() => avatarInputRef.current?.click()}>
                            <Camera className="mr-2 h-3.5 w-3.5" />
                            Change Photo
                          </Button>
                          {user?.avatarUrl && (
                            <Button variant="ghost" size="sm" onClick={handleRemoveAvatar}>
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Personal Details */}
                <Card>
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">Personal Details</CardTitle>
                        <CardDescription>Update your name and email address</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (profileEditMode) {
                            setNameInput(user?.name || "")
                            setEmailInput(user?.email || "")
                            setPendingChanges(prev => {
                              const next = { ...prev }
                              delete next.name
                              delete next.email
                              return next
                            })
                          }
                          setProfileEditMode(m => !m)
                        }}
                      >
                        {profileEditMode ? <><X className="mr-1.5 h-3.5 w-3.5" />Cancel</> : <><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</>}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!profileEditMode ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Display Name</Label>
                          <p className="text-sm font-medium">{user?.name || <span className="text-muted-foreground italic">Not set</span>}</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Email Address</Label>
                          <p className="text-sm font-medium">{user?.email}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">Display Name</Label>
                            {pendingChanges.name !== undefined && pendingChanges.name !== (user?.name || "") && (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">Modified</Badge>
                            )}
                          </div>
                          <Input
                            value={nameInput}
                            onChange={(e) => {
                              const val = e.target.value
                              setNameInput(val)
                              if (val !== (user?.name || "")) {
                                setPendingChanges(prev => ({ ...prev, name: val }))
                              } else {
                                setPendingChanges(prev => { const { name: _, ...rest } = prev; return rest })
                              }
                            }}
                            className="bg-card"
                            placeholder="Your display name"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">Email Address</Label>
                            {pendingChanges.email !== undefined && pendingChanges.email !== user?.email && (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">Modified</Badge>
                            )}
                          </div>
                          <Input
                            type="email"
                            value={emailInput}
                            onChange={(e) => {
                              const val = e.target.value
                              setEmailInput(val)
                              if (val !== user?.email) {
                                setPendingChanges(prev => ({ ...prev, email: val }))
                              } else {
                                setPendingChanges(prev => { const { email: _, ...rest } = prev; return rest })
                              }
                            }}
                            className="bg-card"
                            placeholder="Your email address"
                          />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Quick Links */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Quick Settings</CardTitle>
                    <CardDescription>Access commonly used settings</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        onClick={() => handleTabChange("security")}
                        className="flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-secondary/50 transition-colors text-left group"
                      >
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10">
                          <Lock className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">Security</p>
                          <p className="text-xs text-muted-foreground">Password, 2FA, sessions</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                      <button
                        onClick={() => handleTabChange("developer")}
                        className="flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-secondary/50 transition-colors text-left group"
                      >
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-violet-500/10">
                          <Code2 className="h-5 w-5 text-violet-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">Developer</p>
                          <p className="text-xs text-muted-foreground">API keys, webhooks</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ===================== SECURITY TAB ===================== */}
            {activeTab === "security" && (
              <div className="space-y-6">
                {/* Password Section */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Password</CardTitle>
                    <CardDescription>Change your account password</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!showPasswordForm ? (
                      <Button variant="outline" onClick={() => setShowPasswordForm(true)}>
                        <KeyRound className="mr-2 h-4 w-4" />
                        Change Password
                      </Button>
                    ) : (
                      <div className="space-y-4 max-w-md">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Current Password</Label>
                          <Input
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="bg-card"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">New Password</Label>
                          <Input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="bg-card"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Confirm New Password</Label>
                          <Input
                            type="password"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            className="bg-card"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button onClick={handleChangePassword} disabled={savingPassword}>
                            {savingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Save Password
                          </Button>
                          <Button variant="ghost" onClick={() => {
                            setShowPasswordForm(false)
                            setCurrentPassword("")
                            setNewPassword("")
                            setConfirmNewPassword("")
                          }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Two-Factor Authentication */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Two-Factor Authentication</CardTitle>
                    <CardDescription>Add an extra layer of security to your account</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* App-based 2FA */}
                    <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex items-center justify-center h-10 w-10 rounded-lg",
                          totpEnabled && twoFactorMethod === "app" ? "bg-emerald-500/10" : "bg-muted"
                        )}>
                          <Smartphone className={cn(
                            "h-5 w-5",
                            totpEnabled && twoFactorMethod === "app" ? "text-emerald-500" : "text-muted-foreground"
                          )} />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Authenticator App</p>
                          <p className="text-xs text-muted-foreground">Use an app like Google Authenticator</p>
                        </div>
                      </div>
                      {totpEnabled && twoFactorMethod === "app" ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                          <Check className="mr-1 h-3 w-3" />
                          Enabled
                        </Badge>
                      ) : (
                        <Button variant="outline" size="sm" onClick={handleEnable2FA} disabled={setting2FA || twoFactorMethod === "email"}>
                          {setting2FA ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enable"}
                        </Button>
                      )}
                    </div>

                    {/* Setup flow */}
                    {totpUri && (
                      <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-4">
                        <div className="flex flex-col items-center gap-4">
                          <p className="text-sm text-center text-muted-foreground">Scan this QR code with your authenticator app</p>
                          <div className="p-4 bg-white rounded-lg">
                            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`} alt="2FA QR Code" className="h-48 w-48" />
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground mb-1">Or enter this code manually:</p>
                            <code className="text-sm font-mono bg-muted px-2 py-1 rounded">{totpSecret}</code>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Enter the 6-digit code from your app</Label>
                          <div className="flex gap-2">
                            <Input
                              value={totpVerifyCode}
                              onChange={(e) => setTotpVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              placeholder="000000"
                              className="bg-card font-mono text-center max-w-32"
                              maxLength={6}
                            />
                            <Button onClick={handleVerify2FA} disabled={setting2FA || totpVerifyCode.length !== 6}>
                              {setting2FA ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Backup codes display */}
                    {backupCodes.length > 0 && (
                      <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Save your backup codes</p>
                        </div>
                        <p className="text-xs text-muted-foreground">Store these codes in a safe place. You can use them to access your account if you lose your authenticator device.</p>
                        <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                          {backupCodes.map((code, i) => (
                            <div key={i} className="px-3 py-2 bg-muted rounded text-center">{code}</div>
                          ))}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => {
                          navigator.clipboard.writeText(backupCodes.join("\n"))
                          setSuccess("Backup codes copied to clipboard.")
                        }}>
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Copy All
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setBackupCodes([])}>
                          Done
                        </Button>
                      </div>
                    )}

                    {/* Email 2FA */}
                    <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex items-center justify-center h-10 w-10 rounded-lg",
                          twoFactorMethod === "email" ? "bg-emerald-500/10" : "bg-muted"
                        )}>
                          <Mail className={cn(
                            "h-5 w-5",
                            twoFactorMethod === "email" ? "text-emerald-500" : "text-muted-foreground"
                          )} />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Email Verification</p>
                          <p className="text-xs text-muted-foreground">Receive a code via email on login</p>
                        </div>
                      </div>
                      {twoFactorMethod === "email" ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                          <Check className="mr-1 h-3 w-3" />
                          Enabled
                        </Badge>
                      ) : (
                        <Button variant="outline" size="sm" disabled={totpEnabled}>
                          {totpEnabled ? "Disabled (App 2FA active)" : "Enable"}
                        </Button>
                      )}
                    </div>

                    {/* Disable 2FA / Manage options */}
                    {(totpEnabled || twoFactorMethod === "email") && (
                      <div className="pt-4 border-t border-border">
                        <div className="flex flex-wrap gap-2">
                          {totpEnabled && twoFactorMethod === "app" && (
                            <>
                              <Button variant="outline" size="sm" onClick={() => setShowRegenerateBackup(true)}>
                                Regenerate Backup Codes
                                {backupCodesRemaining > 0 && (
                                  <Badge variant="secondary" className="ml-2 text-[10px]">{backupCodesRemaining} left</Badge>
                                )}
                              </Button>
                              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDisable2FA(true)}>
                                Disable 2FA
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Disable 2FA dialog */}
                    {showDisable2FA && (
                      <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5 space-y-3">
                        <p className="text-sm font-medium text-destructive">Disable Two-Factor Authentication</p>
                        <p className="text-xs text-muted-foreground">Enter your password to disable 2FA. This will make your account less secure.</p>
                        <div className="flex gap-2">
                          <Input
                            type="password"
                            value={disablePassword}
                            onChange={(e) => setDisablePassword(e.target.value)}
                            placeholder="Your password"
                            className="bg-card max-w-xs"
                          />
                          <Button variant="destructive" size="sm" onClick={handleDisable2FA} disabled={setting2FA}>
                            {setting2FA ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disable"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setShowDisable2FA(false); setDisablePassword("") }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Regenerate backup codes dialog */}
                    {showRegenerateBackup && (
                      <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
                        <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Regenerate Backup Codes</p>
                        <p className="text-xs text-muted-foreground">This will invalidate all existing backup codes and generate new ones.</p>
                        <div className="flex gap-2">
                          <Input
                            type="password"
                            value={regenPassword}
                            onChange={(e) => setRegenPassword(e.target.value)}
                            placeholder="Your password"
                            className="bg-card max-w-xs"
                          />
                          <Button variant="outline" size="sm" onClick={handleRegenerateBackupCodes} disabled={setting2FA}>
                            {setting2FA ? <Loader2 className="h-4 w-4 animate-spin" /> : "Regenerate"}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setShowRegenerateBackup(false); setRegenPassword("") }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Active Sessions */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Active Sessions</CardTitle>
                    <CardDescription>Manage your logged-in devices</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" onClick={handleForceLogout} disabled={forceLoggingOut}>
                      {forceLoggingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
                      Log Out Other Sessions
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">This will sign out all other devices except your current session.</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ===================== SOCIAL TAB ===================== */}
            {activeTab === "social" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <svg className="h-5 w-5 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                          </svg>
                          Discord
                        </CardTitle>
                        <CardDescription>Connect your Discord account for quick sign-in</CardDescription>
                      </div>
                      {user?.discordId && (
                        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">Connected</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {user?.discordId ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-4 p-4 rounded-lg bg-[#5865F2]/5 border border-[#5865F2]/20">
                          {user.discordAvatar ? (
                            <img
                              src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.discordAvatar}.png?size=128`}
                              alt="Discord avatar"
                              className="h-12 w-12 rounded-full"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-full bg-[#5865F2] flex items-center justify-center">
                              <span className="text-white font-semibold">{user.discordUsername?.[0]?.toUpperCase() || "?"}</span>
                            </div>
                          )}
                          <div>
                            <p className="font-medium">{user.discordUsername || "Unknown User"}</p>
                            <p className="text-xs text-muted-foreground font-mono">ID: {user.discordId}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => window.location.href = "/api/v2/auth/discord?action=connect"}>
                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                            Reconnect
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={async () => {
                              try {
                                const res = await fetch("/api/v2/account/discord", { method: "DELETE" })
                                if (res.ok) {
                                  setSuccess("Discord account disconnected")
                                  await fetchData()
                                } else {
                                  setError("Failed to disconnect Discord account")
                                }
                              } catch {
                                setError("Failed to disconnect Discord account")
                              }
                            }}
                          >
                            <Unlink className="mr-2 h-3.5 w-3.5" />
                            Disconnect
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex flex-col items-center gap-4 p-6 rounded-lg border border-dashed border-border">
                          <div className="h-16 w-16 rounded-full bg-[#5865F2]/10 flex items-center justify-center">
                            <svg className="h-8 w-8 text-[#5865F2]/60" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                            </svg>
                          </div>
                          <div className="text-center">
                            <p className="font-medium">No Discord account connected</p>
                            <p className="text-sm text-muted-foreground mt-1">Link your Discord for faster sign-in</p>
                          </div>
                        </div>
                        <Button className="w-full bg-[#5865F2] hover:bg-[#4752C4] text-white" onClick={() => window.location.href = "/api/v2/auth/discord?action=connect"}>
                          Connect Discord
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Community Links */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Community</CardTitle>
                    <CardDescription>Join our community and stay connected</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <a
                      href="https://discord.gg/Y7R6hdGbNe"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-[#5865F2]/10">
                        <svg className="h-5 w-5 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">Discord Server</p>
                        <p className="text-xs text-muted-foreground">Join our community</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </a>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ===================== BILLING TAB ===================== */}
            {activeTab === "billing" && (
              <div className="space-y-6">
                {/* Usage */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Daily Usage</CardTitle>
                    <CardDescription>Track your scan requests. Limits reset at midnight UTC.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {billingInfo ? (
                      billingInfo.usage.unlimited ? (
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <Zap className="h-5 w-5 text-emerald-500" />
                          <div>
                            <p className="font-medium">Unlimited Access</p>
                            <p className="text-sm text-muted-foreground">You have unlimited scans with your plan.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-2xl font-bold tabular-nums">
                                {billingInfo.usage.used} <span className="text-muted-foreground text-base font-normal">/ {billingInfo.usage.limit}</span>
                              </p>
                              <p className="text-sm text-muted-foreground">scans used today</p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-semibold tabular-nums">{billingInfo.usage.remaining}</p>
                              <p className="text-sm text-muted-foreground">remaining</p>
                            </div>
                          </div>
                          <Progress value={(billingInfo.usage.used / billingInfo.usage.limit) * 100} className="h-2" />
                          {billingInfo.usage.remaining === 0 && (
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                              <p className="text-sm text-destructive">Daily limit reached. Upgrade or wait for reset.</p>
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Plan */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Subscription Plan</CardTitle>
                    <CardDescription>Manage your subscription and billing</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {billingInfo ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "flex items-center justify-center h-10 w-10 rounded-lg",
                              billingInfo.plan === "free" ? "bg-muted" : "bg-primary/10"
                            )}>
                              {billingInfo.plan === "free" ? (
                                <Users className="h-5 w-5 text-muted-foreground" />
                              ) : (
                                <Zap className="h-5 w-5 text-primary" />
                              )}
                            </div>
                            <div>
                              <p className="font-semibold">
                                {billingInfo.plan === "free" ? "Free Plan" : billingInfo.plan.replace("_supporter", " Supporter").replace(/(^\w|\s\w)/g, (m: string) => m.toUpperCase())}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {billingInfo.plan === "free" ? `${billingInfo.limits.free} scans/day` : `${billingInfo.limits[billingInfo.plan as keyof typeof billingInfo.limits]} scans/day`}
                              </p>
                            </div>
                          </div>
                          {billingInfo.plan === "free" && (
                            <Button asChild size="sm">
                              <a href={ROUTES.PRICING}>Upgrade</a>
                            </Button>
                          )}
                        </div>

                        {billingInfo.giftedSubscription && (
                          <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
                            <div className="flex items-center gap-2">
                              <Gift className="h-4 w-4 text-primary" />
                              <span className="text-sm font-medium text-primary">Gifted Subscription</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Valid until {new Date(billingInfo.giftedSubscription.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                        )}

                        {billingInfo.subscription && !billingInfo.giftedSubscription && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Status</span>
                              <Badge className={cn(
                                billingInfo.subscription.cancelAtPeriodEnd
                                  ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                  : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              )}>
                                {billingInfo.subscription.cancelAtPeriodEnd ? "Canceling" : "Active"}
                              </Badge>
                            </div>
                            {billingInfo.subscription.cancelAtPeriodEnd ? (
                              <Button variant="outline" onClick={handleReactivateSubscription} disabled={reactivatingSubscription} className="w-full">
                                {reactivatingSubscription ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                Reactivate Subscription
                              </Button>
                            ) : (
                              <Button variant="outline" onClick={() => setShowCancelDialog(true)} className="w-full text-destructive hover:text-destructive">
                                Cancel Subscription
                              </Button>
                            )}
                          </div>
                        )}

                        {billingInfo.plan === "free" && (
                          <div className="pt-4 border-t border-border">
                            <p className="text-sm font-medium text-muted-foreground mb-3">Available Plans</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
                                <p className="font-medium text-sm">Core</p>
                                <p className="text-xs text-muted-foreground">{billingInfo.limits.core_supporter} scans/day</p>
                                <p className="text-sm font-semibold text-primary mt-1">$5/mo</p>
                              </div>
                              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 relative">
                                <Badge className="absolute -top-2 right-2 text-[10px]">Popular</Badge>
                                <p className="font-medium text-sm">Pro</p>
                                <p className="text-xs text-muted-foreground">{billingInfo.limits.pro_supporter} scans/day</p>
                                <p className="text-sm font-semibold text-primary mt-1">$10/mo</p>
                              </div>
                              <div className="p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
                                <p className="font-medium text-sm">Elite</p>
                                <p className="text-xs text-muted-foreground">{billingInfo.limits.elite_supporter} scans/day</p>
                                <p className="text-sm font-semibold text-primary mt-1">$20/mo</p>
                              </div>
                            </div>
                            <Button asChild className="w-full mt-4">
                              <a href={ROUTES.PRICING}>
                                <TrendingUp className="mr-2 h-4 w-4" />
                                View All Plans
                              </a>
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Cancel Dialog */}
                {showCancelDialog && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCancelDialog(false)}>
                    <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6 mx-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                          <XCircle className="h-5 w-5 text-destructive" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold">Cancel Subscription</h3>
                          <p className="text-sm text-muted-foreground">Choose how to cancel</p>
                        </div>
                      </div>
                      <div className="space-y-3 mb-6">
                        <label className={cn(
                          "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                          cancelType === "period_end" ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
                        )}>
                          <input type="radio" name="cancelType" checked={cancelType === "period_end"} onChange={() => setCancelType("period_end")} className="mt-1" />
                          <div>
                            <p className="font-medium text-sm">Cancel at period end</p>
                            <p className="text-xs text-muted-foreground">Keep access until your billing period ends</p>
                          </div>
                        </label>
                        <label className={cn(
                          "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                          cancelType === "immediate" ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
                        )}>
                          <input type="radio" name="cancelType" checked={cancelType === "immediate"} onChange={() => setCancelType("immediate")} className="mt-1" />
                          <div>
                            <p className="font-medium text-sm">Cancel immediately</p>
                            <p className="text-xs text-muted-foreground">Lose access right away</p>
                          </div>
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" className="flex-1" onClick={() => setShowCancelDialog(false)}>
                          Keep Subscription
                        </Button>
                        <Button variant="destructive" className="flex-1" onClick={handleCancelSubscription} disabled={cancelingSubscription}>
                          {cancelingSubscription ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===================== DEVELOPER TAB ===================== */}
            {activeTab === "developer" && (
              <div className="space-y-6">
                {/* API Keys */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">API Keys</CardTitle>
                    <CardDescription>Generate keys to access the {APP_NAME} API</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Create new key */}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Key name (optional)"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        className="bg-card max-w-xs"
                      />
                      <Button onClick={handleGenerateKey} disabled={generatingKey}>
                        {generatingKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        Generate Key
                      </Button>
                    </div>

                    {/* Newly created key */}
                    {newlyCreatedKey && (
                      <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 space-y-3">
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-emerald-500" />
                          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">API Key Generated</p>
                        </div>
                        <p className="text-xs text-muted-foreground">Copy this key now. You won&apos;t be able to see it again.</p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 px-3 py-2 bg-muted rounded font-mono text-sm truncate">
                            {showKey ? newlyCreatedKey : "•".repeat(40)}
                          </code>
                          <Button variant="ghost" size="icon" onClick={() => setShowKey(!showKey)}>
                            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={handleCopyKey}>
                            {copiedKey ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setNewlyCreatedKey(null)}>
                          Done
                        </Button>
                      </div>
                    )}

                    {/* Keys list */}
                    {keys.length > 0 ? (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <div className="divide-y divide-border">
                          {keys.filter(k => !k.revoked_at).map((key) => (
                            <div key={key.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-muted">
                                  <Key className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{key.name}</p>
                                  <p className="text-xs text-muted-foreground font-mono">{key.key_prefix}...</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right text-xs text-muted-foreground hidden sm:block">
                                  <p>{key.usage_today} / {key.daily_limit} today</p>
                                  <p>{key.last_used_at ? `Used ${new Date(key.last_used_at).toLocaleDateString()}` : "Never used"}</p>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => handleRevokeKey(key.id)} disabled={revokingId === key.id}>
                                  {revokingId === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No API keys yet. Generate one to get started.</p>
                    )}
                  </CardContent>
                </Card>

                {/* Webhooks */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Webhooks</CardTitle>
                    <CardDescription>Receive notifications when scans complete</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Webhook URL"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        className="bg-card flex-1"
                      />
                      <Input
                        placeholder="Name (optional)"
                        value={webhookName}
                        onChange={(e) => setWebhookName(e.target.value)}
                        className="bg-card max-w-32"
                      />
                      <Button onClick={handleAddWebhook} disabled={addingWebhook}>
                        {addingWebhook ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      </Button>
                    </div>

                    {webhooks.length > 0 ? (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <div className="divide-y divide-border">
                          {webhooks.map((wh) => (
                            <div key={wh.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-muted">
                                  <Webhook className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{wh.name}</p>
                                  <p className="text-xs text-muted-foreground truncate">{wh.url}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => handleTestWebhook(wh.id)} disabled={testingWebhookId === wh.id}>
                                  {testingWebhookId === wh.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteWebhook(wh.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No webhooks configured.</p>
                    )}
                  </CardContent>
                </Card>

                {/* Scheduled Scans */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Scheduled Scans</CardTitle>
                    <CardDescription>Automatically scan URLs on a schedule</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="URL to scan"
                        value={scheduleUrl}
                        onChange={(e) => setScheduleUrl(e.target.value)}
                        className="bg-card flex-1"
                      />
                      <select
                        value={scheduleFreq}
                        onChange={(e) => setScheduleFreq(e.target.value)}
                        className="h-10 px-3 rounded-md border border-border bg-card text-sm"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                      <Button onClick={handleAddSchedule} disabled={addingSchedule}>
                        {addingSchedule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      </Button>
                    </div>

                    {schedules.length > 0 ? (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <div className="divide-y divide-border">
                          {schedules.map((sch) => (
                            <div key={sch.id} className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-muted">
                                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{sch.url}</p>
                                  <p className="text-xs text-muted-foreground capitalize">{sch.frequency}</p>
                                </div>
                              </div>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteSchedule(sch.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No scheduled scans.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ===================== NOTIFICATIONS TAB ===================== */}
            {activeTab === "notifications" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Email Notifications</CardTitle>
                    <CardDescription>Choose which emails you want to receive</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Security */}
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-muted-foreground">Security</p>
                      <div className="space-y-2">
                        {[
                          { key: "email_new_login" as const, label: "New login alerts" },
                          { key: "email_password_change" as const, label: "Password changes" },
                          { key: "email_2fa_change" as const, label: "2FA changes" },
                          { key: "email_session_revoked" as const, label: "Session revocations" },
                        ].map((item) => (
                          <div key={item.key} className="flex items-center justify-between py-2">
                            <span className="text-sm">{item.label}</span>
                            <Switch checked={notifPrefs[item.key]} onCheckedChange={(val) => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Scanning */}
                    <div className="space-y-3 pt-4 border-t border-border">
                      <p className="text-sm font-medium text-muted-foreground">Scanning</p>
                      <div className="space-y-2">
                        {[
                          { key: "email_scan_complete" as const, label: "Scan completions" },
                          { key: "email_critical_findings" as const, label: "Critical findings" },
                          { key: "email_regression_alert" as const, label: "Regression alerts" },
                          { key: "email_schedules" as const, label: "Scheduled scan updates" },
                        ].map((item) => (
                          <div key={item.key} className="flex items-center justify-between py-2">
                            <span className="text-sm">{item.label}</span>
                            <Switch checked={notifPrefs[item.key]} onCheckedChange={(val) => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Developer */}
                    <div className="space-y-3 pt-4 border-t border-border">
                      <p className="text-sm font-medium text-muted-foreground">Developer</p>
                      <div className="space-y-2">
                        {[
                          { key: "email_api_keys" as const, label: "API key changes" },
                          { key: "email_api_limit_warning" as const, label: "API limit warnings" },
                          { key: "email_webhooks" as const, label: "Webhook updates" },
                          { key: "email_webhook_failure" as const, label: "Webhook failures" },
                        ].map((item) => (
                          <div key={item.key} className="flex items-center justify-between py-2">
                            <span className="text-sm">{item.label}</span>
                            <Switch checked={notifPrefs[item.key]} onCheckedChange={(val) => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Teams */}
                    <div className="space-y-3 pt-4 border-t border-border">
                      <p className="text-sm font-medium text-muted-foreground">Teams</p>
                      <div className="space-y-2">
                        {[
                          { key: "email_team_invite" as const, label: "Team invitations" },
                          { key: "email_team_changes" as const, label: "Team changes" },
                        ].map((item) => (
                          <div key={item.key} className="flex items-center justify-between py-2">
                            <span className="text-sm">{item.label}</span>
                            <Switch checked={notifPrefs[item.key]} onCheckedChange={(val) => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Marketing */}
                    <div className="space-y-3 pt-4 border-t border-border">
                      <p className="text-sm font-medium text-muted-foreground">Marketing</p>
                      <div className="space-y-2">
                        {[
                          { key: "email_product_updates" as const, label: "Product updates" },
                          { key: "email_tips_guides" as const, label: "Tips and guides" },
                        ].map((item) => (
                          <div key={item.key} className="flex items-center justify-between py-2">
                            <span className="text-sm">{item.label}</span>
                            <Switch checked={notifPrefs[item.key]} onCheckedChange={(val) => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))} />
                          </div>
                        ))}
                      </div>
                    </div>

                    <Button onClick={handleSaveNotifPrefs} disabled={savingNotifPrefs} className="mt-4">
                      {savingNotifPrefs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save Preferences
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ===================== PRIVACY TAB ===================== */}
            {activeTab === "privacy" && (
              <div className="space-y-6">
                {/* Data Export */}
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Export Your Data</CardTitle>
                    <CardDescription>Download a copy of all your data</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {dataReqInfo?.canDownloadNew ? (
                      <Button variant="outline" onClick={handleRequestData} disabled={requestingData}>
                        {requestingData ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        Request Data Export
                      </Button>
                    ) : dataReqInfo?.cooldownEndsAt ? (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          You can request another export on {new Date(dataReqInfo.cooldownEndsAt).toLocaleDateString()}
                        </p>
                      </div>
                    ) : (
                      <Button variant="outline" onClick={handleRequestData} disabled={requestingData}>
                        {requestingData ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        Request Data Export
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">We&apos;ll email you when your data is ready to download.</p>
                  </CardContent>
                </Card>

                {/* Delete Account */}
                <Card className="border-destructive/20">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base text-destructive">Delete Account</CardTitle>
                    <CardDescription>Permanently delete your account and all data</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!showDeleteConfirm ? (
                      <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete My Account
                      </Button>
                    ) : (
                      <div className="space-y-4 max-w-md">
                        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                          <p className="text-sm text-destructive font-medium">This action cannot be undone.</p>
                          <p className="text-xs text-muted-foreground mt-1">All your data including scans, API keys, and settings will be permanently deleted.</p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Type DELETE to confirm</Label>
                          <Input
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder="DELETE"
                            className="bg-card"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleting || deleteConfirmText !== "DELETE"}>
                            {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Delete Account
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
          </div>
        </div>
      </main>

      <Footer />

      {/* Image Crop Dialog */}
      <ImageCropDialog
        open={cropDialogOpen}
        imageSrc={cropImageSrc || ""}
        onClose={() => { setCropDialogOpen(false); setCropImageSrc(null) }}
        onCropComplete={handleCroppedAvatar}
        loading={uploadingAvatar}
      />

      {/* Save Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async () => {
          if (pendingChanges.name !== undefined && pendingChanges.name !== (user?.name || "")) {
            await handleSaveName()
          }
          if (pendingChanges.email !== undefined && pendingChanges.email !== user?.email) {
            await handleSaveEmail()
          }
          setPendingChanges({})
          setProfileEditMode(false)
        }}
        title="Confirm Changes"
        description="Review the changes you're about to make to your account."
        changes={buildModalChanges()}
        loading={savingProfile}
        confirmText="Save Changes"
      />
    </div>
  )
}
