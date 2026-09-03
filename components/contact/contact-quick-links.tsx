import Link from "next/link";
import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { ROUTES, SUPPORT_EMAIL } from "@/lib/config/constants";

const INLINE_LINK = cn(
  "text-primary rounded-sm hover:underline underline-offset-4",
  focus.ring,
);

/**
 * The "you might not need to write to us at all" lead.
 *
 * It was three identical label + description + arrow rows under a headline
 * ("Answer might already exist") that was written at caption size and had lost
 * its article. Two of those rows were real destinations; the third put a raw
 * email address in the same slot and the same weight as "Documentation", so
 * the fallback for people who do not want to use a form was presented as a
 * fourth navigation item.
 *
 * It reads as prose now, which is also what stops the page from opening three
 * sections in a row with the same small-caps-ish h2: this is a sentence, the
 * category picker below is a panel, and the form below that is a card. Three
 * different weights, in the order they matter.
 */
export function ContactQuickLinks() {
  return (
    <section>
      <p className="text-sm text-muted-foreground leading-relaxed">
        The answer might already be written down.{" "}
        <Link href={ROUTES.DOCS} className={INLINE_LINK}>
          The docs
        </Link>{" "}
        cover setup, the API reference, self-hosting and rate limits, and{" "}
        <Link href={ROUTES.CHANGELOG} className={INLINE_LINK}>
          the changelog
        </Link>{" "}
        has what shipped, when, and what broke on the way.
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        If a form is not how you want to do this, write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className={INLINE_LINK}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}
