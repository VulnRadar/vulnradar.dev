"use client";

import { useId, useState } from "react";
import { ChevronDown, Boxes, ShieldAlert } from "lucide-react";
import type {
  SoftwareInventoryEntry,
  SoftwareInventorySummary,
  SoftwareCategory,
} from "@/lib/scanner/software-inventory";
import { cn } from "@/lib/ui/utils";

interface SoftwareInventoryPanelProps {
  softwareInventory?: SoftwareInventorySummary | null;
}

/**
 * "Software inventory" panel: the components the scan fingerprinted for this
 * host (lib/scanner/software-inventory.ts), each with its category, source,
 * and -- for a version-bearing, catalogued item -- a CVE verdict from
 * version-to-CVE correlation. Read-only and collapsible, mirroring the
 * threat-intel / port-scan panels. A version with known CVEs also raises a
 * real finding in the list above; this panel is the structured "what is this
 * host running" companion.
 *
 * Renders nothing when there is no inventory, exactly like the DNS / port /
 * threat-intel panels do when their capture was absent.
 */
export function SoftwareInventoryPanel({
  softwareInventory,
}: SoftwareInventoryPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  if (!softwareInventory || softwareInventory.items.length === 0) return null;

  const { items, itemCount, vulnerableCount } = softwareInventory;
  const headline =
    vulnerableCount > 0
      ? `${vulnerableCount} with known CVEs`
      : `${itemCount} detected`;

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
          Software inventory
        </span>
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            vulnerableCount > 0
              ? "text-[hsl(var(--severity-high))]"
              : "text-muted-foreground",
          )}
        >
          {headline}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {itemCount} component{itemCount === 1 ? "" : "s"}
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
          <div className="sticky top-0 flex items-center gap-2 bg-muted/40 px-4 py-1.5 backdrop-blur">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-primary">
              {softwareInventory.host}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {vulnerableCount > 0
                ? `${vulnerableCount} component(s) run a version with known CVEs`
                : "no version-to-CVE match on the components checked"}
            </span>
          </div>

          <div className="divide-y divide-border/50">
            {items.map((item) => (
              <InventoryRow
                key={`${item.name}@${item.version ?? ""}`}
                item={item}
              />
            ))}
          </div>

          <p className="border-t border-border px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Fingerprinted from the response headers and page markup this scan
            already had. Only version-bearing components in a known catalog are
            correlated to CVEs; a component shown without a CVE verdict was
            listed but not looked up. Confirm each CVE applies to your build:
            some vendors backport fixes without changing the version string.
          </p>
        </div>
      )}
    </div>
  );
}

function InventoryRow({ item }: { item: SoftwareInventoryEntry }) {
  const vulnerable = item.cveStatus === "vulnerable" && item.cve;
  return (
    <div className="flex items-start gap-2.5 px-4 py-2">
      {vulnerable ? (
        <ShieldAlert
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--severity-high))]"
        />
      ) : (
        <Boxes
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium text-foreground">
            {item.name}
          </span>
          {item.version && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {item.version}
            </span>
          )}
          <span className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {CATEGORY_LABEL[item.category]}
          </span>
          {vulnerable && (
            <span
              className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium"
              style={{
                borderColor: `hsl(var(--severity-${item.cve!.severity}) / 0.35)`,
                backgroundColor: `hsl(var(--severity-${item.cve!.severity}) / 0.12)`,
                color: `hsl(var(--severity-${item.cve!.severity}))`,
              }}
            >
              {item.cve!.count} CVE{item.cve!.count === 1 ? "" : "s"}
              {" · "}
              {item.cve!.severity}
            </span>
          )}
          {item.cveStatus === "clean" && (
            <span className="text-[10px] font-medium text-[hsl(var(--success))]">
              no known CVEs
            </span>
          )}
          {item.cveStatus === "unknown" && (
            <span className="text-[10px] font-medium text-muted-foreground">
              not checked
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {item.source}
          {vulnerable && item.cve!.cveIds.length > 0
            ? ` · ${item.cve!.cveIds.slice(0, 6).join(", ")}${
                item.cve!.count > item.cve!.cveIds.slice(0, 6).length
                  ? ", ..."
                  : ""
              } (${item.cve!.source})`
            : ""}
        </p>
      </div>
    </div>
  );
}

const CATEGORY_LABEL: Record<SoftwareCategory, string> = {
  server: "server",
  language: "language",
  runtime: "runtime",
  framework: "framework",
  cms: "CMS",
  cdn: "CDN",
  library: "library",
};
