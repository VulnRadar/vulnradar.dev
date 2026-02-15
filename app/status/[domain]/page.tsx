"use client"

import { useEffect, useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  AlertCircle,
  ExternalLink,
  Clock,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  Globe,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import { Footer } from "@/components/scanner/footer"
import { APP_NAME } from "@/lib/constants"
import { cn } from "@/lib/utils"
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

interface ScanEntry {
  id: number
  url: string
  summary: {
    critical?: number
    high?: number
    medium?: number
    low?: number
    info?: number
    total: number
  }
  findingsCount: number
  duration: number
  scannedAt: string
}

interface StatusData {
  domain: string
  scans: ScanEntry[]
  totalScans: number
}

function getRating(summary: ScanEntry["summary"]): "safe" | "caution" | "unsafe" {
  const critical = summary.critical || 0
  const high = summary.high || 0
  const medium = summary.medium || 0

  if (critical > 0) return "unsafe"
  if (high >= 2) return "unsafe"
  if (high === 1) return "caution"
  if (medium >= 3) return "caution"
  return "safe"
}

const ratingConfig = {
  safe: {
    label: "Safe",
    icon: ShieldCheck,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    fill: "#10b981",
  },
  caution: {
    label: "Caution",
    icon: ShieldAlert,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    fill: "#f59e0b",
  },
  unsafe: {
    label: "Unsafe",
    icon: ShieldX,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    fill: "#ef4444",
  },
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{payload[0].value} finding(s)</p>
    </div>
  )
}

export default function StatusPage() {
  const params = useParams()
  const router = useRouter()
  const domain = decodeURIComponent(params.domain as string)
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/status/${encodeURIComponent(domain)}`)
        if (!res.ok) {
          setError(res.status === 400 ? "Invalid domain format." : "Failed to load status.")
          return
        }
        const json = await res.json()
        setData(json)
      } catch {
        setError("Failed to load status data.")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [domain])

  const chartData = useMemo(() => {
    if (!data?.scans.length) return []
    return [...data.scans]
      .reverse()
      .map((s) => ({
        date: new Date(s.scannedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        findings: s.findingsCount,
        critical: s.summary.critical || 0,
        high: s.summary.high || 0,
      }))
  }, [data])

  const latestScan = data?.scans[0] || null
  const previousScan = data?.scans[1] || null
  const latestRating = latestScan ? getRating(latestScan.summary) : null
  const latestConfig = latestRating ? ratingConfig[latestRating] : null

  const trend = useMemo(() => {
    if (!latestScan || !previousScan) return "neutral"
    if (latestScan.findingsCount < previousScan.findingsCount) return "improving"
    if (latestScan.findingsCount > previousScan.findingsCount) return "degrading"
    return "neutral"
  }, [latestScan, previousScan])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2 text-foreground"
        >
          <Shield className="h-5 w-5 text-primary" />
          <span className="font-bold text-sm">{APP_NAME}</span>
        </button>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/login")}
            className="bg-transparent text-xs"
          >
            Sign In
          </Button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
        {loading && (
          <div className="flex flex-col items-center gap-4 py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading status for {domain}...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-4 py-24">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <div className="flex flex-col gap-6">
            {/* Domain header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Security Status</p>
                </div>
                <h1 className="text-2xl font-bold text-foreground text-balance">{domain}</h1>
              </div>
              {latestConfig && latestRating && (
                <div className={cn("flex items-center gap-2 px-4 py-2 rounded-xl border", latestConfig.bg, latestConfig.border)}>
                  <latestConfig.icon className={cn("h-5 w-5", latestConfig.color)} />
                  <span className={cn("text-sm font-semibold", latestConfig.color)}>{latestConfig.label}</span>
                </div>
              )}
            </div>

            {data.scans.length === 0 ? (
              <Card className="flex flex-col items-center gap-4 py-16 text-center border-dashed bg-transparent">
                <Shield className="h-8 w-8 text-muted-foreground/30" />
                <div>
                  <p className="text-sm font-medium text-foreground">No public scan data</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    No shared scans found for this domain. Scan results must be shared to appear here.
                  </p>
                </div>
              </Card>
            ) : (
              <>
                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card className="p-4 bg-card/50 backdrop-blur-sm">
                    <p className="text-xs text-muted-foreground mb-1">Total Scans</p>
                    <p className="text-2xl font-bold text-foreground">{data.totalScans}</p>
                  </Card>
                  <Card className="p-4 bg-card/50 backdrop-blur-sm">
                    <p className="text-xs text-muted-foreground mb-1">Latest Findings</p>
                    <p className="text-2xl font-bold text-foreground">{latestScan?.findingsCount ?? 0}</p>
                  </Card>
                  <Card className="p-4 bg-card/50 backdrop-blur-sm">
                    <p className="text-xs text-muted-foreground mb-1">Trend</p>
                    <div className="flex items-center gap-1.5">
                      {trend === "improving" && <TrendingDown className="h-5 w-5 text-emerald-500" />}
                      {trend === "degrading" && <TrendingUp className="h-5 w-5 text-red-500" />}
                      {trend === "neutral" && <Minus className="h-5 w-5 text-muted-foreground" />}
                      <span className={cn(
                        "text-sm font-semibold capitalize",
                        trend === "improving" && "text-emerald-500",
                        trend === "degrading" && "text-red-500",
                        trend === "neutral" && "text-muted-foreground",
                      )}>
                        {trend}
                      </span>
                    </div>
                  </Card>
                  <Card className="p-4 bg-card/50 backdrop-blur-sm">
                    <p className="text-xs text-muted-foreground mb-1">Last Scanned</p>
                    <p className="text-sm font-medium text-foreground">
                      {latestScan ? new Date(latestScan.scannedAt).toLocaleDateString() : "N/A"}
                    </p>
                  </Card>
                </div>

                {/* Findings trend chart */}
                {chartData.length > 1 && (
                  <Card className="p-4 sm:p-6 bg-card/50 backdrop-blur-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold text-foreground">Findings Over Time</h2>
                    </div>
                    <div className="h-[240px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                          <defs>
                            <linearGradient id="fillFindings" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={latestConfig?.fill || "#0ea5e9"} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={latestConfig?.fill || "#0ea5e9"} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Area
                            type="monotone"
                            dataKey="findings"
                            stroke={latestConfig?.fill || "#0ea5e9"}
                            strokeWidth={2}
                            fill="url(#fillFindings)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                )}

                {/* Scan history table */}
                <Card className="overflow-hidden bg-card/50 backdrop-blur-sm">
                  <div className="px-4 py-3 border-b border-border/40">
                    <h2 className="text-sm font-semibold text-foreground">Scan History</h2>
                  </div>
                  <div className="divide-y divide-border/40">
                    {data.scans.map((scan) => {
                      const rating = getRating(scan.summary)
                      const cfg = ratingConfig[rating]
                      const RatingIcon = cfg.icon
                      return (
                        <div key={scan.id} className="flex items-center gap-4 px-4 py-3">
                          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", cfg.bg)}>
                            <RatingIcon className={cn("h-4 w-4", cfg.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{scan.url}</p>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(scan.scannedAt).toLocaleDateString()}{" "}
                                {new Date(scan.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              <span>{(scan.duration / 1000).toFixed(1)}s</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-foreground">{scan.findingsCount}</p>
                              <p className="text-[10px] text-muted-foreground">findings</p>
                            </div>
                            {scan.summary.critical ? (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                                {scan.summary.critical} critical
                              </span>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>

                {/* Public notice */}
                <p className="text-[10px] text-muted-foreground/50 text-center">
                  Only publicly shared scan results are displayed. Powered by {APP_NAME}.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
