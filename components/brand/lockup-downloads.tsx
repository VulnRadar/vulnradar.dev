"use client";

import { useState } from "react";
import {
  SOURCE_FILES,
  WORDMARK_COLOURS,
  type LockupLayout,
  type LockupVariant,
} from "@/lib/brand/kit";
import { focus } from "@/lib/ui/animations";
import { cn } from "@/lib/ui/utils";
import { DownloadChip, KitImage } from "./kit-assets";

export interface LockupSlotView {
  width: number;
  height: number;
  layout: LockupLayout;
  files: Record<LockupVariant, { path: string; size: string }>;
}

const OPTIONS: { variant: LockupVariant; label: string; surface: string }[] = [
  {
    variant: "on-dark",
    label: "For dark backgrounds",
    surface: "the app's dark page colour",
  },
  {
    variant: "on-light",
    label: "For light backgrounds",
    surface: "white",
  },
];

/**
 * The lockup downloads, one variant at a time. The preview is drawn from the
 * same SVG sources the PNGs were rasterised from, on the surface that
 * variant is for, so what you see is what the chips below hand you.
 */
export function LockupDownloads({ slots }: { slots: LockupSlotView[] }) {
  const [variant, setVariant] = useState<LockupVariant>("on-dark");
  const option = OPTIONS.find((o) => o.variant === variant)!;

  return (
    <div>
      <div
        role="group"
        aria-label="Lockup variant"
        className="mb-4 inline-flex flex-wrap gap-1 rounded-md border border-border bg-card p-1"
      >
        {OPTIONS.map((o) => (
          <button
            key={o.variant}
            type="button"
            aria-pressed={o.variant === variant}
            onClick={() => setVariant(o.variant)}
            className={cn(
              "min-h-11 rounded-md px-3 text-sm font-medium transition-colors sm:min-h-9",
              o.variant === variant
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              focus.ring,
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <figure className="mb-8">
        {/* `dark` on the dark surface re-points every token inside it at the
            dark theme, so it is the app's real dark page whichever theme the
            visitor is reading in. */}
        <div
          className={cn(
            "grid items-center gap-8 rounded-lg border border-border p-6 sm:p-10 lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)]",
            variant === "on-dark" ? "dark bg-background" : "bg-white",
          )}
        >
          <KitImage
            path={SOURCE_FILES.lockup.horizontal[variant]}
            alt="VulnRadar logo"
            width={553}
            height={100}
            className="h-auto w-full max-w-[34rem]"
          />
          <KitImage
            path={SOURCE_FILES.lockup.stacked[variant]}
            alt="VulnRadar logo, stacked"
            width={240}
            height={165}
            className="mx-auto h-auto w-full max-w-[11rem]"
          />
        </div>
        <figcaption className="mt-3 text-sm text-muted-foreground">
          {option.label}: the wordmark is{" "}
          <span className="font-mono text-foreground">
            {WORDMARK_COLOURS[variant]}
          </span>
          , shown on {option.surface}. The mark is the same in both.
        </figcaption>
      </figure>

      <ul
        aria-label={`Lockup PNGs, ${option.label.toLowerCase()}`}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
      >
        {slots.map((slot) => {
          const file = slot.files[variant];
          const layout = slot.layout === "stacked" ? "Stacked" : "Horizontal";
          return (
            <li key={`${slot.width}x${slot.height}`}>
              <DownloadChip
                path={file.path}
                label={`${slot.width} × ${slot.height}`}
                detail={`${layout}, ${file.size}`}
                title={`Lockup ${option.label.toLowerCase()}, ${slot.width} by ${slot.height} PNG, ${file.size}`}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
