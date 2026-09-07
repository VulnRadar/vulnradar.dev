import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * An icon that sits beside text and lines up with its first line.
 *
 * The JSX half of the `icon-lead` utility in app/globals.css; read the comment
 * there for why the hand-written `items-start` plus `mt-0.5` version was wrong
 * nearly everywhere it appeared.
 *
 * `line` is the size of the text this icon sits next to, and it is what the
 * alignment is computed against. It is a prop rather than something inherited
 * on purpose: an audit of the 43 call sites this replaced found 38 rows that
 * declare their type on the TEXT CHILD and not on the flex row, so a wrapper
 * that inherited would have built its line box from `text-base` (24px) while
 * the text beside it ran at `text-sm` (20px), and landed 3px low. Worse than
 * the hand-written nudge it replaced. Stating the line size here means the
 * result does not depend on what an ancestor five levels up happens to set.
 *
 * The default is the pairing the old `mt-0.5` was tuned for, so a call site
 * that was already correct stays pixel-identical. What changes is the two
 * cases it could never handle: text at a different size, and a row set to
 * `items-center` whose text wraps, where the icon drifted to the middle of the
 * block instead of staying beside line one.
 */
const LINE_BOX = {
  /** 12px text, 16px line. Helper rows, captions, dense meta lines. */
  xs: "text-xs",
  /** 12px text, 19.5px line. A helper row set relaxed. */
  "xs-relaxed": "text-xs leading-relaxed",
  /** 14px text, 20px line. Body copy, and the default. */
  sm: "text-sm",
  /** 14px text, 22.75px line. Body copy set relaxed, e.g. InlineAlert. */
  relaxed: "text-sm leading-relaxed",
  /** 16px text, 24px line. Section intros, card headings. */
  base: "text-base",
  /** 18px text, 28px line. A panel heading with an icon beside it. */
  lg: "text-lg",
} as const;

const ICON_BOX = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
} as const;

export function LeadingIcon({
  icon: Icon,
  size = "md",
  line = "sm",
  className,
}: {
  icon: LucideIcon;
  /** sm = 14px, md = 16px (default), lg = 20px. */
  size?: keyof typeof ICON_BOX;
  /** The type size of the text beside it. Alignment is computed against this. */
  line?: keyof typeof LINE_BOX;
  /** Colour, and nothing else. Sizing and alignment are this component's job. */
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("icon-lead", LINE_BOX[line], className)}>
      <Icon className={ICON_BOX[size]} />
    </span>
  );
}
