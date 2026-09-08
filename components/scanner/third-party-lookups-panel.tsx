"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Globe } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { focus } from "@/lib/ui/animations";
import {
  resolveLookups,
  LOOKUP_GROUPS,
  type ResolvedLookup,
} from "@/lib/scanner/third-party-lookups";

/**
 * "Look this up elsewhere": deep links to third-party reputation and analysis
 * services for the scanned target.
 *
 * Every one of these is a link and nothing else. No request leaves this app,
 * no API key exists, and no verdict is stored: the reader clicks and their own
 * browser goes to VirusTotal. That is a deliberate design, not a shortcut. An
 * integration would mean paying per lookup for other people's targets,
 * submitting those targets to a third party under our account without anyone
 * agreeing to it, and caching an opinion about somebody's site that goes stale
 * and then gets served as though it were current. A link has none of those
 * properties and is honest about where the answer comes from.
 *
 * Collapsed by default and rendered last among the panels, because it is the
 * one section that answers a question the scan did not: everything above it is
 * what we found, and this is where to go next.
 */
export function ThirdPartyLookupsPanel({ url }: { url: string }) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const lookups = useMemo(() => resolveLookups(url), [url]);

  // Nothing to offer for a private or non-routable target, and sending one to
  // a third party would publish an internal address as a side effect of a
  // click that could not have told the reader anything.
  if (lookups.length === 0) return null;

  const grouped = LOOKUP_GROUPS.map((group) => ({
    ...group,
    services: lookups.filter((l) => l.group === group.id),
  })).filter((g) => g.services.length > 0);

  return (
    <div className="rounded-xl border border-border/50 bg-card/50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl p-4 text-left sm:p-5",
          "transition-colors hover:bg-muted/30",
          focus.ring,
        )}
      >
        <Globe aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            Look this up elsewhere
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {lookups.length} third-party services, opened in your browser. We
            send them nothing and store nothing.
          </span>
        </span>
        {expanded ? (
          <ChevronDown
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
        )}
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border/50 p-4 sm:p-5">
          <div className="space-y-6">
            {grouped.map((group) => (
              <section key={group.id}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h4>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  {group.blurb}
                </p>
                <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {group.services.map((service) => (
                    <LookupLink key={service.id} service={service} />
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="mt-6 border-t border-border/50 pt-4 text-xs leading-relaxed text-muted-foreground">
            Marked services fetch the target themselves when you open them, so
            the visit appears in that site&apos;s logs as traffic you caused.
            Fine on your own property, worth thinking about on somebody
            else&apos;s.
          </p>
        </div>
      )}
    </div>
  );
}

function LookupLink({ service }: { service: ResolvedLookup }) {
  return (
    <li>
      <a
        href={service.href}
        target="_blank"
        // noreferrer as well as noopener: the referrer would tell the service
        // which scan result the reader came from, and a scan URL is not ours
        // to hand out.
        rel="noopener noreferrer nofollow"
        className={cn(
          "flex h-full gap-2.5 rounded-lg border border-border/50 bg-background/40 p-3",
          "transition-colors hover:border-primary/40 hover:bg-muted/40",
          focus.ring,
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {service.name}
            {service.visitsTarget && (
              <span
                title="This service fetches the target itself"
                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
              >
                visits
              </span>
            )}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {service.description}
          </span>
        </span>
        {/* <LeadingIcon>, not a hand-written mt-0.5. 2px is right for exactly
            one icon-and-text pairing and this is not it; the component
            computes the offset from the line box instead. */}
        <LeadingIcon
          icon={ExternalLink}
          size="sm"
          line="sm"
          className="text-muted-foreground"
        />
      </a>
    </li>
  );
}
