import Image from "next/image";

import { cn } from "@/lib/ui/utils";

/**
 * A screenshot with a caption, framed to match the card grammar the rest of
 * the docs use.
 *
 * The docs (and the whole web surface) shipped no product imagery at all
 * before this: the only finished screenshots in the repo were the extension's
 * store art, which reached Chrome Web Store browsers and nothing else
 * (AUDIT-014#mkt-04). `width`/`height` are the image's real pixel dimensions
 * so the browser reserves the right box before it loads, and the figure is
 * capped at that width rather than stretched, because upscaling a 533px
 * screenshot to a full content column is visibly soft.
 */
interface DocsFigureProps {
  src: string;
  /** What the screenshot SHOWS, not the word "screenshot". */
  alt: string;
  width: number;
  height: number;
  caption: string;
  className?: string;
}

export function DocsFigure({
  src,
  alt,
  width,
  height,
  caption,
  className,
}: DocsFigureProps) {
  return (
    <figure
      className={cn("flex flex-col gap-2", className)}
      style={{ maxWidth: width }}
    >
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="h-auto w-full"
        />
      </div>
      <figcaption className="text-xs leading-relaxed text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}
