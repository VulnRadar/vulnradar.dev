import { getCategoryCounts } from "@/lib/scanner/registry";
import { Shield, Layers, Globe, Gauge } from "lucide-react";
import { cn } from "@/lib/ui/utils";

export function LandingStats() {
  const counts = getCategoryCounts();
  const totalChecks = Object.values(counts).reduce((a, b) => a + b, 0);
  const categoryCount = Object.keys(counts).length;

  const STATS = [
    {
      icon: Shield,
      value: `${totalChecks}+`,
      label: "Detection checks",
      tone: "primary" as const,
    },
    {
      icon: Layers,
      value: `${categoryCount}`,
      label: "Scanner categories",
      tone: "primary" as const,
    },
    {
      icon: Globe,
      value: "15",
      label: "Protocol variants",
      tone: "primary" as const,
    },
    {
      icon: Gauge,
      value: "<3s",
      label: "Median scan time",
      tone: "primary" as const,
    },
  ];

  return (
    <section className="border-y border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 min-w-0">
          {STATS.map((stat, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 sm:gap-3 p-3 sm:p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors"
            >
              <div
                className={cn(
                  "p-2 sm:p-2.5 rounded-lg shrink-0",
                  stat.tone === "primary"
                    ? "bg-primary/10"
                    : "bg-emerald-500/10",
                )}
              >
                <stat.icon
                  className={cn(
                    "h-3.5 w-3.5 sm:h-4 sm:w-4",
                    stat.tone === "primary"
                      ? "text-primary"
                      : "text-emerald-500",
                  )}
                />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold tracking-tight tabular-nums">
                  {stat.value}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">
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
