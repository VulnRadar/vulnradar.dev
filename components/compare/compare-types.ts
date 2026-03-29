export interface ScanOption {
  id: number
  url: string
  findings_count: number
  scanned_at: string
  source?: string
}

export interface DiffResult {
  scanA: ScanOption & { summary: Record<string, number> }
  scanB: ScanOption & { summary: Record<string, number> }
  diff: {
    added: { title: string; severity: string }[]
    removed: { title: string; severity: string }[]
    unchanged: { title: string; severity: string }[]
    summary: { added: number; removed: number; unchanged: number }
  }
}

export const severityColors: Record<string, string> = {
  critical: "bg-[hsl(var(--severity-critical))]",
  high: "bg-[hsl(var(--severity-high))]",
  medium: "bg-[hsl(var(--severity-medium))]",
  low: "bg-[hsl(var(--severity-low))]",
  info: "bg-muted-foreground/50",
}

export const severityTextColors: Record<string, string> = {
  critical: "text-[hsl(var(--severity-critical))]",
  high: "text-[hsl(var(--severity-high))]",
  medium: "text-[hsl(var(--severity-medium))]",
  low: "text-[hsl(var(--severity-low))]",
  info: "text-muted-foreground",
}

export function displayUrl(url: string) {
  try {
    const u = new URL(url)
    const path = u.pathname === "/" ? "" : u.pathname + u.search
    return u.hostname + path
  } catch {
    return url
  }
}

export function getDomain(url: string) {
  try { return new URL(url).hostname } catch { return url }
}

export function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

export function getRelativeTime(date: string) {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(date)
}
