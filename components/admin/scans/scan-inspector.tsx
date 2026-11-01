"use client";

import { useEffect, useState } from "react";
import { ScanSearch, ShieldOff } from "lucide-react";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { InlineAlert } from "@/components/shared/inline-alert";
import { StatusPill } from "@/components/admin/shared";
import { formatTimestamp } from "@/components/admin/utils";
import { scanStatusPill } from "@/components/admin/scans/scan-status";
import {
  ScanInspectorHeader,
  ScanInspectorSkeleton,
} from "@/components/admin/scans/scan-inspector-skeleton";
import { SeverityBadge, toSeverity } from "@/components/scanner/severity-badge";
import type { AdminScanDetail } from "@/components/admin/types";
import {
  isEngineFailure,
  isFailureKind,
  type FailureKind,
} from "@/lib/scanner/failure-kinds";
import { pluralize } from "@/lib/ui/plural";
import { API, ROUTES } from "@/lib/config/client-constants";

/** What each failure kind means, in the operator's terms. The short labels
 *  live beside the kinds in lib/scanner/failure-kinds.ts. */
const FAILURE_EXPLANATIONS: Record<FailureKind, string> = {
  cancelled: "The owner pressed Cancel.",
  admin_cancelled: "Staff cancelled it from the scanner queue.",
  quota_refused:
    "A daily or API key limit refused it before anything was attempted.",
  not_run: "It was part of a bulk batch that stopped before reaching this URL.",
  interrupted: "The server restarted while it was running.",
  stale:
    "It stopped reporting progress and the periodic sweep closed it as stuck.",
  timeout: "It ran past its time budget and the watchdog ended it.",
  target_unreachable:
    "The target refused or reset the connection, or its name did not resolve.",
  target_timeout:
    "The target accepted the connection and then never answered in time.",
  target_tls: "The target's TLS certificate or handshake failed.",
  target_redirect_offhost:
    "The target redirected to a different host, which the scanner does not follow.",
  target_blocked: "The target resolved to an address the SSRF guard refuses.",
  internal: "The engine failed on something it should have handled.",
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 120) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/** Started to finished on the wall clock, which includes time spent queued. */
function wallTimeMs(scan: AdminScanDetail): number | null {
  if (!scan.startedAt || !scan.scannedAt) return null;
  if (scan.status === "pending" || scan.status === "running") return null;
  const ms = Date.parse(scan.scannedAt) - Date.parse(scan.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function metaNumber(
  meta: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metaStrings(
  meta: Record<string, unknown> | null,
  key: string,
): string[] {
  const value = meta?.[key];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** result_meta can carry a whole crawl's page list; the view stops here. */
const RAW_META_CHARS = 20_000;

function rawMeta(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const text = JSON.stringify(meta, null, 2);
  return text.length > RAW_META_CHARS
    ? `${text.slice(0, RAW_META_CHARS)}\n... cut at ${RAW_META_CHARS.toLocaleString()} characters`
    : text;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-32 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">
        {children}
      </dd>
    </div>
  );
}

function Outcome({ scan }: { scan: AdminScanDetail }) {
  const pill = scanStatusPill({
    status: scan.status,
    failure_kind: scan.failureKind,
  });
  const incomplete = metaStrings(scan.resultMeta, "incomplete");
  const kind = isFailureKind(scan.failureKind) ? scan.failureKind : null;
  const wall = wallTimeMs(scan);

  return (
    <section
      aria-labelledby="scan-outcome"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="scan-outcome"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          What happened
        </h2>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </div>

      {scan.status === "failed" && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-foreground leading-relaxed">
            {kind
              ? FAILURE_EXPLANATIONS[kind]
              : "No failure reason was recorded for this row, so it is counted as an engine failure."}{" "}
            <span className="text-muted-foreground">
              {isEngineFailure(scan.failureKind)
                ? "It counts toward engine health."
                : "It does not count toward engine health: the owner, a limit or the target ended it."}
            </span>
          </p>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Stored error</p>
            {scan.errorMessage ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">
                {scan.errorMessage}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                The row has no error text.
              </p>
            )}
          </div>
        </div>
      )}

      {scan.status === "completed" && (
        <p className="mt-3 text-sm text-foreground leading-relaxed">
          Finished with {pluralize(scan.findingsCount, "finding")}
          {wall !== null ? ` in ${formatMs(wall)} on the clock` : ""}
          {scan.durationMs > 0
            ? `, ${formatMs(scan.durationMs)} of engine time`
            : ""}
          .
        </p>
      )}

      {scan.progress && (
        <p className="mt-3 text-sm text-foreground leading-relaxed">
          {scan.progress.total > 0
            ? `${scan.progress.completed} of ${pluralize(scan.progress.total, "category", "categories")} done`
            : "No category has started yet"}
          {scan.progress.currentCategory
            ? `, working on ${scan.progress.currentCategory}`
            : ""}
          .
        </p>
      )}

      {incomplete.length > 0 && (
        <div className="mt-3">
          <InlineAlert tone="warning" title="Parts of this scan did not run">
            <p className="font-mono text-xs break-words">
              {incomplete.join(", ")}
            </p>
          </InlineAlert>
        </div>
      )}
    </section>
  );
}

function Findings({ scan }: { scan: AdminScanDetail }) {
  return (
    <section
      aria-labelledby="scan-findings"
      className="rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 px-4 py-3 sm:px-5">
        <h2
          id="scan-findings"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          Findings
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {scan.findingsTruncated
            ? `First ${scan.findings.length} of ${scan.findingsCount}`
            : pluralize(scan.findingsCount, "finding")}
        </p>
      </div>
      {scan.findings.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
          {scan.status === "completed"
            ? "This scan reported nothing."
            : "No findings are stored on this row."}
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {scan.findings.map((finding, index) => (
            <li key={`${finding.id}-${index}`} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <SeverityBadge severity={toSeverity(finding.severity)} />
                <p className="min-w-0 break-words text-sm font-medium text-foreground">
                  {finding.title}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{finding.id || "no id"}</span>
                {finding.category ? ` · ${finding.category}` : ""}
                {finding.cwe ? ` · ${finding.cwe}` : ""}
                {finding.confidence !== null
                  ? ` · ${finding.confidence}% confidence`
                  : ""}
              </p>
              {finding.evidence && (
                <details className="mt-1.5">
                  <summary className="inline-block cursor-pointer py-1 text-xs text-primary rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                    Evidence
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-muted/40 p-3 font-mono text-xs text-foreground">
                    {finding.evidence}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Facts({ scan }: { scan: AdminScanDetail }) {
  const wall = wallTimeMs(scan);
  return (
    <section
      aria-labelledby="scan-facts"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <h2
        id="scan-facts"
        className="text-base font-semibold tracking-tight text-foreground"
      >
        The row
      </h2>
      <dl className="mt-1 divide-y divide-border/50">
        <Fact label="Target">
          <span className="font-mono text-xs break-all">{scan.url}</span>
        </Fact>
        <Fact label="Owner">
          {scan.user.email ? (
            <a
              href={`${ROUTES.ADMIN}?tab=users&user=${scan.user.id}`}
              className="-my-1 inline-block rounded-sm py-1 text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {scan.user.name || scan.user.email}
            </a>
          ) : (
            <span className="font-mono text-xs">user #{scan.user.id}</span>
          )}
          {scan.user.email && scan.user.name && (
            <span className="block break-all font-mono text-xs text-muted-foreground">
              {scan.user.email}
            </span>
          )}
        </Fact>
        <Fact label="Source">
          {scan.source}, {scan.scanType} scan
          {scan.authenticated ? ", authenticated" : ""}
        </Fact>
        <Fact label="Started">
          {scan.startedAt
            ? formatTimestamp(scan.startedAt, true)
            : "Not recorded"}
        </Fact>
        <Fact label="Finished">
          {scan.status === "pending" || scan.status === "running"
            ? "Still in flight"
            : scan.scannedAt
              ? formatTimestamp(scan.scannedAt, true)
              : "Not recorded"}
        </Fact>
        <Fact label="Wall time">
          {wall !== null ? formatMs(wall) : "Not available"}
        </Fact>
        <Fact label="Engine time">
          {scan.durationMs > 0 ? formatMs(scan.durationMs) : "Not recorded"}
        </Fact>
        <Fact label="Visibility">
          {scan.isPublic === false ? "Private" : "Public"}
        </Fact>
        <Fact label="Ids">
          <span className="block font-mono text-xs">#{scan.id}</span>
          {scan.publicId && (
            <span className="block break-all font-mono text-xs text-muted-foreground">
              {scan.publicId}
            </span>
          )}
        </Fact>
      </dl>
    </section>
  );
}

function Meta({ scan }: { scan: AdminScanDetail }) {
  const checksRun = metaNumber(scan.resultMeta, "checksRun");
  const dangerScore = metaNumber(scan.resultMeta, "dangerScore");
  const confidence = metaNumber(scan.resultMeta, "engineConfidence");
  const raw = rawMeta(scan.resultMeta);

  return (
    <section
      aria-labelledby="scan-meta"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <h2
        id="scan-meta"
        className="text-base font-semibold tracking-tight text-foreground"
      >
        Result metadata
      </h2>
      {scan.resultMeta === null ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing is stored here. A scan that never finished writes none.
        </p>
      ) : (
        <>
          <dl className="mt-1 divide-y divide-border/50">
            <Fact label="Checks run">{checksRun ?? "Not recorded"}</Fact>
            <Fact label="Danger score">{dangerScore ?? "Not recorded"}</Fact>
            <Fact label="Engine confidence">
              {confidence !== null ? `${confidence}%` : "Not recorded"}
            </Fact>
          </dl>
          <details className="mt-2">
            <summary className="inline-block cursor-pointer py-1 text-xs text-primary rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              Raw result_meta
            </summary>
            <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-muted/40 p-3 font-mono text-xs text-foreground">
              {raw}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "missing" }
  | { kind: "failed" }
  | { kind: "ready"; scan: AdminScanDetail };

export function ScanInspector({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState({ kind: "loading" });
      try {
        const res = await fetch(API.ADMIN_SCAN(id));
        if (cancelled) return;
        if (res.status === 403) {
          setState({ kind: "forbidden" });
          return;
        }
        if (res.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "failed" });
          return;
        }
        const data = (await res.json()) as { scan: AdminScanDetail };
        setState({ kind: "ready", scan: data.scan });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <AppPageShell padding="py-8">
      <ScanInspectorHeader />

      {state.kind === "loading" && <ScanInspectorSkeleton />}

      {state.kind === "forbidden" && (
        <EmptyState
          icon={ShieldOff}
          tone="error"
          title="Access denied"
          description="Your role cannot look at other accounts' scans."
          className="py-24"
        />
      )}

      {state.kind === "missing" && (
        <EmptyState
          icon={ScanSearch}
          title="Scan not found"
          description="The id is wrong, or the scan was deleted. A deleted scan leaves nothing to inspect."
          className="py-24"
        />
      )}

      {state.kind === "failed" && (
        <InlineAlert title="Couldn't load this scan">
          The request failed. Reload the page to try again.
        </InlineAlert>
      )}

      {state.kind === "ready" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 space-y-6">
            <Outcome scan={state.scan} />
            <Findings scan={state.scan} />
          </div>
          <div className="min-w-0 space-y-6">
            <Facts scan={state.scan} />
            <Meta scan={state.scan} />
          </div>
        </div>
      )}
    </AppPageShell>
  );
}
