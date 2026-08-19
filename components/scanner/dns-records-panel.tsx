"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { DnsRecords } from "@/lib/scanner/dns-records";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";

interface DnsRecordsPanelProps {
  records?: DnsRecords | null;
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
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
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
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100"
      >
        {copied ? (
          <Check aria-hidden className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

export function DnsRecordsPanel({ records }: DnsRecordsPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

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

  // Absent field (raw IP / unreachable target): render nothing, matching how
  // the response-headers panel bows out when there is nothing to show.
  if (!records || groups.length === 0) return null;

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex-1 text-sm font-medium text-foreground">
          DNS records
        </span>
        <span className="hidden flex-wrap items-center gap-1 sm:flex">
          {groups.map((g) => (
            <span
              key={g.type}
              className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary"
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
          <div className="max-h-96 overflow-auto">
            {groups.map((group) => (
              <div
                key={group.type}
                className="border-b border-border last:border-b-0"
              >
                <div className="sticky top-0 flex items-center gap-2 bg-muted/40 px-4 py-1.5 backdrop-blur">
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
  );
}
