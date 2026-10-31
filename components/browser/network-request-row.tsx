"use client";

import { memo } from "react";
import { cn } from "@/lib/ui/utils";
import type { NetworkRequest } from "@/lib/browserbase/client";
import { sameRequest } from "@/lib/browserbase/viewer-session";

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-[hsl(var(--success))]";
    case "POST":
      return "text-primary";
    case "PUT":
    case "PATCH":
      return "text-[hsl(var(--warning))]";
    case "DELETE":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function statusColor(status: number | undefined, failed?: boolean): string {
  if (failed || status === 0) return "text-destructive";
  if (!status) return "text-muted-foreground/40";
  if (status < 300) return "text-[hsl(var(--success))]";
  if (status < 400) return "text-primary";
  if (status < 500) return "text-[hsl(var(--warning))]";
  return "text-destructive";
}

function statusLabel(status: number | undefined, failed?: boolean): string {
  if (failed || status === 0) return "ERR";
  if (!status) return "...";
  return String(status);
}

/** Short devtools-style resource label from a CDP mimeType. */
function resourceType(mimeType: string | undefined): string {
  if (!mimeType) return "";
  const m = mimeType.toLowerCase();
  if (m.includes("html")) return "doc";
  if (m.includes("javascript") || m.includes("ecmascript")) return "js";
  if (m.includes("css")) return "css";
  if (m.includes("json")) return "json";
  if (m.startsWith("image/")) return "img";
  if (m.includes("font")) return "font";
  if (m.startsWith("video/") || m.startsWith("audio/")) return "media";
  if (m.includes("xml")) return "xml";
  return m.split("/")[1]?.slice(0, 4) ?? "";
}

/**
 * One request in the viewer's network dock.
 *
 * Memoised on what the row draws (sameRequest), not on identity: the dock
 * polls and every poll replaces the whole list with new objects, so a plain
 * memo would never hit. A few hundred rows of mostly unchanged requests were
 * re-rendered on every poll, and, until the countdown moved out of the page,
 * on every second as well.
 *
 * The class helpers live in this file rather than in lib/ because Tailwind's
 * content globs do not scan lib/, and a class that appears nowhere it scans
 * generates no CSS.
 */
function NetworkRequestRowImpl({ req }: { req: NetworkRequest }) {
  const type = resourceType(req.mimeType);
  return (
    // Two lines per request rather than four fixed columns. The path had
    // roughly 170px of a four-column grid and every URL clipped to a stub;
    // here it gets the dock's full width on its own line, with the host and
    // resource type below it.
    <div
      className="border-b border-border/20 px-2.5 py-1.5 hover:bg-muted/25 transition-colors"
      title={req.url}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          className={cn(
            "w-8 shrink-0 text-[10px] font-mono font-semibold",
            methodColor(req.method),
          )}
        >
          {req.method.length > 4 ? req.method.slice(0, 3) : req.method}
        </span>
        <span
          className={cn(
            "w-7 shrink-0 text-[10px] font-mono font-medium tabular-nums",
            statusColor(req.status, req.failed),
          )}
        >
          {statusLabel(req.status, req.failed)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-mono text-foreground/85">
          {req.path}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 min-w-0">
        <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-muted-foreground/70">
          {req.host}
        </span>
        {type && (
          <span className="shrink-0 rounded-md bg-muted px-1 text-[9px] font-mono text-muted-foreground/70">
            {type}
          </span>
        )}
      </div>
    </div>
  );
}

export const NetworkRequestRow = memo(NetworkRequestRowImpl, (prev, next) =>
  sameRequest(prev.req, next.req),
);
