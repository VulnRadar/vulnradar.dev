import { Fragment } from "react";
import Link from "next/link";
import { UI_PATHS, type UiPathKey } from "@/lib/docs/ui-paths";

/**
 * "Profile > Developer > API Keys" as one deep link. The labels come from the
 * table a test checks against the real tabs, which is why the docs do not type
 * them.
 *
 * Each segment is nowrap, so a long path wraps only at a separator. The text
 * colour and no-underline are !important because the prose rules paint and
 * underline every link inside a paragraph, and this is a chip rather than a
 * link in a sentence.
 */
export function DocsUiPath({ to }: { to: UiPathKey }) {
  const { segments, href } = UI_PATHS[to];

  return (
    <Link
      href={href}
      className="inline-flex min-h-6 flex-wrap items-center gap-x-1 rounded-md bg-muted px-1.5 align-middle text-[0.875em] font-medium text-foreground! no-underline! transition-colors hover:bg-muted/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {segments.map((segment, i) => (
        <Fragment key={segment}>
          {i > 0 && <span className="text-muted-foreground">&gt;</span>}
          <span className="whitespace-nowrap">{segment}</span>
        </Fragment>
      ))}
    </Link>
  );
}
