"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  BarChart3,
  Shield,
  Clock,
  Globe,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
  Terminal,
  Monitor,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface DashboardData {
  totalScans: number
  uniqueSites: number
  recentScans: {
    id: number
    url: string
    summary: { critical?: number; high?: number; medium?: number; low?: number; info?: number; total?: number }
    findings_count: number
    duration: number
    scanned_at: string
    source?: string
  }[]
  severityBreakdown: {
    critical: number
    high: number
    medium: number
    low: number
    info: number
  }
  topVulnerabilities: { title: string; severity: string; count: number }[]
  dailyActivity: { day: string; scans: number; issues: number }[]
  sourceBreakdown: { source: string; count: number }[]
}

function SeverityBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-16 shrink-0 capitalize">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-foreground w-8 text-right">{count}</span>
    </div>
  )
}

export function Dashboard() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => {
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) {
            window.location.href = "/login"
          }
          throw new Error("unauthorized")
        }
        return r.json()
      })
      .then((d) => {
        if (d && d.severityBreakdown) { setData(d) }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col gap-4 pt-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  const sb = {
    critical: Number(data.severityBreakdown.critical) || 0,
    high: Number(data.severityBreakdown.high) || 0,
    medium: Number(data.severityBreakdown.medium) || 0,
    low: Number(data.severityBreakdown.low) || 0,
    info: Number(data.severityBreakdown.info) || 0,
  }
  const totalIssues = sb.critical + sb.high + sb.medium + sb.low + sb.info

  const apiCount = data.sourceBreakdown.find((s) => s.source === "api")?.count || 0
  const webCount = data.sourceBreakdown.find((s) => s.source === "web")?.count || 0

  function getHostname(url: string) {
    try { return new URL(url).hostname } catch { return url }
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  // Build daily activity chart
  const activity = data.dailyActivity.map((d) => ({ ...d, scans: Number(d.scans) || 0, issues: Number(d.issues) || 0 }))
  const maxScans = Math.max(...activity.map((d) => d.scans), 1)

  return (
    <div className="flex flex-col gap-4 pt-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{data.totalScans}</p>
                <p className="text-xs text-muted-foreground">Total Scans</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <Globe className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{data.uniqueSites}</p>
                <p className="text-xs text-muted-foreground">Unique Sites</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <Terminal className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{apiCount}</p>
                <p className="text-xs text-muted-foreground">API Scans</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <Monitor className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{webCount}</p>
                <p className="text-xs text-muted-foreground">Web Scans</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Severity breakdown */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Severity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex flex-col gap-2.5">
            <SeverityBar label="Critical" count={sb.critical} total={totalIssues} color="bg-[hsl(var(--severity-critical))]" />
            <SeverityBar label="High" count={sb.high} total={totalIssues} color="bg-[hsl(var(--severity-high))]" />
            <SeverityBar label="Medium" count={sb.medium} total={totalIssues} color="bg-[hsl(var(--severity-medium))]" />
            <SeverityBar label="Low" count={sb.low} total={totalIssues} color="bg-[hsl(var(--severity-low))]" />
            <SeverityBar label="Info" count={sb.info} total={totalIssues} color="bg-muted-foreground/50" />
          </CardContent>
        </Card>

        {/* Daily activity (last 14 days) */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Scan Activity
              <span className="text-[10px] font-normal text-muted-foreground ml-auto">Last 14 days</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-end gap-[3px] h-32">
              {activity.map((d, i) => {
                const height = maxScans > 0 ? (d.scans / maxScans) * 100 : 0
                const dayDate = new Date(d.day + "T12:00:00")
                const isToday = new Date().toDateString() === dayDate.toDateString()
                const showLabel = i === 0 || i === activity.length - 1 || i === 6

                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-0.5 group relative">
                    {/* Tooltip on hover */}
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap bg-popover border border-border rounded px-2 py-1 shadow-lg">
                      <p className="text-[10px] text-foreground font-medium">{d.scans} scan{d.scans !== 1 ? "s" : ""}</p>
                      <p className="text-[9px] text-muted-foreground">{d.issues} issue{d.issues !== 1 ? "s" : ""}</p>
                    </div>

                    {/* Bar */}
                    <div
                      className={cn(
                        "w-full rounded-sm transition-all duration-500",
                        d.scans > 0
                          ? isToday ? "bg-primary" : "bg-primary/60"
                          : "bg-muted/60",
                        "group-hover:bg-primary group-hover:opacity-90"
                      )}
                      style={{ height: d.scans > 0 ? `${Math.max(height, 8)}%` : "4%" }}
                    />

                    {/* Date label */}
                    {showLabel && (
                      <span className="text-[9px] text-muted-foreground mt-0.5">
                        {dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                    {!showLabel && <span className="h-3" />}
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-primary" />
                  Today
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-primary/60" />
                  Past
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-muted/60" />
                  No scans
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {activity.reduce((acc, d) => acc + d.scans, 0)} total
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Top vulnerabilities */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[hsl(var(--severity-high))]" />
              Top Issues
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {data.topVulnerabilities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No issues found yet</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.topVulnerabilities.map((v, i) => {
                  const severityColors: Record<string, string> = {
                    critical: "bg-[hsl(var(--severity-critical))]",
                    high: "bg-[hsl(var(--severity-high))]",
                    medium: "bg-[hsl(var(--severity-medium))]",
                    low: "bg-[hsl(var(--severity-low))]",
                    info: "bg-muted-foreground/50",
                  }
                  return (
                    <div key={i} className="flex items-center gap-2.5">
                      <span className={cn("w-2 h-2 rounded-full shrink-0", severityColors[v.severity] || "bg-muted-foreground")} />
                      <span className="text-xs text-foreground truncate flex-1">{v.title}</span>
                      <span className="text-xs text-muted-foreground font-medium shrink-0">{v.count}x</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent scans */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Recent Scans
            </CardTitle>
            <button onClick={() => router.push("/history")} className="text-xs text-primary hover:underline">
              View all
            </button>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {data.recentScans.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No scans yet. Start scanning above!</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.recentScans.map((scan) => (
                  <button
                    key={scan.id}
                    onClick={() => router.push(`/history?view=${scan.id}`)}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted transition-colors text-left"
                  >
                    <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1">{getHostname(scan.url)}</span>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase",
                      scan.source === "api" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {scan.source === "api" ? "API" : "Web"}
                    </span>
                    <span className={cn(
                      "text-xs font-medium shrink-0",
                      scan.findings_count > 0 ? "text-[hsl(var(--severity-high))]" : "text-emerald-500"
                    )}>
                      {scan.findings_count > 0 ? `${scan.findings_count} issues` : "Clean"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
