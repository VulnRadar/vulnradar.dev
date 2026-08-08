"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BotMessageSquare,
  Eye,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  Share2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageActionsMenu, type PageActionEntry } from "@/components/shared";
import { ShareModal } from "./share-modal";
import { generatePdfReport } from "@/lib/reports/pdf-report";
import {
  API,
  APP_NAME,
  APP_SLUG,
  APP_VERSION,
  ROUTES,
} from "@/lib/config/constants";
import { apiDelete, apiPost } from "@/lib/api/client";
import { canOfferAiReview } from "./ai-review-gate";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

interface ScanActionsMenuProps {
  result: ScanResult;
  /** Undefined for a scan that has not been saved to history yet: hides Share and AI review. */
  scanId?: number | null;
  /** Only meaningful together with onDeleted: hides Delete when either is missing. */
  isOwner?: boolean;
  onDeleted?: () => void;
  /** Called with the updated findings once an on-demand AI review finishes. */
  onVerified?: (findings: Vulnerability[]) => void;
}

function isMobileBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Kebab-menu replacement for the row of individual Export/Share/View/Delete
 * buttons a scan detail header used to show. Owns the same logic those
 * buttons had (this does not touch ExportButton/ShareButton/ViewPageButton/
 * DeleteScanButton, which stay as standalone buttons for the other places
 * they're already used).
 */
export function ScanActionsMenu({
  result,
  scanId,
  isOwner,
  onDeleted,
  onVerified,
}: ScanActionsMenuProps) {
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewOpening, setViewOpening] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [aiAvailable, setAiAvailable] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Only relevant once the scan is saved to history, since that's the
  // only state the verify endpoint can attach verdicts to.
  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    fetch(API.AI_INFO)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAiAvailable(Boolean(d.configured) && !d.aiDisabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const hostname = (() => {
    try {
      return new URL(result.url).hostname.replace(/\./g, "-");
    } catch {
      return "scan";
    }
  })();
  const date = new Date().toISOString().split("T")[0];

  function exportJson() {
    const data = {
      meta: {
        tool: APP_NAME,
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
      },
      scan: {
        url: result.url,
        scannedAt: result.scannedAt,
        duration: result.duration,
        summary: result.summary,
      },
      findings: result.findings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
        description: f.description,
        evidence: f.evidence,
        riskImpact: f.riskImpact,
        explanation: f.explanation,
        fixSteps: f.fixSteps,
        codeExamples: f.codeExamples,
        ...(f.aiVerdict
          ? {
              aiVerdict: f.aiVerdict,
              aiConfidence: f.aiConfidence,
              aiReason: f.aiReason,
            }
          : {}),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `${APP_SLUG}-${hostname}-${date}.json`);
  }

  function exportCsv() {
    const headers = [
      "Title",
      "Severity",
      "Category",
      "Description",
      "Evidence",
      "Risk Impact",
      "Fix Steps",
      "AI Verdict",
      "AI Confidence",
      "AI Notes",
    ];
    const rows = result.findings.map((f) => [
      escapeCsv(f.title),
      escapeCsv(f.severity.toUpperCase()),
      escapeCsv(f.category),
      escapeCsv(f.description),
      escapeCsv(f.evidence),
      escapeCsv(f.riskImpact),
      escapeCsv(f.fixSteps.join(" | ")),
      escapeCsv(f.aiVerdict ?? ""),
      escapeCsv(f.aiConfidence != null ? String(f.aiConfidence) : ""),
      escapeCsv(f.aiReason ?? ""),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${APP_SLUG}-${hostname}-${date}.csv`);
  }

  function exportPdf() {
    const pdfBytes = generatePdfReport(result);
    const blob = new Blob([new Uint8Array(pdfBytes)], {
      type: "application/pdf",
    });
    downloadBlob(blob, `${APP_SLUG}-${hostname}-${date}.pdf`);
  }

  async function requestShare() {
    if (!scanId) return;
    if (shareUrl) {
      setShareModalOpen(true);
      return;
    }
    setShareLoading(true);
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}/share`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setShareUrl(`${window.location.origin}/shared/${data.token}`);
        setShareModalOpen(true);
      }
    } catch {
      // Silently fail, matching ShareButton's existing behavior.
    } finally {
      setShareLoading(false);
    }
  }

  async function openBrowserSession() {
    setViewError(null);
    setViewOpening(true);
    try {
      const res = await fetch(API.BROWSER_SESSIONS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: result.url, ttlSeconds: 360 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setViewError(
          data?.error ||
            `Could not start a browser session (HTTP ${res.status}).`,
        );
        return;
      }
      const id = data?.session?.id;
      if (!id) {
        setViewError("BrowserBase returned a session with no id.");
        return;
      }
      setViewOpen(false);
      const qs = new URLSearchParams();
      if (data?.expiresInSeconds)
        qs.set("expiresIn", String(data.expiresInSeconds));
      qs.set("url", result.url);
      const href = `${ROUTES.BROWSER(id)}?${qs.toString()}`;

      const a = document.createElement("a");
      a.href = href;
      a.target = isMobileBrowser() ? "_blank" : `vulnradar-browser-${id}`;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setViewError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setViewOpening(false);
    }
  }

  async function handleVerify() {
    if (!scanId) return;
    setVerifying(true);
    try {
      const data = await apiPost<{
        success: boolean;
        findings: Vulnerability[];
      }>(API.SCAN_VERIFY, { scanHistoryId: scanId });
      if (Array.isArray(data.findings)) {
        onVerified?.(data.findings);
      }
    } catch {
      // Silently fail, matching requestShare's existing behavior.
    } finally {
      setVerifying(false);
    }
  }

  async function handleDelete() {
    if (!scanId) return;
    setDeleting(true);
    try {
      await apiDelete(`${API.HISTORY}/${scanId}/delete`);
      setConfirmDelete(false);
      onDeleted?.();
    } catch {
      setDeleting(false);
    }
  }

  const canView = /^https?:\/\//i.test(result.url.trim());
  const canDelete = Boolean(scanId && isOwner && onDeleted);
  const showAiReview = canOfferAiReview({
    scanId,
    aiAvailable,
    findings: result.findings,
  });

  const items: PageActionEntry[] = [
    {
      key: "json",
      label: "Export as JSON",
      icon: FileJson,
      onSelect: exportJson,
    },
    {
      key: "csv",
      label: "Export as CSV",
      icon: FileSpreadsheet,
      onSelect: exportCsv,
    },
    { key: "pdf", label: "Export as PDF", icon: FileText, onSelect: exportPdf },
    { separator: true },
    ...(scanId
      ? ([
          {
            key: "share",
            label: shareLoading ? "Sharing..." : "Share this scan",
            icon: shareLoading ? Loader2 : Share2,
            onSelect: requestShare,
            disabled: shareLoading,
          },
        ] as PageActionEntry[])
      : []),
    ...(showAiReview
      ? ([
          {
            key: "ai-review",
            label: verifying ? "Verifying with AI..." : "Verify with AI",
            icon: verifying ? Loader2 : BotMessageSquare,
            onSelect: handleVerify,
            disabled: verifying,
          },
        ] as PageActionEntry[])
      : []),
    ...(canView
      ? ([
          {
            key: "view",
            label: "View page in live browser",
            icon: Eye,
            onSelect: () => {
              setViewError(null);
              setViewOpen(true);
            },
          },
        ] as PageActionEntry[])
      : []),
    ...(canDelete
      ? ([
          { separator: true },
          {
            key: "delete",
            label: "Delete scan",
            icon: Trash2,
            onSelect: () => setConfirmDelete(true),
            destructive: true,
          },
        ] as PageActionEntry[])
      : []),
  ];

  return (
    <>
      <PageActionsMenu items={items} label="Scan actions" />

      {shareUrl && (
        <ShareModal
          open={shareModalOpen}
          onOpenChange={setShareModalOpen}
          shareUrl={shareUrl}
          title={`${APP_NAME} Scan: ${result.url}`}
        />
      )}

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Live browser session</DialogTitle>
            <DialogDescription>
              A secure remote browser opens and navigates to your target
              automatically. Nothing is saved to your account. Starts at 1
              minute, extendable to 5 minutes from the viewer.
            </DialogDescription>
          </DialogHeader>
          {viewError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <span className="min-w-0">{viewError}</span>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setViewOpen(false)}
              disabled={viewOpening}
            >
              Cancel
            </Button>
            <Button
              onClick={openBrowserSession}
              disabled={viewOpening}
              className="gap-2"
            >
              {viewOpening && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {viewOpening ? "Opening..." : "Open browser"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => !deleting && setConfirmDelete(open)}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="h-5 w-5 text-destructive shrink-0"
                aria-hidden="true"
              />
              Delete this scan?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              This removes the scan, its findings, and any notes attached to it.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="gap-2"
            >
              {deleting && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
