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
  | "secrets-extended";

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

export type Plan = "free" | "core_supporter" | "pro_supporter" | "elite_supporter";
export type Role = "user" | "beta_tester" | "support" | "moderator" | "admin";

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
  | "ssh"
  | "smtp"
  | "imap"
  | "pop3"
  | "ftp"
  | "mongodb";

export interface ProbeConfig {
  readonly enabled: boolean;
  readonly port: number;
}

export type ThemeMode = "light" | "dark" | "system";

export type AutoScanMode =
  | "off"
  | "onTabFocus"
  | "onPageLoad"
  | "onUrlChange";

export type NotificationThreshold = "off" | "critical" | "high" | "medium" | "all";

export interface Settings {
  readonly autoScan: AutoScanMode;
  readonly autoScanThrottleSeconds: number;
  readonly families: Readonly<Record<ScannerCategory, boolean>>;
  readonly probes: Readonly<Record<ServiceProbeId, ProbeConfig>>;
  readonly scanMode: "quick" | "deep";
  readonly maxPages: number;
  readonly skipQueryStrings: boolean;
  readonly notifyThreshold: NotificationThreshold;
  readonly notifySound: boolean;
  readonly openDashboardOnNotify: boolean;
  readonly theme: ThemeMode;
  readonly compactMode: boolean;
  readonly whitelist: readonly string[];
  readonly blacklist: readonly string[];
  readonly pauseUntil: number | null;
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
  maxPages: 15,
  skipQueryStrings: false,
  notifyThreshold: "high",
  notifySound: false,
  openDashboardOnNotify: true,
  theme: "system",
  compactMode: false,
  whitelist: [],
  blacklist: [],
  pauseUntil: null,
};

export interface AuthState {
  readonly apiKey: string;
  readonly me: AuthMe;
}

export interface ApiError {
  readonly error: string;
  readonly limit?: number;
  readonly used?: number;
  readonly remaining?: number;
  readonly resets_at?: string;
}
