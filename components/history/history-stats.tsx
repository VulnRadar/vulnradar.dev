"use client";

import { Globe, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { getDomain, scanRowState, type ScanRecord } from "./history-types";
import { StatStrip } from "@/components/shared/stat-strip";

interface HistoryStatsProps {
  scans: ScanRecord[];
  /** True when the list endpoint capped the rows, so these counts describe the
   *  loaded window rather than the account. */
  capped?: boolean;
}

export function HistoryStats({ scans, capped }: HistoryStatsProps) {
  const totalScans = scans.length;
  // Same rule the rows use (scanRowState): a pending, abandoned or failed scan
  // has findings_count 0 because it never produced a result, so counting it as
  // "came back clean" told the account it was safer than it had been told.
  const cleanScans = scans.filter((s) => scanRowState(s) === "clean").length;
  const issueScans = scans.filter((s) => scanRowState(s) === "findings").length;
  const totalIssues = scans.reduce(
    (acc, s) => acc + (s.findings_count || 0),
    0,
  );
  const hosts = new Set(scans.map((s) => getDomain(s.url))).size;

  if (totalScans === 0) return null;

  return (
    <div className="flex flex-col gap-2">
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
      {/* Only the "Total scans" cell was ever fixed for the row cap. The other
          four counts are still derived from the loaded page, and the heading
          directly above states the real account total, so on a capped history
          the reader got five numbers over two different denominators with
          nothing saying so. */}
      {capped && (
        <p className="text-xs text-muted-foreground">
          Counted across the {totalScans} scans loaded here, not the whole
          account.
        </p>
      )}
    </div>
  );
}
