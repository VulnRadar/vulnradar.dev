"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/utils";
import { useDocsContext } from "./docs-context";
import { DOCS_RAIL_SLOT_ID } from "./docs-toc";

interface DocsRelatedProps {
  /** Where this lives in the app, usually a DocsUiPath. */
  app?: ReactNode;
  /** The reference cards, or the sentence saying there is no public API. */
  api?: ReactNode;
  /** The settings that move it on your own instance. */
  settings?: ReactNode;
}

const noSubscribe = () => () => {};
const findRailSlot = () => document.getElementById(DOCS_RAIL_SLOT_ID);
const noRailSlot = () => null;

function Rows({
  rows,
  compact,
}: {
  rows: [string, ReactNode][];
  compact?: boolean;
}) {
  return (
    <dl className={cn("divide-y divide-border/50", compact && "text-[13px]")}>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className={cn(
            "py-2",
            !compact &&
              "flex min-h-11 flex-col justify-center gap-0.5 sm:flex-row sm:items-center sm:justify-start sm:gap-3",
          )}
        >
          <dt
            className={cn(
              "shrink-0 text-[13px] text-muted-foreground",
              !compact && "sm:w-32",
            )}
          >
            {label}
          </dt>
          <dd className="min-w-0 text-[13px] leading-relaxed text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "Where in the app / In the API / For self-hosters", so the three readers who
 * land on the same feature page each see their link before scrolling.
 *
 * Rendered under the hero, and portalled to the top of the right rail where
 * that column exists. The rail is the shell's and this is a page's child, so
 * the portal is the only way across; the slot exists only after mount, which is
 * why the rail copy is the second one rather than the only one.
 */
export function DocsRelated({ app, api, settings }: DocsRelatedProps) {
  const { tocItems } = useDocsContext();
  const slot = useSyncExternalStore(noSubscribe, findRailSlot, noRailSlot);

  const rows = (
    [
      ["In the app", app],
      ["In the API", api],
      ["For self-hosters", settings],
    ] as [string, ReactNode][]
  ).filter(([, value]) => Boolean(value));
  if (rows.length === 0) return null;

  return (
    <>
      <div
        className={cn(
          "border-y border-border/50",
          tocItems.length > 0 && "xl:hidden",
        )}
      >
        <Rows rows={rows} />
      </div>
      {slot &&
        createPortal(
          <div className="mb-6">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Related
            </p>
            <Rows rows={rows} compact />
          </div>,
          slot,
        )}
    </>
  );
}
