// Profile types and interfaces

export type ProfileTab = "general" | "security" | "social" | "billing" | "developer" | "notifications" | "privacy"

export interface UserProfile {
  userId: string
  email: string
  name: string
  avatar: string | null
  bio: string
  website: string
  twitter: string
  github: string
  linkedin: string
  createdAt: string
  updatedAt: string
  emailVerified: boolean
  twoFactorEnabled: boolean
  role: string
  scanCount: number
  plan: string
  planExpiresAt: string | null
}

export interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed: string | null
  createdAt: string
  expiresAt: string | null
  scopes: string[]
}

export interface Webhook {
  id: string
  url: string
  events: string[]
  enabled: boolean
  secret: string
  createdAt: string
  lastTriggered: string | null
  failureCount: number
}

export interface Session {
  id: string
  device: string
  browser: string
  ip: string
  location: string
  lastActive: string
  current: boolean
}

export interface NotificationSettings {
  emailScanComplete: boolean
  emailSecurityAlerts: boolean
  emailWeeklyDigest: boolean
  emailProductUpdates: boolean
  pushEnabled: boolean
  slackEnabled: boolean
  slackWebhook: string
}

export interface PrivacySettings {
  profilePublic: boolean
  showEmail: boolean
  showSocialLinks: boolean
  allowDataCollection: boolean
  shareAnonymousData: boolean
}

export interface BillingInfo {
  plan: string
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  paymentMethod: {
    brand: string
    last4: string
    expMonth: number
    expYear: number
  } | null
  invoices: {
    id: string
    date: string
    amount: number
    status: string
    pdfUrl: string
  }[]
}

// Tab configuration
export const PROFILE_TABS: { id: ProfileTab; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "User" },
  { id: "security", label: "Security", icon: "Shield" },
  { id: "social", label: "Social", icon: "Share2" },
  { id: "billing", label: "Billing", icon: "CreditCard" },
  { id: "developer", label: "Developer", icon: "Code" },
  { id: "notifications", label: "Notifications", icon: "Bell" },
  { id: "privacy", label: "Privacy", icon: "Lock" },
]

// Helper functions
export function formatDate(date: string | null): string {
  if (!date) return "Never"
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function formatDateTime(date: string | null): string {
  if (!date) return "Never"
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function getRelativeTime(date: string | null): string {
  if (!date) return "Never"
  const now = new Date()
  const d = new Date(date)
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatDate(date)
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return key
  return `${key.slice(0, 4)}${"•".repeat(24)}${key.slice(-4)}`
}
