"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Clock, Download, Trash2, Loader2 } from "lucide-react";
import { API, APP_SLUG } from "@/lib/config/client-constants";
import { downloadBlob } from "@/lib/ui/download";
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
  preloadedSharePubliclyListedByDefault,
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
  const [deleteCurrentPassword, setDeleteCurrentPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  // "Scans are private by default" -- the account-level counterpart to the
  // per-scan "Keep this scan private" toggle on the scan form (see
  // lib/scanner/scan-privacy.ts's resolveScanIsPublic). Local state plus
  // pendingChanges, same discard/save flow ProfileNotificationsTab uses.
  //
  // null is a third state, not a missing boolean: the parent leaves it null
  // when GET /account/privacy failed, and `?? false` turned that into the
  // sentence "New scans publish to the public page at /host/<hostname> as
  // soon as they finish" for an account that may be set to the opposite.
  // The parent's banner says the load failed but clears after 8 seconds,
  // while a wrong switch sits there for good.
  const [scansPrivateByDefault, setScansPrivateByDefault] = useState<
    boolean | null
  >(preloadedScansPrivateByDefault ?? null);
  const [originalScansPrivateByDefault, setOriginalScansPrivateByDefault] =
    useState<boolean | null>(preloadedScansPrivateByDefault ?? null);

  // "List new shares in Public Scans by default" -- the account-level
  // counterpart to the per-share "List publicly" / "Unlist" toggle on the
  // Shared page (see lib/scanner/share-privacy.ts's
  // resolveSharePubliclyListed). Independent of the scan-visibility setting
  // above: same discard/save flow, same null tri-state, different setting
  // entirely.
  const [sharePubliclyListedByDefault, setSharePubliclyListedByDefault] =
    useState<boolean | null>(preloadedSharePubliclyListedByDefault ?? null);
  const [
    originalSharePubliclyListedByDefault,
    setOriginalSharePubliclyListedByDefault,
  ] = useState<boolean | null>(preloadedSharePubliclyListedByDefault ?? null);

  // Update state when preloaded data changes
  useEffect(() => {
    if (preloadedDataReqInfo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state from a changed prop, gated so it only fires when preloadedDataReqInfo actually arrives
      setDataReqInfo(preloadedDataReqInfo);
    }
  }, [preloadedDataReqInfo]);

  // Both effects used to test `!== undefined`, which null passes, so a
  // failed request was actively coerced to a concrete boolean here. Only a
  // real boolean is a real setting.
  useEffect(() => {
    if (typeof preloadedScansPrivateByDefault !== "boolean") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state from a changed prop, gated so it only fires when the preloaded value actually arrives
    setScansPrivateByDefault(preloadedScansPrivateByDefault);
    setOriginalScansPrivateByDefault(preloadedScansPrivateByDefault);
  }, [preloadedScansPrivateByDefault]);

  useEffect(() => {
    if (typeof preloadedSharePubliclyListedByDefault !== "boolean") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state from a changed prop, gated so it only fires when the preloaded value actually arrives
    setSharePubliclyListedByDefault(preloadedSharePubliclyListedByDefault);
    setOriginalSharePubliclyListedByDefault(
      preloadedSharePubliclyListedByDefault,
    );
  }, [preloadedSharePubliclyListedByDefault]);

  // Reset to original when discard is clicked (mirrors ProfileGeneralTab).
  useEffect(() => {
    if (discardKey && discardKey > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets to the already-known original value, gated to only fire when the parent bumps discardKey
      setScansPrivateByDefault(originalScansPrivateByDefault);
      setSharePubliclyListedByDefault(originalSharePubliclyListedByDefault);
    }
  }, [
    discardKey,
    originalScansPrivateByDefault,
    originalSharePubliclyListedByDefault,
  ]);

  // Re-baseline the original value once a save actually goes through
  // (mirrors ProfileNotificationsTab's saveKey handling).
  useEffect(() => {
    if (saveKey && saveKey > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- re-baselines the "original" value after a save, gated to only fire when the parent bumps saveKey
      setOriginalScansPrivateByDefault(scansPrivateByDefault);
      setOriginalSharePubliclyListedByDefault(sharePubliclyListedByDefault);
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

  function handleToggleSharePubliclyListedByDefault(checked: boolean) {
    setSharePubliclyListedByDefault(checked);
    if (checked !== originalSharePubliclyListedByDefault) {
      setPendingChanges((prev) => ({
        ...prev,
        sharePubliclyListedByDefault: checked,
      }));
    } else {
      setPendingChanges((prev) => {
        const { sharePubliclyListedByDefault: _drop, ...rest } = prev;
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
        downloadBlob(
          blob,
          `${APP_SLUG}-data-export-${new Date().toISOString().split("T")[0]}.json`,
        );
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
          downloadBlob(
            blob,
            `${APP_SLUG}-data-export-${new Date().toISOString().split("T")[0]}.json`,
          );
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
      const res = await fetch(API.ACCOUNT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: deleteCurrentPassword }),
      });
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

      {/* What is public by default.
          These were two separate sections, each an h2 plus its own bordered
          Card holding one switch, which read as two unrelated settings and
          pushed everything below them (including account deletion) a screen
          further down. They are the same kind of decision -- what a NEW scan
          or share does before you touch it -- so they share one panel with a
          divider between the rows. The mechanisms stay distinct: the first
          controls whether a scan feeds /host/[hostname], the second whether
          a share link appears in the /public-scans directory. */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            What is public by default
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Applies to new scans and new share links. Either one can still be
            flipped individually after the fact.
          </p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/50 divide-y divide-border/50">
          <div className="flex items-center justify-between gap-4 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Scans are public by default
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-md">
                {scansPrivateByDefault === null
                  ? "We could not load this setting, so it is not shown. Guessing it either way would tell you the opposite of what your account actually does with a new scan. Reload the page to try again."
                  : scansPrivateByDefault
                    ? 'New scans skip the public page at /host/<hostname>. You can still make a single scan public from that scan\'s menu, or by checking "public" before you run it.'
                    : "New scans publish to the public page at /host/<hostname> as soon as they finish. Turn this off to keep new scans private unless you say otherwise per scan."}
              </p>
            </div>
            {/* No switch while the real value is unknown: a switch has only
                two positions and both of them are a claim about who can see
                your scans. Nothing to toggle also means nothing to save. */}
            {scansPrivateByDefault === null ? (
              <span className="text-xs font-medium text-muted-foreground shrink-0">
                Unknown
              </span>
            ) : (
              <Switch
                checked={!scansPrivateByDefault}
                onCheckedChange={(checked) =>
                  handleTogglePrivateByDefault(!checked)
                }
                aria-label="Scans are public by default"
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-4 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                List new shares in the Public Scans directory
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-md">
                {sharePubliclyListedByDefault === null
                  ? "We could not load this setting, so it is not shown. Guessing it either way would tell you the opposite of what your account actually does with a new share link. Reload the page to try again."
                  : sharePubliclyListedByDefault
                    ? 'A new share link is listed at /public-scans, which anyone can browse, as soon as you create it. Unlist any single share from the "Shared" page without changing this default.'
                    : 'New share links stay off the public directory until you list them one at a time from the "Shared" page. The link itself still works for anyone you send it to.'}
              </p>
            </div>
            {sharePubliclyListedByDefault === null ? (
              <span className="text-xs font-medium text-muted-foreground shrink-0">
                Unknown
              </span>
            ) : (
              <Switch
                checked={sharePubliclyListedByDefault}
                onCheckedChange={handleToggleSharePubliclyListedByDefault}
                aria-label="List new shares in the Public Scans directory"
              />
            )}
          </div>
        </div>
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
        {/* One panel with divided rows, matching the defaults panel above.
            It used to be a Card wrapping a CardContent wrapping a bordered
            box wrapping the row, so a single button sat inside three nested
            borders. It also rendered that innermost box empty when
            dataReqInfo never arrived, which read as a broken control rather
            than a failed request. */}
        <div className="rounded-xl border border-border/50 bg-card/50 divide-y divide-border/50">
          {/* No cooldown, or the cooldown has expired */}
          {dataReqInfo?.canDownloadNew && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="min-w-0">
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

          {/* Cooldown active, so no fresh export yet */}
          {!dataReqInfo?.canDownloadNew && dataReqInfo?.lastDownloadAt && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  A fresh export is on cooldown
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Next one is ready in{" "}
                  <span className="font-mono text-foreground font-semibold">
                    {dataReqInfo.cooldownEndsAt
                      ? getTimeRemaining(dataReqInfo.cooldownEndsAt) || "soon"
                      : "soon"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Last downloaded {formatDate(dataReqInfo.lastDownloadAt)}
                </p>
              </div>
              <Button disabled className="shrink-0 gap-2">
                <Clock className="h-4 w-4" aria-hidden="true" />
                On cooldown
              </Button>
            </div>
          )}

          {/* Re-download the previous export */}
          {dataReqInfo?.hasData && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="min-w-0">
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

          {/* The request that fills dataReqInfo failed or has not landed.
              Without this the panel rendered as an empty bordered box. */}
          {!dataReqInfo && (
            <p className="p-4 sm:p-5 text-sm text-muted-foreground">
              We could not load your export history. Reload the page to try
              again.
            </p>
          )}
        </div>
      </section>

      {/* Danger zone: same visual language as the sign-out-everywhere danger
          zone on the Security tab, so both read as the same kind of action. */}
      <section className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 sm:p-5">
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
            {user?.hasPassword !== false && (
              <div className="flex flex-col gap-1.5 max-w-sm">
                <Label htmlFor="delete-account-password" className="text-xs">
                  Current password
                </Label>
                <Input
                  id="delete-account-password"
                  type="password"
                  placeholder="Re-enter your password"
                  value={deleteCurrentPassword}
                  onChange={(e) => setDeleteCurrentPassword(e.target.value)}
                  className="bg-card"
                  autoComplete="current-password"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                disabled={
                  deleteConfirmText !== "DELETE" ||
                  (user?.hasPassword !== false && !deleteCurrentPassword) ||
                  deleting
                }
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
                  setDeleteCurrentPassword("");
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
