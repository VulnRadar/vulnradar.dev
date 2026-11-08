import type { ReactNode } from "react";
import { brandUrl } from "@/lib/brand/kit";
import { BRAND_KIT_HASH } from "@/lib/brand/kit.generated";
import { focus } from "@/lib/ui/animations";
import { cn } from "@/lib/ui/utils";

/**
 * A kit file's URL, carrying the kit's hash. The paths never change, so
 * without it Cloudflare (which caches PNGs and ZIPs at the edge by URL) and
 * the browser keep serving the previous drawing after the logo is redrawn.
 */
export const kitHref = (path: string) =>
  `${brandUrl(path)}?v=${BRAND_KIT_HASH}`;

export const kitFileName = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1);

/**
 * The kit's own files, shown as they are. A plain <img> for the reason
 * ThemedLogo gives: next.config sets images.unoptimized, and most of these
 * are SVGs Next would not touch anyway.
 */
export function KitImage({
  path,
  alt,
  width,
  height,
  className,
}: {
  path: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}) {
  return (
    // oxlint-disable-next-line @next/next/no-img-element
    <img
      src={kitHref(path)}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
}

/**
 * One download. The `download` attribute keeps the file's own name, so the
 * cache-busting query string never ends up in somebody's downloads folder.
 * 44px tall on a phone, the floor for a main action there; 40px above sm.
 *
 * The link's name is the visible label and detail, then `context` for a
 * screen reader: "512 × 512, PNG, 31 KB, the mark". A list label is not link
 * context, so a chip whose label is only a size has to say what it is itself.
 */
export function DownloadChip({
  path,
  label,
  detail,
  context,
}: {
  path: string;
  label: ReactNode;
  detail: string;
  /** What the file is, when the visible label is only a size. */
  context?: string;
}) {
  return (
    <a
      href={kitHref(path)}
      download={kitFileName(path)}
      className={cn(
        "flex min-h-11 flex-col justify-center rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:border-primary/40 hover:bg-primary/5 sm:min-h-10",
        focus.ring,
      )}
    >
      <span className="text-sm font-medium tabular-nums text-foreground">
        {label}
      </span>
      <span className="sr-only">, </span>
      <span className="text-xs text-muted-foreground">{detail}</span>
      {context && <span className="sr-only">, {context}</span>}
    </a>
  );
}

const TILE = {
  base: "tile-base",
  alt: "tile-alt",
  contrast: "tile-contrast",
} as const;

/** A full-bleed band of the page, on one step of the surface ladder. */
export function KitSection({
  id,
  tile,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  tile: keyof typeof TILE;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(TILE[tile], "scroll-mt-20")}
    >
      <div
        className={cn(
          "max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20",
          className,
        )}
      >
        <h2
          id={`${id}-title`}
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4 text-balance"
        >
          {title}
        </h2>
        {intro && (
          <div className="mb-8 max-w-2xl space-y-3 text-muted-foreground leading-relaxed text-pretty">
            {intro}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
