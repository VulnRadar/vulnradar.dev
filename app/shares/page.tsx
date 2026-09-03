"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/use-toast";
import { AlertTriangle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { AppPageShell } from "@/components/shared/app-page-shell";
import {
  PaginationControl,
  usePagination,
} from "@/components/ui/pagination-control";
import { ShareModal } from "@/components/scanner/share-modal";
import { API, APP_NAME } from "@/lib/config/client-constants";
import {
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  setQueryParam,
  useQuerySeededState,
} from "@/lib/ui/url-state";
import {
  type Share,
  getShareUrl,
  SharesStats,
  SharesEmptyState,
  SharesTable,
  SharesDataSkeleton,
} from "@/components/shares";

export default function SharesPage() {
  const { toast } = useToast();
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [togglingPubliclyListed, setTogglingPubliclyListed] = useState<
    number | null
  >(null);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useQuerySeededState(
    () => getQueryParamInt("page") ?? 1,
    1,
  );
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedShare, setSelectedShare] = useState<Share | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Share | null>(null);

  const { totalPages, getPage } = usePagination(shares, pageSize);
  const paginatedShares = getPage(currentPage);

  // page=1 is the implicit default, so it's left out of the URL entirely
  // rather than ever showing up as ?page=1.
  function handlePageChange(page: number) {
    setCurrentPage(page);
    setQueryParam("page", page > 1 ? String(page) : null, { replace: true });
  }

  // Keeps currentPage in sync with browser back/forward on ?page=.
  useEffect(() => {
    const syncPageFromUrl = () => setCurrentPage(getQueryParamInt("page") ?? 1);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail.key === "page") syncPageFromUrl();
    };
    window.addEventListener(QUERY_CHANGE_EVENT, onChange);
    window.addEventListener("popstate", syncPageFromUrl);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onChange);
      window.removeEventListener("popstate", syncPageFromUrl);
    };
  }, [setCurrentPage]);

  // A failed load used to fall through to SharesEmptyState, which says there
  // are no share links. For a page whose whole subject is which of your scan
  // reports are reachable by a URL you handed out, "you have none" is the
  // most dangerous thing it could say when the truth is "we could not check".
  async function fetchShares() {
    setLoading(true);
    try {
      const res = await fetch(API.SHARES);
      if (!res.ok) {
        setListError("Couldn't load your share links.");
        return;
      }
      const data = await res.json();
      setListError(null);
      setShares(data.shares || []);
    } catch (err) {
      console.error("Failed to fetch shares:", err);
      setListError("Couldn't reach the server to load your share links.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: fetchShares' setState calls only fire after its async request resolves, not synchronously in this effect
    fetchShares();
  }, []);

  function requestRevoke(scanId: number) {
    setConfirmRevoke(shares.find((s) => s.id === scanId) ?? null);
  }

  async function togglePubliclyListed(share: Share) {
    setTogglingPubliclyListed(share.id);
    const next = !share.publiclyListed;
    try {
      const res = await fetch(API.SHARE_PUBLICLY_LISTED(share.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publiclyListed: next }),
      });
      if (res.ok) {
        setShares((prev) =>
          prev.map((s) =>
            s.id === share.id ? { ...s, publiclyListed: next } : s,
          ),
        );
      } else {
        // Same silent-failure shape as revokeShare: the toggle snapped back
        // with no explanation, so a report the user believed they had just
        // unlisted stayed publicly listed.
        const data = await res.json().catch(() => ({}));
        toast({
          title: next
            ? "Could not list that report publicly"
            : "Could not unlist that report",
          description:
            data.error ||
            "Nothing changed, the report is still exactly as it was. Try again in a moment.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to update public listing:", err);
      toast({
        title: "Could not change that report's visibility",
        description:
          "Nothing changed. Check your connection and try the switch again.",
        variant: "destructive",
      });
    } finally {
      setTogglingPubliclyListed(null);
    }
  }

  // Expiry is written through the same POST the Share action uses: it is
  // idempotent for a scan that already has a live token, so this updates the
  // expiry without minting a new link. `days` is null for "never expires",
  // which the route writes explicitly rather than treating as absent.
  const [updatingExpiry, setUpdatingExpiry] = useState(false);

  async function changeShareExpiry(share: Share, days: number | null) {
    setUpdatingExpiry(true);
    try {
      const res = await fetch(`${API.HISTORY}/${share.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: days }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Could not change when this link expires",
          description:
            data.error ||
            "Nothing changed, the link still expires when it did. Try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      // Read the expiry back rather than computing it here: the server owns
      // the resolution from a day count to a timestamp.
      const nextExpiresAt = (data.expiresAt ?? null) as string | null;
      setShares((prev) =>
        prev.map((s) =>
          s.id === share.id ? { ...s, expiresAt: nextExpiresAt } : s,
        ),
      );
      setSelectedShare((prev) =>
        prev && prev.id === share.id
          ? { ...prev, expiresAt: nextExpiresAt }
          : prev,
      );
    } catch (err) {
      console.error("Failed to change share expiry:", err);
      toast({
        title: "Could not change when this link expires",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingExpiry(false);
    }
  }

  async function revokeShare(scanId: number) {
    setConfirmRevoke(null);
    setRevoking(scanId);
    try {
      const res = await fetch(`${API.HISTORY}/${scanId}/share`, {
        method: "DELETE",
      });
      if (res.ok) {
        const updated = shares.filter((s) => s.id !== scanId);
        setShares(updated);
        // Page clamp is a side effect, so it runs OUTSIDE the state updater --
        // updaters must be pure (React can call them twice under StrictMode,
        // which would double-fire handlePageChange's history.replaceState + event).
        const newTotalPages = Math.max(1, Math.ceil(updated.length / pageSize));
        if (currentPage > newTotalPages) handlePageChange(newTotalPages);
      } else {
        // A non-ok response used to fall out of this `if` and do nothing at
        // all: the spinner stopped, the row stayed, and the user had no way
        // to tell a failed revoke from a successful one. On a control whose
        // whole purpose is withdrawing access to a security report, "looks
        // like it worked" is the worst possible outcome.
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Could not revoke that share link",
          description:
            data.error || "The link is still active. Please try again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to revoke share:", err);
      toast({
        title: "Could not revoke that share link",
        description: "The link is still active. Check your connection.",
        variant: "destructive",
      });
    } finally {
      setRevoking(null);
    }
  }

  return (
    <AppPageShell className="flex flex-col gap-5">
      {/* Title block carries the one action this page cannot do itself:
          links are minted from a scan in History, so with links already
          in the list the only route back there used to be the empty
          state nobody sees any more.

          It is static text, so it renders on the first frame rather than
          waiting behind a placeholder with the rest of the page. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-2 pt-2 sm:pt-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
            Shared reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Anyone with a link below can read that report without logging in.
            Revoke a link and it stops working immediately.
          </p>
        </div>
        {/* Whether this button belongs here depends on the data, and below sm
            it wraps onto its own line, so it is reserved rather than left out:
            otherwise everything under it moves down when the list lands. */}
        {loading ? (
          <Skeleton className="h-10 w-44 shrink-0" />
        ) : (
          shares.length > 0 && (
            <Button variant="outline" className="shrink-0 gap-2" asChild>
              <Link href="/history">
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share another scan
              </Link>
            </Button>
          )
        )}
      </div>

      {loading ? (
        <SharesDataSkeleton />
      ) : (
        <>
          {shares.length > 0 && <SharesStats shares={shares} />}

          {listError ? (
            // rounded-xl, not rounded-md: this fills the page-panel slot, and
            // its sibling in that same slot (SharesEmptyState) is rounded-xl.
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-4 py-14 text-center">
              <AlertTriangle
                className="h-6 w-6 text-destructive/70"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold text-foreground">
                {listError}
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Any links you created are still live. This page just could not
                read the list.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="bg-transparent"
                onClick={fetchShares}
              >
                Retry
              </Button>
            </div>
          ) : shares.length === 0 ? (
            <SharesEmptyState />
          ) : (
            <SharesTable
              shares={paginatedShares}
              revoking={revoking}
              togglingPubliclyListed={togglingPubliclyListed}
              onRevoke={requestRevoke}
              onOpenShareModal={(share) => {
                setSelectedShare(share);
                setShareModalOpen(true);
              }}
              onTogglePubliclyListed={togglePubliclyListed}
            />
          )}

          {shares.length > 0 && (
            <PaginationControl
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              pageSize={pageSize}
              onPageSizeChange={(s) => {
                setPageSize(s);
                handlePageChange(1);
              }}
              totalItems={shares.length}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmRevoke !== null}
        danger
        busy={revoking !== null}
        title="Revoke this shared link?"
        description={
          <>
            The link for{" "}
            <span className="font-medium text-foreground">
              {confirmRevoke?.url}
            </span>{" "}
            stops working immediately. Anyone who already has it, including
            people you sent it to, loses access.
          </>
        }
        confirmLabel="Revoke"
        onCancel={() => setConfirmRevoke(null)}
        onConfirm={async () => {
          if (confirmRevoke) await revokeShare(confirmRevoke.id);
        }}
      />

      {selectedShare && (
        <ShareModal
          open={shareModalOpen}
          onOpenChange={setShareModalOpen}
          shareUrl={getShareUrl(selectedShare.token)}
          title={`${APP_NAME} Scan: ${selectedShare.url}`}
          expiresAt={selectedShare.expiresAt ?? null}
          onExpiryChange={(days) => changeShareExpiry(selectedShare, days)}
          updatingExpiry={updatingExpiry}
          publiclyListed={selectedShare.publiclyListed}
          onPubliclyListedChange={() => togglePubliclyListed(selectedShare)}
          togglingPubliclyListed={togglingPubliclyListed === selectedShare.id}
        />
      )}
    </AppPageShell>
  );
}
