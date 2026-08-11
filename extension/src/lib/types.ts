// Shared types for the VulnRadar browser extension.
// Kept minimal — only the fields the popup/options actually need.
// All field names mirror the API's JSON shape verbatim so JSON.parse
// drops in cleanly without remapping.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const ALL_SEVERITIES: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const SEVERITY_HEX: Record<Severity, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
  info: "#6b7280",
};

export type ScannerCategory =
  | "headers"
  | "ssl"
  | "tls"
  | "content"
  | "cookies"
  | "configuration"
  | "information-disclosure"
  | "dns"
  | "email"
  | "api"
  | "code"
  | "secrets-extended"
  | "vibe-code"
  | "client-side"
  | "supply-chain"
  | "host-validation";

export const ALL_CATEGORIES: readonly ScannerCategory[] = [
  "headers",
  "ssl",
  "tls",
  "content",
  "cookies",
  "configuration",
  "information-disclosure",
  "dns",
  "email",
  "api",
  "code",
  "secrets-extended",
  "vibe-code",
  "client-side",
  "supply-chain",
  "host-validation",
] as const;

export type AiVerdict = "confirmed" | "possible_fp" | "uncertain";

export interface CodeExample {
  readonly label: string;
  readonly language: string;
  readonly code: string;
}

export interface Vulnerability {
  readonly id: string;
  readonly title: string;
  readonly severity: Severity;
  readonly category: ScannerCategory;
  readonly description: string;
  readonly evidence: string;
  readonly riskImpact?: string;
  readonly explanation?: string;
  readonly fixSteps?: readonly string[];
  readonly codeExamples?: readonly CodeExample[];
  readonly references?: readonly string[];
  readonly confidence?: number;
  readonly detectionMethod?: string;
  readonly aiVerdict?: AiVerdict;
  readonly aiConfidence?: number;
  readonly aiReason?: string;
}

export interface ScanSummary {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly info: number;
  readonly total: number;
}

export interface ScanRequest {
  readonly url: string;
  readonly scanners?: readonly ScannerCategory[];
  readonly probes?: readonly string[];
}

export interface ScanResult {
  readonly url: string;
  readonly scannedAt: string;
  readonly duration: number;
  readonly findings: readonly Vulnerability[];
  readonly summary: ScanSummary;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly dangerScore?: number;
  readonly engineConfidence?: number;
  readonly scanHistoryId?: number;
  readonly notes?: string;
}

/**
 * POST /api/v3/scan/crawl never returns a finished ScanResult directly --
 * a crawl can take minutes (many pages), so the server kicks off the work
 * and responds immediately with just an id to poll. GET
 * /api/v3/scan/status/[id] (see app/api/v3/scan/status/[id]/route.ts) is
 * the only way to learn the outcome.
 */
export interface ScanJobStarted {
  readonly scanId: number;
  readonly status: "running";
}

export interface ScanStatusResponse {
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly currentCategory: string | null;
  readonly categoriesCompleted: number;
  readonly categoriesTotal: number;
  readonly elapsedMs: number;
  /** Present only once status === "completed". */
  readonly result?: ScanResult;
  /** Present only once status === "failed". */
  readonly error?: string;
}

export interface ScanHistoryRow {
  readonly id: number;
  readonly url: string;
  readonly summary: ScanSummary;
  readonly findings_count: number;
  readonly duration: number;
  readonly scanned_at: string;
  readonly source: "web" | "api";
  readonly tags: readonly string[];
}

export type Plan =
  "free" | "core_supporter" | "pro_supporter" | "elite_supporter";
export type Role = "user" | "support" | "moderator" | "admin";
export type ScanMode = "quick" | "deep";

// GET /api/version is public (no API key) -- see app/api/version/route.ts in
// the main repo. Only the fields the extension actually reads are declared.
export interface VersionResponse {
  readonly current: string;
}

export interface AuthMe {
  readonly userId: number;
  readonly email: string;
  readonly name: string | null;
  readonly plan: Plan;
  readonly role: Role;
  readonly totpEnabled: boolean;
  readonly twoFactorMethod: "app" | "email" | null;
  readonly isAdmin: boolean;
  readonly avatarUrl: string | null;
}

export type ServiceProbeId =
  "ssh" | "smtp" | "imap" | "pop3" | "ftp" | "mongodb";

export interface ProbeConfig {
  readonly enabled: boolean;
  readonly port: number;
}

export type ThemeMode = "light" | "dark" | "system";

export type AutoScanMode = "off" | "onTabFocus" | "onPageLoad" | "onUrlChange";

export type NotificationThreshold =
  "off" | "critical" | "high" | "medium" | "all";

/** Which screen corner the on-page site-alert card (reputation-card.ts)
 *  renders in. Applied via a data attribute the card's Chrome() renderer
 *  sets on every render, matched against sibling CSS overrides - see
 *  CARD_CSS in content/reputation-card.ts. */
export type CardPosition =
  "top-right" | "top-left" | "bottom-right" | "bottom-left";

export interface Settings {
  readonly autoScan: AutoScanMode;
  readonly autoScanThrottleSeconds: number;
  readonly families: Readonly<Record<ScannerCategory, boolean>>;
  readonly probes: Readonly<Record<ServiceProbeId, ProbeConfig>>;
  readonly scanMode: "quick" | "deep";
  readonly notifyThreshold: NotificationThreshold;
  readonly notifySound: boolean;
  readonly openDashboardOnNotify: boolean;
  readonly theme: ThemeMode;
  readonly compactMode: boolean;
  readonly whitelist: readonly string[];
  readonly blacklist: readonly string[];
  readonly pauseUntil: number | null;
  /**
   * The two independent halves of the on-page site-alert card, split out
   * so each can be turned off without the other: `showScanResults` gates
   * the card shown when the current page HAS a known prior scan
   * (`ReputationResponse.known === true`); `showScanPrompts` gates the
   * card offering to scan a page that DOESN'T. Both on (the default)
   * reproduces the old single `siteAlertsEnabled` toggle's "show
   * everything" behavior; both off reproduces its "show nothing".
   * Independent of autoScan -- this is about showing a prompt, not
   * triggering scans. Per-site mutes live separately in storage as
   * `mutedHosts` (see lib/storage.ts), not here, so muting one site
   * doesn't round-trip the entire settings object.
   */
  readonly showScanResults: boolean;
  readonly showScanPrompts: boolean;
  /** Screen corner for the on-page site-alert card. Defaults to
   *  top-right, matching the card's original hardcoded position. */
  readonly cardPosition: CardPosition;
}

export const DEFAULT_SETTINGS: Settings = {
  autoScan: "off",
  autoScanThrottleSeconds: 60,
  families: {
    headers: true,
    ssl: true,
    tls: true,
    content: true,
    cookies: true,
    configuration: true,
    "information-disclosure": true,
    dns: true,
    email: true,
    api: true,
    code: true,
    "secrets-extended": true,
    "vibe-code": true,
    "client-side": true,
    "supply-chain": true,
    "host-validation": true,
  },
  probes: {
    ssh: { enabled: false, port: 22 },
    smtp: { enabled: false, port: 587 },
    imap: { enabled: false, port: 143 },
    pop3: { enabled: false, port: 110 },
    ftp: { enabled: false, port: 21 },
    mongodb: { enabled: false, port: 27017 },
  },
  scanMode: "quick",
  notifyThreshold: "high",
  notifySound: false,
  openDashboardOnNotify: true,
  theme: "system",
  compactMode: false,
  whitelist: [],
  blacklist: [],
  pauseUntil: null,
  showScanResults: true,
  showScanPrompts: true,
  cardPosition: "top-right",
};

export interface AuthState {
  readonly apiKey: string;
  readonly me: AuthMe;
}

/**
 * Mirrors ScanReputationResponse from
 * app/api/v3/scan/reputation/route.ts verbatim -- field names and
 * null-vs-value semantics are a contract with that endpoint.
 */
export interface ReputationSeverityCounts {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly info: number;
}

export interface ReputationResponse {
  readonly known: boolean;
  readonly host: string;
  readonly dangerScore: number | null;
  readonly severityCounts: ReputationSeverityCounts | null;
  readonly lastScannedAt: string | null;
  readonly scanId: number | null;
}

export interface RateLimitInfo {
  readonly remaining: number;
  readonly limit: number;
  readonly resetsAt: string | null;
}

export interface ApiError {
  readonly error: string;
  readonly limit?: number;
  readonly used?: number;
  readonly remaining?: number;
  readonly resets_at?: string;
}
