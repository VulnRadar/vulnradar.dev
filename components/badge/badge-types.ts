import { ShieldCheck, AlertTriangle, ShieldAlert } from "lucide-react";
import type { Vulnerability } from "@/lib/scanner/types";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { SEVERITY_TONE } from "@/components/scanner/severity-badge";

export interface ScanEntry {
  id: number;
  url: string;
  share_token: string | null;
  /** Stable, auto-updating badge token for this URL (app/api/v3/badge/site/route.ts). */
  site_badge_token: string | null;
  /** 'user' (default): only this account's own scans update the badge. 'global': anyone's latest scan of the URL does. */
  site_badge_scope: "user" | "global" | null;
  findings: Vulnerability[];
  findings_count: number;
  scanned_at: string;
  summary?: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    info?: number;
    total?: number;
  };
}

/**
 * The badge page rates a whole scan safe/caution/unsafe rather than one
 * finding, and it used to paint that with its own red-500/amber-500/
 * emerald-500 scale. That was a second severity scale beside the single source
 * of truth in components/scanner/severity-badge.tsx, so /badge could rate a
 * scan on colours that drift from the real ones, and raw palette colours do
 * not follow the theme at all. unsafe and caution map onto the real scale;
 * "safe" has no severity equivalent, so it uses --success, the token the rest
 * of the product already uses for a clean result.
 */
const RATING_TONE = {
  unsafe: {
    text: SEVERITY_TONE.critical.text,
    surface: SEVERITY_TONE.critical.surface,
    label: "Unsafe",
    icon: ShieldAlert,
  },
  caution: {
    text: SEVERITY_TONE.medium.text,
    surface: SEVERITY_TONE.medium.surface,
    label: "Caution",
    icon: AlertTriangle,
  },
  safe: {
    text: "text-[hsl(var(--success))]",
    surface: "bg-[hsl(var(--success))]/10",
    label: "Safe",
    icon: ShieldCheck,
  },
} as const;

function ratingTone(scan: ScanEntry) {
  return RATING_TONE[getSafetyRating(scan.findings || [])];
}

export function getSeverityColor(scan: ScanEntry) {
  return ratingTone(scan).text;
}

export function getSeverityBg(scan: ScanEntry) {
  return ratingTone(scan).surface;
}

export function getSeverityLabel(scan: ScanEntry) {
  return ratingTone(scan).label;
}

/**
 * The glyph for the rating, from the same RATING_TONE row as the colour and
 * the label. The scan list used to pick it separately, off
 * `findings_count === 0`, which is not the question the row is answering: a
 * scan can carry a dozen hardening findings and still rate "safe" (see
 * lib/scanner/safety-rating.ts, "unsafe only with evidence of something
 * exploitable"). Almost every row therefore drew an amber warning triangle
 * next to a green "Safe", and on a security product the louder of those two
 * is the one that gets believed.
 */
export function getSeverityIcon(scan: ScanEntry) {
  return ratingTone(scan).icon;
}

// Canonical relative-time formatter (see lib/ui/relative-time.ts).
export { formatRelativeTime as getRelativeTime } from "@/lib/ui/relative-time";

export function getHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// One splitter for the whole app, next to the component that renders its
// output: components/shared/url-display.tsx.
export { parseUrl, type ParsedUrl } from "@/components/shared/url-display";
