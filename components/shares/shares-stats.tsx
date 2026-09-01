import { Link2, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { StatStrip } from "@/components/shared/stat-strip";
import type { Share } from "./shares-types";

interface SharesStatsProps {
  shares: Share[];
}

export function SharesStats({ shares }: SharesStatsProps) {
  const clean = shares.filter(
    (s) => getSafetyRating(s.findings) === "safe",
  ).length;
  const caution = shares.filter(
    (s) => getSafetyRating(s.findings) === "caution",
  ).length;
  const unsafe = shares.filter(
    (s) => getSafetyRating(s.findings) === "unsafe",
  ).length;

  return (
    <StatStrip
      items={[
        {
          value: shares.length,
          label: "Links live",
          icon: Link2,
          iconTone: "primary",
        },
        {
          value: clean,
          label: "Clean",
          icon: ShieldCheck,
          textTone: "text-[hsl(var(--success))]",
          iconTone: "success",
        },
        {
          value: caution,
          label: "Have warnings",
          icon: ShieldAlert,
          textTone: "text-[hsl(var(--severity-medium))]",
          iconTone: "severity-medium",
        },
        {
          value: unsafe,
          label: "Exploitable",
          icon: ShieldX,
          textTone: "text-[hsl(var(--severity-critical))]",
          iconTone: "destructive",
        },
      ]}
    />
  );
}
