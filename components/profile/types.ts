// Profile page type definitions

export interface UserBadge {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  priority: number;
  is_limited: boolean;
  awarded_at: string;
}

export interface ProfileUser {
  userId: number;
  email: string;
  name: string | null;
  totpEnabled?: boolean;
  twoFactorMethod?: string | null;
  avatarUrl?: string | null;
  role?: string;
  badges?: UserBadge[];
  discordId?: string | null;
  discordUsername?: string | null;
  discordAvatar?: string | null;
  /** False only for an OAuth-only account that never set a password. */
  hasPassword?: boolean;
  googleId?: string | null;
  googleEmail?: string | null;
  googleName?: string | null;
  googleAvatarUrl?: string | null;
  githubId?: string | null;
  githubEmail?: string | null;
  githubName?: string | null;
  githubAvatarUrl?: string | null;
}

export interface ApiKey {
  id: number;
  key_prefix: string;
  name: string;
  daily_limit: number;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  usage_today: number;
  /** null for a key created before scoping existed -- treat as full access
   * (see resolveApiKeyScopes in lib/config/client-constants.ts). */
  scopes?: string[] | null;
}

export interface DataRequestInfo {
  hasData: boolean;
  canDownloadNew: boolean;
  cooldownEndsAt?: string;
  lastDownloadAt?: string;
}

export interface BillingInfo {
  billingEnabled: boolean;
  plan: string;
  planName: string | null;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  subscription: {
    id: string;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    // Price info
    priceAmount: number | null;
    priceCurrency: string | null;
    priceInterval: string | null;
    priceIntervalCount: number | null;
    // Payment method info
    cardBrand: string | null;
    cardLast4: string | null;
    cardExpMonth: number | null;
    cardExpYear: number | null;
    // Invoice info
    lastPaymentAmount: number | null;
    lastPaymentStatus: string | null;
    lastPaymentDate: string | null;
    // Next billing
    nextBillingDate: string | null;
  } | null;
  giftedSubscription: {
    plan: string;
    expiresAt: string;
    startedAt: string;
  } | null;
  usage: {
    used: number;
    limit: number;
    remaining: number;
    resetsAt: string;
    unlimited: boolean;
  };
  limits: {
    free: number;
    core_supporter: number;
    pro_supporter: number;
    elite_supporter: number;
  };
  /**
   * AI finding verification only -- chat and AI scan summaries are
   * free/unmetered on every plan, so they have no quota to show here. See
   * lib/billing/ai-usage.ts's checkAiUsageQuota, the same source
   * components/pricing/pricing-features.tsx's "AI finding verification"
   * row reads.
   */
  aiUsage: {
    used: number;
    /** -1 means unlimited (billing disabled or the user's own AI key -- a staff caller now resolves to the Pro Supporter cap, not -1). */
    limit: number;
    resetsAt: string;
    windowHours: number;
    unlimited: boolean;
    usingOwnAi: boolean;
    /** Purchased AI verification token balance (lib/billing/ai-usage.ts's
     *  ai_credit_balance column) -- never reset by the window above, spent
     *  only as a fallback once the free per-window allowance is exhausted. */
    creditBalance: number;
  };
  /**
   * GitHub repo AI code review only. Resets on the exact same fixed
   * window as aiUsage above (see lib/billing/github-review-usage.ts's
   * checkGithubReviewQuota, which imports its window resolution directly
   * from lib/billing/ai-usage.ts), through its own separate cap sized for
   * a whole-repo call instead of one chat/verify/summary call.
   */
  githubReviewUsage: {
    used: number;
    /** -1 means unlimited (billing disabled or the user's own AI key -- a staff caller now resolves to the Pro Supporter cap, not -1). 0 means the plan doesn't include the feature at all (see the free-plan daily trial in lib/billing/github-review-usage.ts). */
    limit: number;
    resetsAt: string;
    windowHours: number;
    unlimited: boolean;
    usingOwnAi: boolean;
    /** Purchased GitHub review token balance (lib/billing/github-review-usage.ts's
     *  github_credit_balance column) -- never reset by the window above, spent
     *  only as a fallback once the free per-window allowance is exhausted.
     *  Never a fallback for the hidden 0-limit free-trial state. */
    creditBalance: number;
  };
}

export interface WebhookItem {
  id: number;
  url: string;
  name: string;
  type: string;
  active: boolean;
  created_at: string;
}

export interface ScheduleItem {
  id: number;
  url: string;
  frequency: string;
  active: boolean;
  created_at: string;
  last_run: string | null;
  next_run: string | null;
  /** UTC hour (0-23) the schedule prefers to run at. */
  preferred_hour_utc?: number;
  /** UTC day of week (0-6, Sunday=0). Only meaningful for a weekly schedule. */
  preferred_day_of_week?: number;
  /** UTC day of month (1-28). Only meaningful for a monthly schedule. */
  preferred_day_of_month?: number;
}

export interface NotificationPrefs {
  email_security: boolean;
  email_new_login: boolean;
  email_password_change: boolean;
  email_2fa_change: boolean;
  email_session_revoked: boolean;
  email_scan_complete: boolean;
  email_critical_findings: boolean;
  email_regression_alert: boolean;
  email_schedules: boolean;
  email_api_keys: boolean;
  email_api_limit_warning: boolean;
  email_webhooks: boolean;
  email_webhook_failure: boolean;
  email_data_requests: boolean;
  email_account_deletion: boolean;
  email_team_invite: boolean;
  email_team_changes: boolean;
}

export type ProfileTab =
  | "general"
  | "security"
  | "social"
  | "billing"
  | "developer"
  | "notifications"
  | "privacy"
  | "ai";

export interface PendingChanges {
  name?: string;
  email?: string;
  notifications?: Partial<NotificationPrefs>;
  /** Pending edit to the account-level "scans are private by default"
   *  setting (Privacy tab). See PUT /api/v3/account/privacy. */
  scansPrivateByDefault?: boolean;
  /** Pending edit to the account-level "list new shares in Public Scans by
   *  default" setting (Privacy tab). See PUT /api/v3/account/share-privacy. */
  sharePubliclyListedByDefault?: boolean;
}

// Common props for all profile tab components
export interface ProfileTabProps {
  user: ProfileUser | null;
  loading: boolean;
  error: string | null;
  success: string | null;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  onTabChange: (tab: ProfileTab) => void;
  pendingChanges: PendingChanges;
  setPendingChanges: React.Dispatch<React.SetStateAction<PendingChanges>>;
  discardKey?: number; // Incremented when discard is clicked to trigger child component resets
  saveKey?: number; // Incremented after successful save to update original values in child components
  // Pre-loaded data from parent to avoid loading delays
  preloadedApiKeys?: ApiKey[];
  preloadedWebhooks?: WebhookItem[];
  preloadedSchedules?: ScheduleItem[];
  preloadedNotifPrefs?: NotificationPrefs | null;
  preloadedBillingInfo?: BillingInfo | null;
  preloadedDataReqInfo?: DataRequestInfo | null;
  /** Account-level "scans are private by default" setting (Privacy tab). */
  preloadedScansPrivateByDefault?: boolean | null;
  /** Account-level "list new shares in Public Scans by default" setting
   *  (Privacy tab). See PUT /api/v3/account/share-privacy. */
  preloadedSharePubliclyListedByDefault?: boolean | null;
  setApiKeys?: React.Dispatch<React.SetStateAction<ApiKey[]>>;
  setWebhooks?: React.Dispatch<React.SetStateAction<WebhookItem[]>>;
  setSchedules?: React.Dispatch<React.SetStateAction<ScheduleItem[]>>;
  setNotifPrefs?: React.Dispatch<
    React.SetStateAction<NotificationPrefs | null>
  >;
  setBillingInfo?: React.Dispatch<React.SetStateAction<BillingInfo | null>>;
  setDataReqInfo?: React.Dispatch<React.SetStateAction<DataRequestInfo | null>>;
}
