"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Globe, Loader2 } from "lucide-react";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { DomainControlPanel } from "@/components/domains/domain-control-panel";
import { InlineAlert } from "@/components/shared/inline-alert";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { Button } from "@/components/ui/button";
import { API, ROUTES } from "@/lib/config/client-constants";

/**
 * A verified domain's own page.
 *
 * DomainControlPanel is ~400 lines: a list of every scan of this domain that
 * anyone has published, per-scan unpublish and share-revoke actions, a block
 * switch, and two confirmations. It was rendered inside a disclosure in a row
 * of a list, inside a tab, inside the profile page. Opening it pushed every
 * row below it down by the height of a page, and the controls it holds are the
 * ones an owner reaches for deliberately rather than glances at, which is what
 * a page is for and a disclosure is not.
 *
 * The panel itself is unchanged and still the only implementation: this is a
 * frame around it, not a second copy of it.
 */

interface DomainRow {
  id: number;
  domain: string;
  status: string;
  verified_at: string | null;
  last_check_error: string | null;
}

export default function DomainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const domainId = Number(id);

  // Derived, not state: whether the URL segment is even a domain id is known
  // during render, so storing it would mean an effect whose only job is to
  // set state from something it already had.
  const validId = Number.isInteger(domainId) && domainId > 0;

  const [domain, setDomain] = useState<DomainRow | null>(null);
  const [loading, setLoading] = useState(validId);
  const [missing, setMissing] = useState(false);
  const notFound = !validId || missing;

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    // Read from the list rather than a per-id endpoint, which does not exist.
    // The list is already scoped to domains this account owns or shares a team
    // with, so an id that is not in it is one this caller may not see, and
    // "not found" is the right answer for both cases: it does not tell a
    // stranger whether the id exists.
    (async () => {
      try {
        const res = await fetch(API.DOMAINS);
        if (!res.ok) {
          if (!cancelled) setMissing(true);
          return;
        }
        const data = await res.json();
        const match = (data.domains ?? []).find(
          (d: DomainRow) => d.id === domainId,
        );
        if (cancelled) return;
        if (!match) setMissing(true);
        else setDomain(match);
      } catch {
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domainId, validId]);

  // /attack-surface, not the Developer tab: the domains list moved there,
  // and the developer tab keeps only a pointer for old ?dtab=domains links.
  const backHref = ROUTES.ATTACK_SURFACE;

  return (
    <AppPageShell maxWidth="max-w-4xl" padding="py-8 sm:py-10">
      {/* The way back is at the top, before the content, so it is reachable
          without scrolling past a long scan list to find it. */}
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Attack surface
      </Link>

      <header className="mt-4 mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
            {loading ? "Domain" : (domain?.domain ?? "Domain")}
          </h1>
          {domain?.status === "verified" && (
            <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              Verified
            </span>
          )}
        </div>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          Scans of this domain that other people have published, and whether
          they stay published. Verifying proved you own it; this is what that
          ownership lets you do about everyone else&apos;s scans.
        </p>
        {domain?.verified_at && (
          <p className="mt-1 text-xs text-muted-foreground">
            Verified {new Date(domain.verified_at).toLocaleDateString()}
          </p>
        )}
      </header>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading this domain
        </p>
      ) : notFound ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <InlineAlert tone="error" title="We could not find that domain">
            It may have been removed, or it belongs to another account.
          </InlineAlert>
          <Button asChild variant="outline" className="mt-4">
            <Link href={backHref}>Back to attack surface</Link>
          </Button>
        </div>
      ) : domain?.status !== "verified" ? (
        // The controls below all rest on proven ownership, so there is nothing
        // to show until the DNS record is in place. That record, and the
        // Verify now button, stay on the domains list where adding one starts.
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-6">
          <div className="flex items-start gap-3">
            <LeadingIcon icon={Globe} className="text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                This domain is not verified yet
              </p>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                Add the TXT record shown on the attack surface page and verify
                it. These controls need proof you own the domain, because they
                change what other people&apos;s scans of it can show.
              </p>
              {domain?.last_check_error && (
                <p className="mt-2 text-xs text-destructive">
                  {domain.last_check_error}
                </p>
              )}
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href={backHref}>Go to attack surface</Link>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        // A page, not a row: the panel's default chrome is a top border and a
        // tinted ground meant for the expanded half of a list item.
        <DomainControlPanel
          domainId={domainId}
          domain={domain.domain}
          className="rounded-xl border border-border bg-card p-5 sm:p-6"
        />
      )}
    </AppPageShell>
  );
}
