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
  Terminal,
  Monitor,
  ArrowUpRight,
  Activity,
  Target,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { API } from "@/lib/constants"

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

function StatCard({ 
  value, 
  label, 
  icon: Icon, 
  trend, 
  color = "text-primary" 
}: { 
  value: string | number
  label: string
  icon: React.ElementType
  trend?: { value: number; label: string }
  color?: string
}) {
  // Map text color to background with opacity
  const bgColorMap: Record<string, string> = {
    "text-primary": "bg-primary/10",
    "text-cyan-500": "bg-cyan-500/10",
    "text-violet-500": "bg-violet-500/10",
    "text-amber-500": "bg-amber-500/10",
    "text-emerald-500": "bg-emerald-500/10",
    "text-rose-500": "bg-rose-500/10",
  }
  const bgColor = bgColorMap[color] || "bg-primary/10"
  
  return (
  <div className="group relative flex flex-col gap-3 p-5 rounded-xl border border-border bg-card/50 hover:bg-card/80 transition-colors">
  <div className="flex items-center justify-between">
  <div className={cn("flex items-center justify-center w-10 h-10 rounded-lg", bgColor)}>
  <Icon className={cn("h-5 w-5", color)} />
        </div>
        {trend && (
          <div className={cn(
            "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
            trend.value >= 0 ? "text-emerald-500 bg-emerald-500/10" : "text-destructive bg-destructive/10"
          )}>
            <TrendingUp className={cn("h-3 w-3", trend.value < 0 && "rotate-180")} />
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function MiniAreaChart({ data, color = "bg-primary" }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-[2px] h-12">
      {data.map((value, i) => {
        const height = (value / max) * 100
        return (
          <div
            key={i}
            className={cn("flex-1 rounded-sm transition-all", color, value === 0 && "bg-muted/30")}
            style={{ height: `${Math.max(height, 4)}%`, opacity: 0.4 + (i / data.length) * 0.6 }}
          />
        )
      })}
    </div>
  )
}

function SeverityBar({ label, count, total, color, icon: Icon }: { 
  label: string
  count: number
  total: number
  color: string
  icon?: React.ElementType
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="group flex items-center gap-4 py-2 px-3 -mx-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-2 w-20">
        <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", color)} />
        <span className="text-sm text-muted-foreground capitalize">{label}</span>
      </div>
      <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all duration-700 ease-out", color)} 
          style={{ width: `${pct}%` }} 
        />
      </div>
      <span className="text-sm font-semibold text-foreground w-10 text-right tabular-nums">{count}</span>
    </div>
  )
}

function ActivityChart({ data }: { data: { day: string; scans: number; issues: number }[] }) {
  const maxScans = Math.max(...data.map(d => d.scans), 1)
  
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1 h-28">
        {data.map((d, i) => {
          const height = (d.scans / maxScans) * 100
          const dayDate = new Date(d.day + "T12:00:00")
          const isToday = new Date().toDateString() === dayDate.toDateString()
          
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
              {/* Tooltip */}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap bg-popover border border-border rounded-lg px-3 py-2 shadow-xl">
                <p className="text-xs font-medium text-foreground">{d.scans} scan{d.scans !== 1 ? "s" : ""}</p>
                <p className="text-[10px] text-muted-foreground">{d.issues} issue{d.issues !== 1 ? "s" : ""}</p>
              </div>
              
              {/* Bar */}
              <div
                className={cn(
                  "w-full rounded-t-sm transition-all duration-300 cursor-pointer",
                  d.scans > 0
                    ? isToday 
                      ? "bg-primary" 
                      : "bg-primary/50 group-hover:bg-primary/70"
                    : "bg-muted/30",
                )}
                style={{ height: d.scans > 0 ? `${Math.max(height, 8)}%` : "4%" }}
              />
            </div>
          )
        })}
      </div>
      
      {/* X-axis labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
        <span>{new Date(data[0]?.day + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <span>{new Date(data[data.length - 1]?.day + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </div>
      
      {/* Legend */}
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-primary" />
            Today
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-primary/50" />
            Previous
          </span>
        </div>
        <span className="text-xs font-medium text-foreground">
          {data.reduce((acc, d) => acc + d.scans, 0)} total scans
        </span>
      </div>
    </div>
  )
}

export function Dashboard() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(API.DASHBOARD)
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
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col gap-6 pt-8">
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex flex-col gap-3 p-5 rounded-xl border border-border bg-card/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-8 w-16 rounded bg-muted animate-pulse" />
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        
        {/* Cards skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="p-5 rounded-xl border border-border bg-card/50">
              <div className="h-5 w-32 rounded bg-muted animate-pulse mb-4" />
              <div className="space-y-3">
                {[...Array(i === 1 ? 1 : 4)].map((_, j) => (
                  <div key={j} className={cn("rounded bg-muted animate-pulse", i === 1 ? "h-28" : "h-4")} style={{ width: i === 1 ? "100%" : `${90 - j * 10}%` }} />
                ))}
              </div>
            </div>
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

  function formatRelativeTime(d: string) {
    const diff = Date.now() - new Date(d).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const activity = data.dailyActivity.map((d) => ({ 
    ...d, 
    scans: Number(d.scans) || 0, 
    issues: Number(d.issues) || 0 
  }))

  return (
    <div className="flex flex-col gap-6 pt-8">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          value={data.totalScans}
          label="Total Scans"
          icon={BarChart3}
          color="text-primary"
        />
        <StatCard
          value={data.uniqueSites}
          label="Unique Sites"
          icon={Globe}
          color="text-cyan-500"
        />
        <StatCard
          value={apiCount}
          label="API Scans"
          icon={Terminal}
          color="text-violet-500"
        />
        <StatCard
          value={webCount}
          label="Web Scans"
          icon={Monitor}
          color="text-amber-500"
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Severity breakdown */}
        <div className="p-5 rounded-xl border border-border bg-card/50">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Severity Breakdown</h3>
            </div>
            <span className="text-xs text-muted-foreground">{totalIssues} total issues</span>
          </div>
          <div className="space-y-1">
            <SeverityBar label="Critical" count={sb.critical} total={totalIssues} color="bg-[hsl(var(--severity-critical))]" />
            <SeverityBar label="High" count={sb.high} total={totalIssues} color="bg-[hsl(var(--severity-high))]" />
            <SeverityBar label="Medium" count={sb.medium} total={totalIssues} color="bg-[hsl(var(--severity-medium))]" />
            <SeverityBar label="Low" count={sb.low} total={totalIssues} color="bg-[hsl(var(--severity-low))]" />
            <SeverityBar label="Info" count={sb.info} total={totalIssues} color="bg-muted-foreground/50" />
          </div>
        </div>

        {/* Scan Activity */}
        <div className="p-5 rounded-xl border border-border bg-card/50">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Scan Activity</h3>
            </div>
            <span className="text-xs text-muted-foreground">Last 14 days</span>
          </div>
          <ActivityChart data={activity} />
        </div>

        {/* Top Issues */}
        <div className="p-5 rounded-xl border border-border bg-card/50">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[hsl(var(--severity-high))]" />
              <h3 className="text-sm font-semibold text-foreground">Top Issues</h3>
            </div>
            <span className="text-xs text-muted-foreground">{data.topVulnerabilities.length} types</span>
          </div>
          {data.topVulnerabilities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Target className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No issues found yet</p>
              <p className="text-xs text-muted-foreground/60">Run a scan to detect vulnerabilities</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.topVulnerabilities.map((v, i) => {
                const severityColors: Record<string, string> = {
                  critical: "bg-[hsl(var(--severity-critical))]",
                  high: "bg-[hsl(var(--severity-high))]",
                  medium: "bg-[hsl(var(--severity-medium))]",
                  low: "bg-[hsl(var(--severity-low))]",
                  info: "bg-muted-foreground/50",
                }
                return (
                  <div 
                    key={i} 
                    className="flex items-center gap-3 py-2 px-3 -mx-3 rounded-lg hover:bg-muted/30 transition-colors group"
                  >
                    <span className={cn("w-2 h-2 rounded-full shrink-0", severityColors[v.severity] || "bg-muted-foreground")} />
                    <span className="text-sm text-foreground truncate flex-1">{v.title}</span>
                    <span className="text-xs font-medium text-muted-foreground tabular-nums bg-muted/50 px-2 py-0.5 rounded-full">
                      {v.count}x
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent Scans */}
        <div className="p-5 rounded-xl border border-border bg-card/50">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Recent Scans</h3>
            </div>
            <a 
              href="/history" 
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
            >
              View all
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
          {data.recentScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Globe className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No scans yet</p>
              <p className="text-xs text-muted-foreground/60">Start scanning to see your history</p>
            </div>
          ) : (
            <div className="space-y-1">
              {data.recentScans.map((scan) => (
                <a
                  key={scan.id}
                  href={`/history#${scan.id}`}
                  className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-lg hover:bg-muted/30 transition-colors group"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50 shrink-0">
                    {scan.source === "api" ? (
                      <Terminal className="h-3.5 w-3.5 text-violet-500" />
                    ) : (
                      <Globe className="h-3.5 w-3.5 text-cyan-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{getHostname(scan.url)}</p>
                    <p className="text-xs text-muted-foreground">{formatRelativeTime(scan.scanned_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-xs font-medium px-2 py-1 rounded-full",
                      scan.findings_count > 0 
                        ? "text-[hsl(var(--severity-high))] bg-[hsl(var(--severity-high))]/10" 
                        : "text-emerald-500 bg-emerald-500/10"
                    )}>
                      {scan.findings_count > 0 ? `${scan.findings_count} issues` : "Clean"}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
