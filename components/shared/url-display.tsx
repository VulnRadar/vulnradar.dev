// No "use client": nothing here uses a hook or an event handler, so the module
// stays usable from a server component as well as from the client pages that
// import it. parseUrl in particular is called from both.
import { cn } from "@/lib/ui/utils";

export interface ParsedUrl {
  subdomain: string | null;
  host: string;
  path: string;
  /** hostname + path, i.e. the whole thing minus the scheme. */
  full: string;
}

/**
 * Split a scanned URL into the three parts the app displays it as. Treated as
 * a subdomain only at 3+ labels (sub.example.com), which is deliberately naive
 * about multi-part public suffixes (example.co.uk reads as sub "example"); it
 * only affects which half of the name is emphasised, never what is shown.
 */
export function parseUrl(url: string): ParsedUrl {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname + (u.search || "");
    const parts = u.hostname.split(".");
    const subdomain = parts.length > 2 ? parts[0] : null;
    const host = subdomain ? parts.slice(1).join(".") : u.hostname;
    return { subdomain, host, path, full: u.hostname + path };
  } catch {
    return { subdomain: null, host: url, path: "", full: url };
  }
}

interface UrlDisplayProps {
  url: string;
  className?: string;
  size?: "sm" | "md";
}

/**
 * One scanned URL, rendered with the hostname carrying the emphasis and the
 * path muted behind it. The single renderer for /badge, /compare and anywhere
 * else that lists scans by URL.
 *
 * The shrink rule is the whole point of this component. Each of the three
 * call sites used to cap the parts individually (`max-w-[50px]` on the
 * subdomain, and so on), which truncated the subdomain first even when there
 * was room to spare: three scans of sandbox/staging/www on the same host all
 * rendered as "sandbo…vulnradar.dev/landing", losing the one part that told
 * them apart. The hostname is one unbreakable unit here and the path carries
 * the shrink weight, so space is taken from the least identifying end first
 * and the hostname only clips once the path has nothing left to give.
 */
export function UrlDisplay({ url, className, size = "sm" }: UrlDisplayProps) {
  const { subdomain, host, path } = parseUrl(url);
  const textSize = size === "md" ? "text-sm" : "text-xs";

  return (
    <span
      className={cn(
        "flex items-baseline gap-0 min-w-0 max-w-full font-mono",
        textSize,
        className,
      )}
      title={url}
    >
      <span className="min-w-0 shrink truncate">
        {subdomain && (
          <span className="text-muted-foreground">{subdomain}.</span>
        )}
        <span className="font-medium">{host}</span>
      </span>
      {path && (
        <span className="min-w-0 shrink-[999] truncate text-muted-foreground/70">
          {path}
        </span>
      )}
    </span>
  );
}
