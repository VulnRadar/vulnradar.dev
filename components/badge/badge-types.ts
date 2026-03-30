import type { Vulnerability } from "@/lib/scanner/types"
import { getSafetyRating } from "@/lib/scanner/safety-rating"

export interface ScanEntry {
  id: number
  url: string
  share_token: string | null
  findings: Vulnerability[]
  findings_count: number
  scanned_at: string
  summary?: { critical?: number; high?: number; medium?: number; low?: number; info?: number; total?: number }
}

export function getSeverityColor(scan: ScanEntry) {
  const rating = getSafetyRating(scan.findings || [])
  if (rating === "unsafe") return "text-red-500"
  if (rating === "caution") return "text-amber-500"
  return "text-emerald-500"
}

export function getSeverityBg(scan: ScanEntry) {
  const rating = getSafetyRating(scan.findings || [])
  if (rating === "unsafe") return "bg-red-500/10"
  if (rating === "caution") return "bg-amber-500/10"
  return "bg-emerald-500/10"
}

export function getSeverityLabel(scan: ScanEntry) {
  const rating = getSafetyRating(scan.findings || [])
  if (rating === "unsafe") return "Unsafe"
  if (rating === "caution") return "Caution"
  return "Safe"
}

export function getRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function getHostname(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export interface ParsedUrl {
  subdomain: string | null
  host: string
  path: string
}

export function parseUrl(url: string): ParsedUrl {
  try {
    const u = new URL(url)
    const path = u.pathname === "/" ? "" : u.pathname + (u.search || "")
    const parts = u.hostname.split(".")
    const subdomain = parts.length > 2 ? parts[0] : null
    const host = subdomain ? parts.slice(1).join(".") : u.hostname
    return { subdomain, host, path }
  } catch {
    return { subdomain: null, host: url, path: "" }
  }
}
