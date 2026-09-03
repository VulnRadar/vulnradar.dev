"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Network } from "lucide-react";
import type { DnsRecords } from "@/lib/scanner/dns-records";
import { API } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { PREMIUM_FEATURES } from "@/components/modals/premium-upgrade-modal";
import {
  PanelActionBar,
  PanelNotRunRow,
  PanelRefreshError,
  usePanelRefresh,
} from "./panel-refresh";

/**
 * Matches lib/scanner/dns-records.ts RECORDS_TTL_MS: a refresh within this
 * window returns the cached resolve, so "Available to refresh in Xm" tells the
 * user when a genuinely fresh lookup is next available.
 */
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

interface DnsRecordsPanelProps {
  records?: DnsRecords | null;
  /**
   * Owner-only: the scan id whose DNS this panel can re-resolve. When set (and
   * not the shared/read-only view), a small refresh control re-resolves the
   * records for this scan and updates the panel in place. Omitted on the
   * shared page.
   */
  scanId?: string | number | null;
  /** Called with the fresh records after a successful refresh so the parent
   *  can update its copy of the result in place. */
  onRefreshed?: (records: DnsRecords) => void;
}

interface RecordRow {
  /** Verbatim value to display and copy. */
  value: string;
  /** MX preference, SOA has none, etc. Shown as a small leading badge. */
  priority?: number;
}

interface RecordGroup {
  type: string;
  rows: RecordRow[];
}

/** A single monospace value with a copy affordance revealed on hover. */
function ValueRow({ row }: { row: RecordRow }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyToClipboard(row.value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="group/row flex items-center gap-2 px-4 py-1.5">
      {typeof row.priority === "number" && (
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          {row.priority}
        </span>
      )}
      <code className="min-w-0 flex-1 whitespace-pre font-mono text-xs text-foreground">
        {row.value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy value"}
        // Hover-gated from sm up only: a touch device never produces hover, so
        // below that the copy button was permanently invisible. It also gets a
        // larger tap target on the phone layout.
        className="shrink-0 rounded-md p-2.5 sm:p-1 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover/row:opacity-100"
      >
        {copied ? (
          <Check
            aria-hidden
            className="h-3.5 w-3.5 text-[hsl(var(--success))]"
          />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

export function DnsRecordsPanel({
  records,
  scanId,
  onRefreshed,
}: DnsRecordsPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  // Same premium gate as the subdomain refresh: staff always pass, everyone
  // else needs the dns_refetch plan (Pro). A free user gets the upgrade modal
  // instead of a silent 402 from the route. See panel-refresh.tsx.
  const refresh = usePanelRefresh<DnsRecords>({
    scanId,
    endpoint: API.SCAN_REFRESH_DNS,
    responseKey: "dnsRecords",
    feature: PREMIUM_FEATURES.dns_refetch,
    failureMessage: "Could not refresh DNS records.",
    onRefreshed,
  });

  const groups = useMemo<RecordGroup[]>(() => {
    if (!records) return [];
    const out: RecordGroup[] = [];

    const pushStrings = (type: string, values: string[]) => {
      if (values.length > 0) {
        out.push({ type, rows: values.map((value) => ({ value })) });
      }
    };

    pushStrings("A", records.a);
    pushStrings("AAAA", records.aaaa);
    pushStrings("CNAME", records.cname);
    if (records.mx.length > 0) {
      out.push({
        type: "MX",
        rows: records.mx.map((m) => ({
          value: m.exchange,
          priority: m.priority,
        })),
      });
    }
    pushStrings("NS", records.ns);
    pushStrings("TXT", records.txt);
    pushStrings("CAA", records.caa);
    if (records.soa) {
      const s = records.soa;
      out.push({
        type: "SOA",
        rows: [
          { value: `primary: ${s.nsname}` },
          { value: `hostmaster: ${s.hostmaster}` },
          { value: `serial: ${s.serial}` },
          { value: `refresh: ${s.refresh}s` },
          { value: `retry: ${s.retry}s` },
          { value: `expire: ${s.expire}s` },
          { value: `minttl: ${s.minttl}s` },
        ],
      });
    }
    return out;
  }, [records]);

  // Absent field: the scan read a per-host cache, so a cold cache (or a raw
  // IP / unreachable target) leaves nothing here.
  //
  // Same bug as the port panel: returning null took the fetch control down
  // with the panel, even though POST /api/v3/history/[id]/dns resolves and
  // merges records whether or not any were there before. The one case the
  // control was built for was the one case it could not be reached in. Offer
  // the fetch on the owner's own surfaces (the ones that pass a scanId);
  // /shared and /host still render nothing.
  if (!records || groups.length === 0) {
    if (!refresh.offered) return null;
    return (
      <>
        {refresh.modal}
        <PanelNotRunRow
          icon={Network}
          title="DNS records"
          status="Not fetched"
          actionLabel="Fetch DNS records"
          proLabel="Pro"
          note="Resolves A, AAAA, MX, NS, TXT, CAA and SOA for this host. It is a plain DNS lookup: no scan quota, no live-browser minutes."
          state={refresh}
        />
      </>
    );
  }

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      {refresh.modal}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Network
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
          <span className="flex-1 text-sm font-medium text-foreground">
            DNS records
          </span>
          <span className="hidden flex-wrap items-center gap-1 sm:flex">
            {groups.map((g) => (
              <span
                key={g.type}
                className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary"
              >
                {g.type}
              </span>
            ))}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {total} record{total === 1 ? "" : "s"}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>

        {expanded && (
          <div id={panelId} className="border-t border-border">
            {/* The bar used to be gated on scanId, which hid the hostname AND
                the "Fetched X ago" line from every read-only viewer: a shared
                report showed DNS records with no clue how old they were. The
                freshness line is for everyone; only the button is the owner's. */}
            <PanelActionBar
              state={refresh}
              capturedAt={records.resolvedAt}
              cooldownMs={REFRESH_COOLDOWN_MS}
              refreshTitle="Re-resolve DNS records now"
            >
              <span className="min-w-0 truncate font-mono text-[11px] font-semibold uppercase tracking-wide text-primary">
                {records.hostname}
              </span>
            </PanelActionBar>
            <PanelRefreshError error={refresh.error} />
            <div className="max-h-96 overflow-auto">
              {groups.map((group) => (
                <div
                  key={group.type}
                  className="border-b border-border last:border-b-0"
                >
                  <div className="sticky top-0 flex items-center gap-2 bg-muted/40 px-4 py-1.5 backdrop-blur-sm">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-primary">
                      {group.type}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {group.rows.length}
                    </span>
                  </div>
                  {/* Long values (SPF/DKIM TXT, IPv6) scroll horizontally inside
                    this container so the page body never does. */}
                  <div className="divide-y divide-border/50 overflow-x-auto">
                    {group.rows.map((row, i) => (
                      <ValueRow key={`${group.type}-${i}`} row={row} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
