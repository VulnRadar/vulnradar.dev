"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Clock, Download, Trash2, Loader2 } from "lucide-react";
import { API } from "@/lib/config/constants";
import type { ProfileTabProps } from "@/components/profile/types";

export function ProfilePrivacyTab({
  user,
  loading,
  error: _error,
  success: _success,
  setError,
  setSuccess,
  pendingChanges,
  setPendingChanges,
  discardKey,
  saveKey,
  preloadedDataReqInfo,
  preloadedScansPrivateByDefault,
}: ProfileTabProps) {
  // Use preloaded data if available
  const [dataReqInfo, setDataReqInfo] = useState<{
    hasData: boolean;
    canDownloadNew: boolean;
    cooldownEndsAt?: string;
    lastDownloadAt?: string;
  } | null>(preloadedDataReqInfo ?? null);
  const [requestingData, setRequestingData] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // "Scans are private by default" -- the account-level counterpart to the
  // per-scan "Keep this scan private" toggle on the scan form (see
  // lib/scanner/scan-privacy.ts's resolveScanIsPublic). Local state plus
  // pendingChanges, same discard/save flow ProfileNotificationsTab uses.
  const [scansPrivateByDefault, setScansPrivateByDefault] = useState(
    preloadedScansPrivateByDefault ?? false,
  );
  const [originalScansPrivateByDefault, setOriginalScansPrivateByDefault] =
    useState(preloadedScansPrivateByDefault ?? false);

  // Update state when preloaded data changes
  useEffect(() => {
    if (preloadedDataReqInfo) {
      setDataReqInfo(preloadedDataReqInfo);
    }
  }, [preloadedDataReqInfo]);

  useEffect(() => {
    if (preloadedScansPrivateByDefault !== undefined) {
      setScansPrivateByDefault(preloadedScansPrivateByDefault ?? false);
      setOriginalScansPrivateByDefault(preloadedScansPrivateByDefault ?? false);
    }
  }, [preloadedScansPrivateByDefault]);

  // Reset to original when discard is clicked (mirrors ProfileGeneralTab).
  useEffect(() => {
    if (discardKey && discardKey > 0) {
      setScansPrivateByDefault(originalScansPrivateByDefault);
    }
  }, [discardKey, originalScansPrivateByDefault]);

  // Re-baseline the original value once a save actually goes through
  // (mirrors ProfileNotificationsTab's saveKey handling).
  useEffect(() => {
    if (saveKey && saveKey > 0) {
      setOriginalScansPrivateByDefault(scansPrivateByDefault);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveKey]);

  function handleTogglePrivateByDefault(checked: boolean) {
    setScansPrivateByDefault(checked);
    if (checked !== originalScansPrivateByDefault) {
      setPendingChanges((prev) => ({
        ...prev,
        scansPrivateByDefault: checked,
      }));
    } else {
      setPendingChanges((prev) => {
        const { scansPrivateByDefault: _drop, ...rest } = prev;
        return rest;
      });
    }
  }

  async function handleRequestData() {
    setRequestingData(true);
    setError(null);
    try {
      const res = await fetch(API.DATA_REQUEST, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.data) {
        // Immediately download the data as JSON
        const jsonString = JSON.stringify(data.data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `vulnradar-data-export-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setSuccess("Data export downloaded successfully.");
        setDataReqInfo({
          hasData: true,
          lastDownloadAt: data.lastDownloadAt ?? new Date().toISOString(),
          canDownloadNew: data.canDownloadNew ?? false,
          cooldownEndsAt: data.cooldownEndsAt,
        });
      } else {
        setError(data.error || "Failed to request data export.");
      }
    } catch {
      setError("Failed to request data export.");
    } finally {
      setRequestingData(false);
    }
  }

  async function handleDownloadPreviousData() {
    setRequestingData(true);
    setError(null);
    try {
      const res = await fetch(API.DATA_REQUEST, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        if (data.data) {
          const jsonString = JSON.stringify(data.data, null, 2);
          const blob = new Blob([jsonString], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `vulnradar-data-export-${new Date().toISOString().split("T")[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setSuccess("Data export downloaded successfully.");
        } else {
          setError("No previous export data found.");
        }
      } else {
        setError("Failed to download data export.");
      }
    } catch {
      setError("Failed to download data export.");
    } finally {
      setRequestingData(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(API.ACCOUNT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setSuccess("Account deletion initiated. Redirecting to login...");
        setTimeout(() => {
          window.location.href = "/login";
        }, 1500);
      } else {
        setError(data.error || "Failed to delete account.");
      }
    } catch {
      setError("Failed to delete account.");
    } finally {
      setDeleting(false);
    }
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getTimeRemaining(endDate: string) {
    const now = new Date();
    const end = new Date(endDate);
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return "now";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Loading privacy settings...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Privacy, stated as prose rather than another pair of icon cards. */}
      <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
        Your data is encrypted at rest and in transit, and handled under GDPR
        and other applicable data protection law. The export below is the
        fastest way to see exactly what we hold.
      </p>

      {/* Scan visibility default */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Scan visibility
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every completed scan writes a snapshot to a public page at
            /host/&lt;hostname&gt; unless you say otherwise.
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center justify-between gap-4 py-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Scans are private by default
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-md">
                {scansPrivateByDefault
                  ? 'New scans skip the public host page. You can still make a single scan public from that scan\'s menu, or by checking "public" before you run it.'
                  : "New scans publish to the public host page as soon as they finish. Turn this on to keep them off it unless you say otherwise per scan."}
              </p>
            </div>
            <Switch
              checked={scansPrivateByDefault}
              onCheckedChange={handleTogglePrivateByDefault}
              aria-label="Scans are private by default"
            />
          </CardContent>
        </Card>
      </section>

      {/* Data Export */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Export your data
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            A JSON file with everything tied to your account.
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              {/* Download Fresh Data Section */}
              <div className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-secondary/30">
                {/* Can download fresh data - no cooldown or cooldown expired */}
                {dataReqInfo?.canDownloadNew && (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Your profile, API keys, scan history, and usage logs
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {dataReqInfo?.lastDownloadAt
                          ? "Your cooldown has expired. Get a fresh export now."
                          : "Downloads immediately as a .json file."}
                      </p>
                    </div>
                    <Button
                      onClick={handleRequestData}
                      disabled={requestingData}
                      className="shrink-0 gap-2"
                    >
                      {requestingData ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Download className="h-4 w-4" aria-hidden="true" />
                      )}
                      {requestingData ? "Downloading..." : "Download now"}
                    </Button>
                  </div>
                )}

                {/* Cooldown active - can't get fresh data yet */}
                {!dataReqInfo?.canDownloadNew &&
                  dataReqInfo?.lastDownloadAt && (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          A fresh export is on cooldown
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Next one is ready in{" "}
                          <span className="font-mono text-foreground font-semibold">
                            {dataReqInfo.cooldownEndsAt
                              ? getTimeRemaining(dataReqInfo.cooldownEndsAt) ||
                                "soon"
                              : "soon"}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Last downloaded{" "}
                          {formatDate(dataReqInfo.lastDownloadAt)}
                        </p>
                      </div>
                      <Button disabled className="shrink-0 gap-2">
                        <Clock className="h-4 w-4" aria-hidden="true" />
                        On cooldown
                      </Button>
                    </div>
                  )}
              </div>

              {/* Re-download Previous Export */}
              {dataReqInfo?.hasData && (
                <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-border bg-muted/50">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Your last export is still available
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      No cooldown on re-downloading it. Generated{" "}
                      {dataReqInfo.lastDownloadAt
                        ? formatDate(dataReqInfo.lastDownloadAt)
                        : "recently"}
                      .
                    </p>
                  </div>
                  <Button
                    onClick={handleDownloadPreviousData}
                    variant="outline"
                    className="shrink-0 gap-2"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Re-download
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Danger zone: same visual language as the sign-out-everywhere danger
          zone on the Security tab, so both read as the same kind of action. */}
      <section className="rounded-xl border border-destructive/25 bg-destructive/[0.03] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            <h2 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
              <AlertTriangle
                className="h-4 w-4 text-destructive"
                aria-hidden="true"
              />
              Delete account
            </h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Removes your account, API keys, scan history, and exports for
              good. There is no recovery after this runs.
            </p>
          </div>
          {!showDeleteConfirm && (
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive gap-2 shrink-0"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete account
            </Button>
          )}
        </div>

        {showDeleteConfirm && (
          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Permanently delete{" "}
                {user?.email ? (
                  <span className="font-mono break-all">{user.email}</span>
                ) : (
                  "this account"
                )}
                ?
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Every API key, scan, and export tied to it is deleted with it.
                Type{" "}
                <span className="font-mono font-semibold text-destructive">
                  DELETE
                </span>{" "}
                below to confirm.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 max-w-sm">
              <Label htmlFor="delete-account-confirm" className="sr-only">
                Type DELETE to confirm account deletion
              </Label>
              <Input
                id="delete-account-confirm"
                placeholder="Type DELETE to confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="bg-card font-mono"
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                disabled={deleteConfirmText !== "DELETE" || deleting}
                onClick={handleDeleteAccount}
                className="gap-2"
              >
                {deleting ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                )}
                {deleting ? "Deleting..." : "Permanently delete account"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                }}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
