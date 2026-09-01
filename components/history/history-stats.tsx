"use client";

import { Globe, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { getDomain, type ScanRecord } from "./history-types";
import { StatStrip } from "@/components/shared/stat-strip";

interface HistoryStatsProps {
  scans: ScanRecord[];
}

export function HistoryStats({ scans }: HistoryStatsProps) {
  const totalScans = scans.length;
  const cleanScans = scans.filter((s) => s.findings_count === 0).length;
  const issueScans = scans.filter((s) => s.findings_count > 0).length;
  const totalIssues = scans.reduce(
    (acc, s) => acc + (s.findings_count || 0),
    0,
  );
  const hosts = new Set(scans.map((s) => getDomain(s.url))).size;

  if (totalScans === 0) return null;

  return (
    <StatStrip
      items={[
        // This cell used to read "Total scans" over `scans.length`, which the
        // h1 subtitle immediately above already states, so the page opened by
        // saying the same number twice in adjacent elements. Worse, the two
        // numbers were not even the same one: the subtitle counts every scan
        // on record and says so when the list is capped ("showing the N most
        // recent"), while this counted only the rows that had loaded, so a
        // capped history showed a "Total scans" that was flatly wrong. Distinct
        // hosts is the count that is genuinely not derivable from the rest of
        // the strip or from the heading.
        {
          value: hosts,
          label: hosts === 1 ? "Host" : "Hosts",
          icon: Globe,
          iconTone: "primary",
        },
        {
          value: cleanScans,
          label: "Came back clean",
          icon: ShieldCheck,
          textTone: "text-[hsl(var(--success))]",
          iconTone: "success",
        },
        {
          value: issueScans,
          label: "Had findings",
          icon: ShieldAlert,
          textTone: "text-[hsl(var(--severity-medium))]",
          iconTone: "severity-medium",
        },
        {
          value: totalIssues,
          label: "Findings total",
          icon: ShieldX,
          textTone: "text-[hsl(var(--severity-high))]",
          iconTone: "severity-high",
        },
      ]}
    />
  );
}
