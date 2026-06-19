import { Shield, Zap, Target, Clock } from "lucide-react";
import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";

const STATS = [
  {
    icon: Shield,
    value: TOTAL_CHECKS_LABEL,
    label: "Security Checks",
    color: "primary",
  },
  { icon: Zap, value: "<3s", label: "Scan Time", color: "primary" },
  { icon: Target, value: "99.9%", label: "Accuracy", color: "emerald" },
  { icon: Clock, value: "24/7", label: "Monitoring", color: "primary" },
] as const;

export function LandingStats() {
  return (
    <section className="border-y border-border/50 bg-muted/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map((stat, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors"
            >
              <div
                className={cn(
                  "p-2.5 rounded-lg shrink-0",
                  stat.color === "primary"
                    ? "bg-primary/10"
                    : "bg-emerald-500/10",
                )}
              >
                <stat.icon
                  className={cn(
                    "h-4 w-4",
                    stat.color === "primary"
                      ? "text-primary"
                      : "text-emerald-500",
                  )}
                />
              </div>
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-bold tracking-tight">
                  {stat.value}
                </p>
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                  {stat.label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
