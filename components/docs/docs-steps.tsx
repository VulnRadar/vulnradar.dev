import type { ReactNode } from "react";
import { cn } from "@/lib/ui/utils";
import { DOCS_ANCHOR_OFFSET, DOCS_PROSE, slugifyHeading } from "./docs-prose";
import type { Step } from "./docs-types";

interface DocsStepProps {
  title: string;
  /** Defaults to a slug of the title, which stays put if a step is reordered. */
  id?: string;
  children: ReactNode;
}

/**
 * One numbered step. The number is a CSS counter on the <ol>, so it needs
 * nothing from the parent and a step can sit behind a condition or a fragment.
 *
 * The -ml-12 cancels the 32px indent (w-5 number column plus gap-3) and the
 * 16px page gutter, so a code block inside a step reaches the screen edge the
 * way one outside a step does.
 */
export function DocsStep({ title, id, children }: DocsStepProps) {
  return (
    <li className="flex gap-3 [counter-increment:docs-step]">
      <span
        aria-hidden="true"
        className="w-5 shrink-0 text-[15px] font-semibold leading-relaxed text-primary tabular-nums before:content-[counter(docs-step)_'.']"
      />
      <div
        className={cn(
          "min-w-0 flex-1 space-y-3 text-[15px] leading-relaxed text-foreground/85 max-sm:[&_figure]:-ml-12",
          DOCS_PROSE,
        )}
      >
        <h3
          id={id ?? slugifyHeading(title)}
          className={cn(
            DOCS_ANCHOR_OFFSET,
            "text-base sm:text-[17px] font-semibold tracking-tight text-foreground",
          )}
        >
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

/**
 * A real ordered list. Numbers in circle badges look like a diagram and read
 * like one too: the reader has to work out that the items are sequential. An
 * <ol> says it outright and survives copy-paste.
 *
 * No "use client": this is markup with no state, effect or handler, so on a
 * docs page that is a server component it renders to HTML and ships no script.
 *
 * `steps` is the old data-only form, kept for one release while its call sites
 * move to <DocsStep> children.
 *
 * The ! classes are because a list directly inside a DocsSection also matches
 * the prose list rules, whose indent, measure and 8px rhythm are for sentences.
 */
export function DocsSteps({
  steps,
  children,
  className,
}: {
  steps?: Step[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "max-w-none! space-y-8! pl-0! [counter-reset:docs-step]",
        className,
      )}
    >
      {steps?.map((item) => (
        <DocsStep key={item.step} title={item.title}>
          <p>{item.description}</p>
        </DocsStep>
      ))}
      {children}
    </ol>
  );
}
