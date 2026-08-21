"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import {
  PaginationControl,
  usePagination,
} from "@/components/ui/pagination-control";
import { ShareModal } from "@/components/scanner/share-modal";
import { API, APP_NAME } from "@/lib/config/constants";
import {
  getQueryParamInt,
  QUERY_CHANGE_EVENT,
  setQueryParam,
} from "@/lib/ui/url-state";
import {
  type Share,
  getShareUrl,
  SharesStats,
  SharesEmptyState,
  SharesTable,
} from "@/components/shares";
import { SharesSkeleton } from "@/components/shares/shares-skeleton";

export default function SharesPage() {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [togglingPubliclyListed, setTogglingPubliclyListed] = useState<
    number | null
  >(null);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(
    () => getQueryParamInt("page") ?? 1,
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
  }, []);

  async function fetchShares() {
    setLoading(true);
    try {
      const res = await fetch(API.SHARES);
      if (res.ok) {
        const data = await res.json();
        setShares(data.shares || []);
      }
    } catch (err) {
      console.error("Failed to fetch shares:", err);
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
      }
    } catch (err) {
      console.error("Failed to update public listing:", err);
    } finally {
      setTogglingPubliclyListed(null);
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
      }
    } catch (err) {
      console.error("Failed to revoke share:", err);
    } finally {
      setRevoking(null);
    }
  }

  if (loading) {
    return <SharesSkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="w-full max-w-6xl mx-auto flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-5">
          <div className="pb-2 pt-2 sm:pt-4">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Shared reports
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Anyone with a link below can read that report without logging in.
              Revoke a link and it stops working immediately.
            </p>
          </div>

          {shares.length > 0 && <SharesStats shares={shares} />}

          {shares.length === 0 ? (
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
        </div>
      </main>

      <AlertDialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => {
          if (!open && revoking === null) setConfirmRevoke(null);
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="h-5 w-5 text-destructive shrink-0"
                aria-hidden="true"
              />
              Revoke this shared link?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              The link for{" "}
              <span className="font-medium text-foreground">
                {confirmRevoke?.url}
              </span>{" "}
              stops working immediately. Anyone who already has it, including
              people you sent it to, loses access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmRevoke(null)}
              disabled={revoking !== null}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && revokeShare(confirmRevoke.id)}
              disabled={revoking !== null}
              className="gap-2"
            >
              {revoking !== null && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Revoke
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />

      {selectedShare && (
        <ShareModal
          open={shareModalOpen}
          onOpenChange={setShareModalOpen}
          shareUrl={getShareUrl(selectedShare.token)}
          title={`${APP_NAME} Scan: ${selectedShare.url}`}
        />
      )}
    </div>
  );
}
