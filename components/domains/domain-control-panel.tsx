"use client";

import { useEffect, useState } from "react";
import {
  Ban,
  ExternalLink,
  EyeOff,
  Link2Off,
  Loader2,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SeverityPill } from "@/components/history/severity-pill";
import { API, ROUTES, SEVERITY_ORDER } from "@/lib/config/client-constants";
import { formatRelativeTime } from "@/lib/ui/relative-time";
import { pluralize } from "@/lib/ui/plural";
import { cn } from "@/lib/ui/utils";

/**
 * What a verified domain owner can do about scans of their domain.
 *
 * Verification already unlocked the intrusive capabilities. It said nothing
 * about the scans OTHER accounts run: anyone could point VulnRadar at your
 * site, publish the result, and it appeared on /public-scans and on
 * /host/<your domain> with your findings in it, with no list you could see and
 * nothing you could do. This panel is that list and those controls.
 *
 * The boundary it draws, which the copy states rather than leaves implicit: an
 * owner controls EXPOSURE, not other people's data. Unpublishing takes a scan
 * off every public surface and leaves it in its own owner's private history.
 * Nothing here deletes another account's record. See
 * lib/domains/owner-control.ts.
 */

interface DomainScan {
  publicId: string;
  url: string;
  scannedAt: string;
  findingsCount: number;
  summary: Record<string, number>;
  isPublic: boolean;
  hasShareLink: boolean;
  isOwnScan: boolean;
}

interface DomainBlock {
  ruleId: number;
  reason: string | null;
  createdAt: string;
  liftable: boolean;
}

type PendingAction = "unpublish" | "revoke-shares" | "block" | "unblock" | null;

export function DomainControlPanel({
  domainId,
  domain,
}: {
  domainId: number;
  /** The verified name itself, for the link to its public host page. */
  domain: string;
}) {
  const [scans, setScans] = useState<DomainScan[] | null>(null);
  const [block, setBlock] = useState<DomainBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<PendingAction>(null);
  const [confirming, setConfirming] = useState<PendingAction>(null);

  // Bumped to re-run the fetch below. The loader lives inside the effect and
  // is re-triggered by a counter rather than being a useCallback the effect
  // depends on: an effect body may not set state synchronously, and the same
  // shape is what components/profile/tabs/developer/domains-section.tsx (the
  // component this panel opens inside) already uses.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // One await, two requests: the block state and the scan list are
        // independent, and running them in series doubled the wait on a panel
        // that opens inline under a row.
        const [scansRes, blockRes] = await Promise.all([
          fetch(API.DOMAIN_SCANS(domainId)),
          fetch(API.DOMAIN_BLOCK(domainId)),
        ]);
        if (cancelled) return;
        setError(null);
        if (!scansRes.ok) {
          throw new Error("Could not load scans of this domain.");
        }
        const scansData = await scansRes.json();
        if (cancelled) return;
        setScans(Array.isArray(scansData.scans) ? scansData.scans : []);
        if (blockRes.ok) setBlock((await blockRes.json()).block ?? null);
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof Error
            ? e.message
            : "Could not load scans of this domain.",
        );
        setScans([]);
      } finally {
        // `loading` starts true and is never set back to it. On the reload
        // after an action the list is already on screen, and flipping to a
        // spinner would replace what the user is reading with a skeleton in
        // order to tell them the thing they just did worked.
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [domainId, reloadKey]);

  const publicCount = (scans ?? []).filter((s) => s.isPublic).length;
  const sharedCount = (scans ?? []).filter((s) => s.hasShareLink).length;
  const othersCount = (scans ?? []).filter((s) => !s.isOwnScan).length;

  async function runScanAction(action: "unpublish" | "revoke-shares") {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(API.DOMAIN_SCANS(domainId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That did not go through.");
      setNotice(
        action === "unpublish"
          ? `${pluralize(data.affected ?? 0, "scan")} taken out of public view.`
          : `${pluralize(data.affected ?? 0, "share link")} revoked.`,
      );
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  async function toggleBlock(next: "block" | "unblock") {
    setBusy(next);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(API.DOMAIN_BLOCK(domainId), {
        method: next === "block" ? "POST" : "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That did not go through.");
      setBlock(data.block ?? null);
      setNotice(
        next === "block"
          ? "Scanning is switched off for this domain and everything under it."
          : "Scanning is allowed again.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border bg-muted/20 px-4 py-4">
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}

      {/* Blocking first: it is the strongest statement on this panel and the
          one an owner arriving in a hurry is looking for. */}
      <div
        className={cn(
          "rounded-lg border p-3.5",
          block
            ? "border-destructive/30 bg-destructive/5"
            : "border-border bg-card",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="flex min-w-0 flex-1 items-start gap-2.5 text-sm leading-relaxed">
            <LeadingIcon
              icon={block ? ShieldOff : Ban}
              line="relaxed"
              className={block ? "text-destructive" : "text-muted-foreground"}
            />
            <span className="min-w-0">
              <span className="block font-medium text-foreground">
                {block
                  ? "Scanning is switched off for this domain"
                  : "Scanning is allowed"}
              </span>
              <span className="block text-muted-foreground">
                {block
                  ? block.liftable
                    ? "Nobody can scan this domain or any host under it. You put this in place, so you can lift it."
                    : "This block was put in place by staff, so it cannot be lifted here."
                  : "Anyone can run a scan against this domain. Switching it off refuses every scan of it, from every account, including yours."}
              </span>
            </span>
          </p>
          {(!block || block.liftable) && (
            <Button
              size="sm"
              variant={block ? "outline" : "destructive"}
              className="h-9 shrink-0 gap-1.5"
              disabled={busy !== null}
              onClick={() => setConfirming(block ? "unblock" : "block")}
            >
              {busy === "block" || busy === "unblock" ? (
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Ban aria-hidden className="h-3.5 w-3.5" />
              )}
              {block ? "Allow scanning" : "Block scanning"}
            </Button>
          )}
        </div>
      </div>

      {/* The list */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scans anyone can see
          </h4>
          {scans && scans.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={busy !== null || publicCount === 0}
                onClick={() => setConfirming("unpublish")}
              >
                {busy === "unpublish" ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <EyeOff aria-hidden className="h-3.5 w-3.5" />
                )}
                Unpublish all
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={busy !== null || sharedCount === 0}
                onClick={() => setConfirming("revoke-shares")}
              >
                {busy === "revoke-shares" ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2Off aria-hidden className="h-3.5 w-3.5" />
                )}
                Revoke share links
              </Button>
            </div>
          )}
        </div>

        <p className="mb-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
          Every scan of this domain that someone who is not signed in can
          already read: published ones, and ones behind an unlisted share link.
          {othersCount > 0 && (
            <>
              {" "}
              {pluralize(othersCount, "was", "were")} run by another account.
            </>
          )}{" "}
          Taking one out of public view removes it from the public scan feed and
          from this domain&rsquo;s host page. It stays in its own owner&rsquo;s
          private history: this controls who can see a scan of your domain, not
          whether someone else may keep their own record of work they did.
        </p>

        {loading ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            Loading scans of this domain
          </p>
        ) : !scans || scans.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
            Nothing published. No scan of this domain is readable by anyone who
            is not signed in.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="divide-y divide-border/60">
              {scans.map((scan) => (
                <div
                  key={scan.publicId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      title={scan.url}
                      className="truncate font-mono text-xs text-foreground"
                    >
                      {scan.url.replace(/^https?:\/\//, "")}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{formatRelativeTime(scan.scannedAt)}</span>
                      <span aria-hidden>&middot;</span>
                      <span>{pluralize(scan.findingsCount, "finding")}</span>
                      {!scan.isOwnScan && (
                        <>
                          <span aria-hidden>&middot;</span>
                          {/* Never a name or an email: that the scan exists is
                              already public, who ran it is not. */}
                          <span>another account</span>
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {SEVERITY_ORDER.map((s) => (
                      <SeverityPill
                        key={s}
                        severity={s}
                        count={scan.summary[s] ?? 0}
                      />
                    ))}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {scan.isPublic && (
                      <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Public
                      </span>
                    )}
                    {scan.hasShareLink && (
                      <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Shared link
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {scans && scans.length > 0 && (
          <a
            href={ROUTES.HOST(domain)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            See the public host page for this domain
            <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        )}
      </div>

      <ConfirmDialog
        open={confirming === "unpublish"}
        onCancel={() => setConfirming(null)}
        title="Take every published scan of this domain out of public view?"
        description={`This clears the public flag on ${pluralize(publicCount, "scan")}. They come off the public scan feed and off this domain's host page immediately. Each stays in its own owner's private history, and nothing is deleted.`}
        confirmLabel="Unpublish them"
        onConfirm={() => runScanAction("unpublish")}
      />

      <ConfirmDialog
        open={confirming === "revoke-shares"}
        onCancel={() => setConfirming(null)}
        title="Revoke every share link pointing at this domain?"
        description={`${pluralize(sharedCount, "unlisted link")} will stop working straight away, for everyone holding them, including links you created yourself. The scans are not deleted and can be shared again later.`}
        confirmLabel="Revoke them"
        onConfirm={() => runScanAction("revoke-shares")}
      />

      <ConfirmDialog
        open={confirming === "block"}
        onCancel={() => setConfirming(null)}
        title="Switch scanning off for this domain?"
        description="Every scan of this domain and of any host beneath it will be refused, from every account, including your own. Existing results are untouched. You can switch it back on here at any time."
        confirmLabel="Block scanning"
        danger
        onConfirm={() => toggleBlock("block")}
      />

      <ConfirmDialog
        open={confirming === "unblock"}
        onCancel={() => setConfirming(null)}
        title="Allow scanning of this domain again?"
        description="Anyone will be able to run a scan against this domain and publish the result."
        confirmLabel="Allow scanning"
        onConfirm={() => toggleBlock("unblock")}
      />
    </div>
  );
}
