"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Lock, Search, RotateCcw } from "lucide-react";
import { API } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import type { GithubRepo } from "./types";

// lucide-react dropped brand/logo icons; every other brand mark in this
// app (Discord, Slack, and the mark GithubRepoAccessSection/react-icons'
// FaGithub already covers) uses an inline SVG for the same reason. Kept
// as a plain path (not react-icons) here to match the mark this repo list
// used before it moved out of the Developer tab.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97.01 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function formatUpdatedAt(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface GithubRepoPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full names to pre-check when the modal opens -- empty for a first-time
   *  pick, the current working set for "Edit selection". */
  initialSelected: string[];
  /** Persists the selection (PUT /api/v3/account/github/repos) and updates
   *  the caller's displayed list. Throwing keeps the modal open and shows
   *  the error inline; resolving closes it. `repos` is the full fetched
   *  list, handed back so the caller doesn't need to re-fetch it to know
   *  each selected repo's metadata. */
  onConfirm: (selected: string[], repos: GithubRepo[]) => Promise<void>;
}

/**
 * GitHub's own "Install App -> select repositories" screen, adapted: fetch
 * the account's full repo list (can run into the hundreds), show it as a
 * search-filterable checklist, and only send back what's actually checked.
 * Mirrors this app's connect-then-select-what-to-sync modals
 * (components/modals/discord-profile-modal.tsx,
 * components/modals/github-profile-modal.tsx) for tone, but a repo
 * checklist with potentially hundreds of rows needs its own search and
 * bulk-select affordances those two-option modals don't.
 */
export function GithubRepoPickerModal({
  open,
  onOpenChange,
  initialSelected,
  onConfirm,
}: GithubRepoPickerModalProps) {
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const loadRepos = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(API.ACCOUNT_GITHUB_REPOS);
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error || "Failed to load repositories.");
        return;
      }
      setRepos(data.repos);
    } catch {
      setLoadError("Failed to load repositories.");
    }
    setLoading(false);
  };

  // Re-fetch fresh from GitHub every time the modal opens (new repos may
  // have been created since last time) and reset the checklist to
  // whatever the caller says is currently selected.
  useEffect(() => {
    if (!open) return;
    setFilter("");
    setConfirmError(null);
    setSelected(new Set(initialSelected));
    loadRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filteredRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos ?? [];
    return (repos ?? []).filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(q) ||
        (repo.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, filter]);

  const toggle = (fullName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const repo of filteredRepos) next.add(repo.fullName);
      return next;
    });
  };

  const clearAll = () => setSelected(new Set());

  const handleConfirm = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      await onConfirm(Array.from(selected), repos ?? []);
      onOpenChange(false);
    } catch (err) {
      setConfirmError(
        err instanceof Error ? err.message : "Failed to save your selection.",
      );
    } finally {
      setConfirming(false);
    }
  };

  const selectedCount = selected.size;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!confirming) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden gap-0">
        <div className="px-6 pt-6 pb-4 border-b border-border/60">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-foreground flex items-center justify-center shrink-0">
                <GithubIcon className="h-4 w-4 text-background" />
              </div>
              <div className="min-w-0">
                <DialogTitle>Select repositories</DialogTitle>
                <DialogDescription>
                  Pick which repos show up on your Repos page. Change this
                  anytime.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 py-4 flex flex-col gap-3">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search your repos..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Search your GitHub repositories"
              className="pl-9 bg-background"
              disabled={loading || !repos}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {selectedCount} selected
              {repos ? ` of ${repos.length}` : ""}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={selectAllVisible}
                disabled={loading || filteredRepos.length === 0}
                className="font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Select all{filter.trim() ? " matching" : " visible"}
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={selectedCount === 0}
                className="font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border min-h-[16rem] max-h-[45vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center gap-3 h-64 px-6 text-center">
                <p className="text-sm text-destructive">{loadError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadRepos}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="flex items-center justify-center h-64 px-6 text-center text-sm text-muted-foreground">
                {repos && repos.length === 0
                  ? "No repositories found on this account."
                  : `No repos match "${filter}".`}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {filteredRepos.map((repo) => {
                  const checked = selected.has(repo.fullName);
                  return (
                    <label
                      key={repo.fullName}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors",
                        checked ? "bg-primary/5" : "hover:bg-muted/30",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(repo.fullName)}
                        aria-label={`Select ${repo.fullName}`}
                      />
                      {repo.private ? (
                        <Lock
                          className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <GithubIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {repo.fullName}
                        </p>
                        {repo.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {repo.description}
                          </p>
                        )}
                      </div>
                      <span className="hidden sm:inline text-[11px] text-muted-foreground shrink-0 tabular-nums">
                        updated {formatUpdatedAt(repo.updatedAt)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {confirmError && (
            <div
              role="alert"
              className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3"
            >
              <p className="text-sm text-destructive">{confirmError}</p>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/60">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={confirming || loading || !!loadError}
            className="gap-2"
          >
            {confirming && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {selectedCount > 0
              ? `Load ${selectedCount} repo${selectedCount === 1 ? "" : "s"}`
              : "Clear selection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
