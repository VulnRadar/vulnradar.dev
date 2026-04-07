// Profile page type definitions

export interface UserBadge {
  id: number
  name: string
  display_name: string
  description: string | null
  icon: string | null
  color: string | null
  priority: number
  awarded_at: string
}

export interface ProfileUser {
  userId: number
  email: string
  name: string | null
  totpEnabled?: boolean
  twoFactorMethod?: string | null
  avatarUrl?: string | null
  role?: string
  badges?: UserBadge[]
}

export interface ApiKey {
  id: number
  key_prefix: string
  name: string
  daily_limit: number
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  usage_today: number
}

export interface DataRequestInfo {
  hasData: boolean
  canDownloadNew: boolean
  cooldownEndsAt?: string
  lastDownloadAt?: string
}

export interface BillingInfo {
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
    // Price info
    priceAmount: number | null
    priceCurrency: string | null
    priceInterval: string | null
    priceIntervalCount: number | null
    // Payment method info
    cardBrand: string | null
    cardLast4: string | null
    cardExpMonth: number | null
    cardExpYear: number | null
    // Invoice info
    lastPaymentAmount: number | null
    lastPaymentStatus: string | null
    lastPaymentDate: string | null
    // Next billing
    nextBillingDate: string | null
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

export interface WebhookItem {
  id: number
  url: string
  name: string
  type: string
  active: boolean
  created_at: string
}

export interface ScheduleItem {
  id: number
  url: string
  frequency: string
  created_at: string
  last_run: string | null
  next_run: string | null
}

export interface NotificationPrefs {
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
}

export type ProfileTab = "general" | "security" | "social" | "billing" | "developer" | "notifications" | "privacy"

export interface PendingChanges {
  name?: string
  email?: string
  notifications?: Partial<NotificationPrefs>
}

// Common props for all profile tab components
export interface ProfileTabProps {
  user: ProfileUser | null
  loading: boolean
  error: string | null
  success: string | null
  setError: (error: string | null) => void
  setSuccess: (success: string | null) => void
  onTabChange: (tab: ProfileTab) => void
  pendingChanges: PendingChanges
  setPendingChanges: React.Dispatch<React.SetStateAction<PendingChanges>>
  discardKey?: number // Incremented when discard is clicked to trigger child component resets
  saveKey?: number // Incremented after successful save to update original values in child components
  // Pre-loaded data from parent to avoid loading delays
  preloadedApiKeys?: ApiKey[]
  preloadedWebhooks?: WebhookItem[]
  preloadedSchedules?: ScheduleItem[]
  preloadedNotifPrefs?: NotificationPrefs | null
  preloadedBillingInfo?: BillingInfo | null
  preloadedDataReqInfo?: DataRequestInfo | null
  setApiKeys?: React.Dispatch<React.SetStateAction<ApiKey[]>>
  setWebhooks?: React.Dispatch<React.SetStateAction<WebhookItem[]>>
  setSchedules?: React.Dispatch<React.SetStateAction<ScheduleItem[]>>
  setNotifPrefs?: React.Dispatch<React.SetStateAction<NotificationPrefs | null>>
  setBillingInfo?: React.Dispatch<React.SetStateAction<BillingInfo | null>>
  setDataReqInfo?: React.Dispatch<React.SetStateAction<DataRequestInfo | null>>
}
