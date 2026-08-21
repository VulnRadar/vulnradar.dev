"use client";

import { useState } from "react";
import { Check, FileJson, FileSpreadsheet, Link2 } from "lucide-react";
import { PageActionsMenu, type PageActionEntry } from "@/components/shared";
import { APP_SLUG } from "@/lib/config/constants";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { downloadBlob, escapeCsv } from "@/lib/ui/download";
import { displayUrl, type DiffResult } from "./compare-types";

interface CompareActionsMenuProps {
  result: DiffResult;
}

/** Actions for a completed comparison: export the diff, or copy a link back to it. */
export function CompareActionsMenu({ result }: CompareActionsMenuProps) {
  const [copied, setCopied] = useState(false);

  const hostname = displayUrl(result.scanA.url).replace(/[./]/g, "-");
  const date = new Date().toISOString().split("T")[0];

  function exportJson() {
    const data = {
      base: {
        url: result.scanA.url,
        scannedAt: result.scanA.scanned_at,
        findingsCount: result.scanA.findings_count,
      },
      against: {
        url: result.scanB.url,
        scannedAt: result.scanB.scanned_at,
        findingsCount: result.scanB.findings_count,
      },
      diff: result.diff,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `${APP_SLUG}-compare-${hostname}-${date}.json`);
  }

  function exportCsv() {
    const headers = ["Status", "Title", "Severity"];
    const rows = [
      ...result.diff.added.map((f) => ["Added", f.title, f.severity]),
      ...result.diff.removed.map((f) => ["Removed", f.title, f.severity]),
      ...result.diff.unchanged.map((f) => ["Unchanged", f.title, f.severity]),
    ].map((row) => row.map(escapeCsv));
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${APP_SLUG}-compare-${hostname}-${date}.csv`);
  }

  async function copyLink() {
    if (await copyToClipboard(window.location.href)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const items: PageActionEntry[] = [
    {
      key: "json",
      label: "Export diff as JSON",
      icon: FileJson,
      onSelect: exportJson,
    },
    {
      key: "csv",
      label: "Export diff as CSV",
      icon: FileSpreadsheet,
      onSelect: exportCsv,
    },
    { separator: true },
    {
      key: "copy-link",
      label: copied ? "Link copied" : "Copy comparison link",
      icon: copied ? Check : Link2,
      onSelect: copyLink,
    },
  ];

  return <PageActionsMenu items={items} label="Comparison actions" />;
}
