import { Share2, ShieldCheck, AlertTriangle } from "lucide-react"
import { getSafetyRating } from "@/lib/scanner/safety-rating"
import type { Share } from "./shares-types"

interface SharesStatsProps {
  shares: Share[]
}

export function SharesStats({ shares }: SharesStatsProps) {
  const clean = shares.filter((s) => getSafetyRating(s.findings) === "safe").length
  const caution = shares.filter((s) => getSafetyRating(s.findings) === "caution").length
  const critical = shares.filter((s) => getSafetyRating(s.findings) === "unsafe").length

  const stats = [
    { label: "Active Shares", value: shares.length, color: "text-foreground", icon: Share2, iconColor: "text-primary", bg: "bg-primary/10" },
    { label: "Clean Scans", value: clean, color: "text-emerald-500", icon: ShieldCheck, iconColor: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "With Warnings", value: caution, color: "text-yellow-500", icon: AlertTriangle, iconColor: "text-yellow-500", bg: "bg-yellow-500/10" },
    { label: "Critical", value: critical, color: "text-red-500", icon: AlertTriangle, iconColor: "text-red-500", bg: "bg-red-500/10" },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(({ label, value, color, icon: Icon, iconColor, bg }) => (
        <div key={label} className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30">
          <div className={`p-2 rounded-lg ${bg}`}>
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
          <div>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
