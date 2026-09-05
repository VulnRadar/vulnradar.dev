"use client";

import { useState } from "react";
import { PowerOff } from "lucide-react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { HistoryViewTabs } from "@/components/history";
import { DomainsSection } from "@/components/profile/tabs/developer/domains-section";
import { InlineAlert } from "@/components/shared/inline-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { useClientConfig } from "@/lib/hooks/use-client-config";

/**
 * First-class attack-surface view: the caller's verified-domain portfolio. The
 * domain-verification backend (app/api/v3/domains, lib/domains) and its
 * management UI (DomainsSection) already existed but were buried in the profile
 * Developer tab; this surfaces them as their own tab alongside History / Assets
 * / Public Scans, since "the domains you own and monitor" is a distinct,
 * portfolio-level view of your attack surface, not a per-scan one.
 */
export default function AttackSurfacePage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // `loaded` here, unlike the landing entry points: DomainsSection already
  // loads behind its own placeholder, so gating costs no extra shift and the
  // disabled state never flashes where verification is on.
  const { featureDomainVerification, loaded } = useClientConfig();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6"
      >
        <div className="mb-6">
          {/* Tier B page H1: the scale used by every in-app working page
              (history, assets, shares, repos, public scans, profile), where
              the title sits above a dense table and must not eat the fold. */}
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
            Attack surface
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Your verified domain portfolio. Verifying a domain proves you own
            it: a verified apex covers every subdomain beneath it and unlocks
            active probing, authenticated scans, and subdomain discovery across
            those assets.
          </p>
        </div>

        <HistoryViewTabs />

        <div className="mt-6 space-y-3">
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
          {success && <InlineAlert tone="success">{success}</InlineAlert>}
          {loaded && !featureDomainVerification ? (
            <EmptyState
              icon={PowerOff}
              title="Domain verification is turned off"
              description="This deployment runs with domain verification disabled, so there is no portfolio to add to here. Scans still run against any URL you paste."
            />
          ) : (
            <DomainsSection setError={setError} setSuccess={setSuccess} />
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
