import { cn } from "@/lib/ui/utils";

/**
 * Reading rules for docs body text, applied once by DocsSection and
 * DocsSubSection so a page stops restating them per paragraph.
 *
 * Paragraphs and list items inside an <aside> or a <figure> are left alone: a
 * Callout's label is itself a <p> at 12px in the variant's accent colour, and a
 * bare `p` selector repainted it as body copy. `.text-xs` is the same exemption
 * for the captions a page still sets by hand under a block.
 */
export const DOCS_PROSE = cn(
  // Body: 15px at every width, one rhythm, near-foreground.
  "[&_p:not(aside_p,figure_p,.text-xs)]:text-[15px] [&_p:not(aside_p,figure_p,.text-xs)]:leading-relaxed [&_p:not(aside_p,figure_p,.text-xs)]:text-foreground/85",
  "[&_li:not(aside_li,figure_li)]:text-[15px] [&_li:not(aside_li,figure_li)]:leading-relaxed [&_li:not(aside_li,figure_li)]:text-foreground/85",
  // Measure: prose and lists, not tables and code.
  "[&>p]:max-w-[68ch] [&>ul]:max-w-[68ch] [&>ol]:max-w-[68ch] [&>blockquote]:max-w-[68ch]",
  // Lists.
  "[&>ul]:list-disc [&>ol]:list-decimal [&>ul]:pl-5 [&>ol]:pl-5",
  "[&>ul]:space-y-1.5 [&>ol]:space-y-2 [&_li]:marker:text-muted-foreground [&>ol]:marker:tabular-nums",
  // Links in running text are underlined at rest: brand blue alone cannot be
  // told from inline code or emphasis without pointing at it.
  "[&_p_a]:text-primary [&_li_a]:text-primary",
  "[&_p_a]:underline [&_li_a]:underline [&_p_a]:decoration-primary/40 [&_li_a]:decoration-primary/40",
  "[&_p_a]:underline-offset-2 [&_li_a]:underline-offset-2",
  "[&_p_a:hover]:decoration-primary [&_li_a:hover]:decoration-primary",
);

/**
 * Where an anchored heading lands. The root's scroll-padding already clears
 * the site nav, and a scroll-margin adds to it rather than replacing it, so
 * the old scroll-mt-24 put headings 160px down. Below xl the sticky docs bar
 * sits under the nav as well (100px in total), so a heading has to clear that.
 */
export const DOCS_ANCHOR_OFFSET = "scroll-mt-12 xl:scroll-mt-4";

/** "Rate limits & quotas" becomes "rate-limits-quotas". */
export function slugifyHeading(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
