"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  ExternalLink,
  User,
  Shield,
  Clock,
  CheckCircle2,
  Tag,
  MessageSquare,
  Copy,
  Check,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { ScanSummary } from "@/components/scanner/scan-summary";
import { ResultsList } from "@/components/scanner/results-list";
import { IssueDetail } from "@/components/scanner/issue-detail";
import { ExportButton } from "@/components/scanner/export-button";
import { ResponseHeaders } from "@/components/scanner/response-headers";
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  API,
  APP_NAME,
} from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function SharedScanPage() {
  const params = useParams();
  const token = params.token as string;

  const [result, setResult] = useState<ScanResult | null>(null);
  const [scannedBy, setScannedBy] = useState("");
  const [scannedByAvatar, setScannedByAvatar] = useState<string | null>(null);
  const [scannedByRole, setScannedByRole] = useState<string>("user");
  const [scannedByBadges, setScannedByBadges] = useState<
    {
      id: number;
      name: string;
      display_name: string;
      icon: string | null;
      color: string | null;
      priority: number;
    }[]
  >([]);
  const [scanNotes, setScanNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API.SHARED}/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "This shared scan could not be found.");
          return;
        }
        const data = await res.json();
        setResult(data);
        setScannedBy(data.scannedBy || "");
        setScannedByAvatar(data.scannedByAvatar || null);
        setScannedByRole(data.scannedByRole || "user");
        setScannedByBadges(data.scannedByBadges || []);
        setScanNotes(data.notes || "");
      } catch {
        setError("Failed to load shared scan.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(result?.url || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  const issueCount = result?.findings?.length || 0;
  const hasCritical = result?.findings?.some((f) => f.severity === "critical");
  const hasHigh = result?.findings?.some((f) => f.severity === "high");

  return (
    <PublicPageShell
      badge="Shared Report"
      maxWidth="max-w-5xl"
      padding="py-6 sm:py-8"
    >
      <div className="flex flex-col gap-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Loading shared scan...
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-6 py-20">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <div className="flex flex-col items-center gap-2 text-center max-w-sm">
              <h2 className="text-lg font-semibold text-foreground">
                Scan Not Found
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {error}
              </p>
            </div>
            <Button variant="outline" className="bg-transparent gap-2" asChild>
              <a href="/login">
                <ArrowLeft className="h-4 w-4" />
                Sign In to {APP_NAME}
              </a>
            </Button>
          </div>
        )}

        {!loading && result && (
          <div className="flex flex-col gap-6">
            {selectedIssue ? (
              <IssueDetail
                issue={selectedIssue}
                onBack={() => setSelectedIssue(null)}
              />
            ) : (
              <>
                {/* Hero header card */}
                <div className="relative overflow-hidden rounded-xl border border-border bg-card">
                  {/* Gradient accent bar */}
                  <div
                    className={cn(
                      "absolute top-0 left-0 right-0 h-1",
                      hasCritical
                        ? "bg-gradient-to-r from-red-500 to-red-600"
                        : hasHigh
                          ? "bg-gradient-to-r from-orange-500 to-amber-500"
                          : issueCount > 0
                            ? "bg-gradient-to-r from-yellow-500 to-amber-400"
                            : "bg-gradient-to-r from-emerald-500 to-green-500",
                    )}
                  />

                  <div className="p-5 sm:p-6">
                    {/* Sharer info */}
                    {scannedBy && (
                      <div className="flex items-center gap-2 mb-4">
                        {scannedByAvatar ? (
                          <Image
                            src={scannedByAvatar}
                            alt={scannedBy}
                            width={24}
                            height={24}
                            className="h-6 w-6 rounded-full object-cover ring-2 ring-background"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        )}
                        <span className="text-sm text-muted-foreground">
                          Shared by{" "}
                          <span className="font-medium text-foreground">
                            {scannedBy}
                          </span>
                        </span>
                        {scannedByRole &&
                          scannedByRole !== STAFF_ROLES.USER &&
                          ROLE_BADGE_STYLES[scannedByRole] && (
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${ROLE_BADGE_STYLES[scannedByRole]}`}
                            >
                              {STAFF_ROLE_LABELS[scannedByRole] ||
                                scannedByRole}
                            </span>
                          )}
                        {scannedByBadges.slice(0, 2).map((badge) => (
                          <span
                            key={badge.id}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              backgroundColor: `${badge.color}15`,
                              borderWidth: 1,
                              borderColor: `${badge.color}40`,
                              color: badge.color || undefined,
                            }}
                          >
                            <Tag className="h-2.5 w-2.5" />
                            {badge.display_name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* URL with copy */}
                    <div className="flex items-start gap-3 mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 group">
                          <h1 className="text-lg sm:text-xl font-semibold text-foreground truncate">
                            {result.url}
                          </h1>
                          <button
                            onClick={copyUrl}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                          >
                            {copied ? (
                              <Check className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <Copy className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      </div>
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 bg-transparent"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Visit
                        </Button>
                      </a>
                    </div>

                    {/* Stats row */}
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>
                          {formatRelativeTime(new Date(result.scannedAt))}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Shield className="h-4 w-4" />
                        <span>{result.checksRun || 0} checks</span>
                      </div>
                      <div
                        className={cn(
                          "flex items-center gap-1.5 font-medium",
                          issueCount === 0
                            ? "text-emerald-500"
                            : hasCritical
                              ? "text-red-500"
                              : hasHigh
                                ? "text-orange-500"
                                : "text-yellow-500",
                        )}
                      >
                        {issueCount === 0 ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <AlertCircle className="h-4 w-4" />
                        )}
                        <span>
                          {issueCount === 0
                            ? "No issues"
                            : `${issueCount} issue${issueCount !== 1 ? "s" : ""}`}
                        </span>
                      </div>
                      <div className="ml-auto">
                        <ExportButton result={result} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Scan summary */}
                <ScanSummary result={result} />

                {/* Response headers */}
                {result.responseHeaders &&
                  Object.keys(result.responseHeaders).length > 0 && (
                    <ResponseHeaders headers={result.responseHeaders} />
                  )}

                {/* Subdomain discovery */}
                <SubdomainDiscovery url={result.url} />

                {/* Notes */}
                {scanNotes && (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-500/10">
                        <MessageSquare className="h-4 w-4 text-violet-500" />
                      </div>
                      <h3 className="text-sm font-medium text-foreground">
                        Notes
                      </h3>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {scanNotes}
                    </p>
                  </div>
                )}

                {/* Results list */}
                {result.findings.length > 0 ? (
                  <ResultsList
                    findings={result.findings}
                    onSelectIssue={setSelectedIssue}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4 py-12 text-center rounded-xl border border-dashed border-border bg-card/50">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">
                        All Clear
                      </p>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        This scan completed with no detected vulnerabilities.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </PublicPageShell>
  );
}
