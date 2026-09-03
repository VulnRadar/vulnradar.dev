import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import {
  CHANGE_CATEGORIES,
  type Change,
  type ChangeCategory,
  type Release,
} from "@/lib/changelog/data";

// Reading order within a release, not authorship order: security first
// (the thing people scanning a changelog for "am I safer now" look for),
// then new capabilities, then bug fixes, then everything else. Within a
// group, original order is preserved.
const CATEGORY_ORDER: ChangeCategory[] = [
  "security",
  "added",
  "fixed",
  "changed",
  "performance",
  "deprecated",
];

/**
 * A solid version of each category's colour, for the group marker and the
 * dots in the at-a-glance strip.
 *
 * CHANGE_CATEGORIES already carries a colour per category, but as a combined
 * badge class string whose background sits at 10% opacity: correct behind
 * text, invisible on a 6px dot. Same tokens, painted solid. Written out as
 * literal class strings because Tailwind only compiles what it can see in
 * the source.
 */
const CATEGORY_ACCENT: Record<ChangeCategory, string> = {
  security: "bg-[hsl(var(--severity-critical))]",
  added: "bg-[hsl(var(--success))]",
  fixed: "bg-[hsl(var(--warning))]",
  changed: "bg-[hsl(var(--severity-low))]",
  performance: "bg-primary",
  deprecated: "bg-[hsl(var(--severity-info))]",
};

/**
 * What one entry of each category is called, for the disclosure that reveals
 * the rest of a long group. "Show 278 more fixed" is not a sentence; the
 * category label is an adjective in half the cases and a noun in the other
 * half, so the noun is written out rather than derived from the label.
 */
const CATEGORY_NOUN: Record<ChangeCategory, string> = {
  security: "security changes",
  added: "additions",
  fixed: "fixes",
  changed: "changes",
  performance: "performance changes",
  deprecated: "deprecations",
};

/**
 * How many entries of a group are shown before the rest go behind a
 * disclosure, and the size a group has to reach before that happens.
 *
 * 3.8.0 ships 480 entries in one release, 286 of them fixes. Rendered flat
 * that is roughly forty screens of near-identical rows on the one page a
 * returning user opens to find out what changed, and the older releases
 * underneath it are unreachable without scrolling past all of it. Eight and
 * fourteen are chosen so that a release condensed to the sixty-odd grouped
 * entries this one is heading for mostly does not collapse at all: a group
 * has to be meaningfully long before anything is hidden.
 *
 * <details> rather than a client-side toggle, so the whole release is still
 * in the HTML for search, for the AI assistant's knowledge base, and for
 * anyone printing the page.
 */
const GROUP_PREVIEW = 8;
const GROUP_COLLAPSE_MIN = 14;

/** Anchor id for a release, so a version can be linked directly. */
function releaseSlug(version: string): string {
  return `v${version.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

interface CategoryGroup {
  category: ChangeCategory | "other";
  label: string;
  /** Plural noun for the entries, used in the "show the rest" disclosure. */
  noun: string;
  accent: string;
  items: Change[];
}

function groupByCategory(changes: Change[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];

  for (const category of CATEGORY_ORDER) {
    const items = changes.filter((change) => change.category === category);
    if (items.length === 0) continue;
    groups.push({
      category,
      label: CHANGE_CATEGORIES[category].label,
      noun: CATEGORY_NOUN[category],
      accent: CATEGORY_ACCENT[category],
      items,
    });
  }

  // Entries written before the category field existed, and any category the
  // data grows that this file has not been taught yet. They keep their place
  // rather than disappearing.
  const known = new Set<string>(CATEGORY_ORDER);
  const rest = changes.filter(
    (change) => !change.category || !known.has(change.category),
  );
  if (rest.length > 0) {
    groups.push({
      category: "other",
      label: "Other",
      noun: "entries",
      accent: "bg-muted-foreground",
      items: rest,
    });
  }

  return groups;
}

/** "August 29, 2026" as a machine-readable date, or nothing if it will not parse. */
function isoDate(date: string): string | undefined {
  const parsed = new Date(`${date} UTC`);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

function ChangeRow({ change }: { change: Change }) {
  return (
    <li className="flex gap-3 py-3">
      <change.icon
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-foreground">{change.label}</h4>
        <p className="mt-1 max-w-[76ch] text-sm leading-relaxed text-muted-foreground">
          {change.desc}
        </p>
      </div>
    </li>
  );
}

function CategorySection({
  group,
  slug,
}: {
  group: CategoryGroup;
  slug: string;
}) {
  const collapse = group.items.length >= GROUP_COLLAPSE_MIN;
  const shown = collapse ? group.items.slice(0, GROUP_PREVIEW) : group.items;
  const hidden = collapse ? group.items.slice(GROUP_PREVIEW) : [];

  return (
    <section id={`${slug}-${group.category}`} className="scroll-mt-24">
      <h3 className="flex items-center gap-2 border-b border-border/50 pb-2">
        <span
          aria-hidden="true"
          className={cn("h-3.5 w-1 shrink-0 rounded-full", group.accent)}
        />
        {/* One notch above the entry titles below it (15 against 14), so the
            ladder inside a release card reads release title, group, entry. */}
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          {group.label}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {group.items.length}
        </span>
      </h3>

      <ul className="divide-y divide-border/40">
        {shown.map((change, i) => (
          <ChangeRow key={i} change={change} />
        ))}
      </ul>

      {/* Named group so the marker and the two labels can all read the open
          state, the same `group-open/name` form
          components/ai-chat/message-content.tsx already uses. */}
      {hidden.length > 0 && (
        <details className="group/more border-t border-border/40">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-medium text-muted-foreground marker:content-none hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
            {/* A real icon. This used to be a numeric entity for U+25B6, which
                carries emoji presentation by default on Windows and on most
                phones, so the disclosure marker rendered as a blue emoji
                triangle sitting next to text set in the UI font. A lucide
                glyph inherits currentColor and the icon sizing every other
                control here uses. */}
            <ChevronRight
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 transition-transform group-open/more:rotate-90"
            />
            <span className="group-open/more:hidden">
              Show {hidden.length} more {group.noun}
            </span>
            <span className="hidden group-open/more:inline">
              Hide {hidden.length} {group.noun}
            </span>
          </summary>
          <ul className="divide-y divide-border/40 border-t border-border/40">
            {hidden.map((change, i) => (
              <ChangeRow key={i} change={change} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * One release card.
 *
 * Deliberately not a client component. `Change.icon` is a lucide component
 * reference, which cannot cross the server/client boundary as data, so this
 * is what resolves it: the release is rendered to HTML on the server and only
 * the markup reaches the browser. That is what keeps lib/changelog/data.ts
 * (about 550 KB of release records, and growing by a block per change) out of
 * the /changelog client bundle.
 *
 * The entries used to be one flat list, sorted by category but with nothing
 * marking where one category ended and the next began, and every row drawn as
 * its own filled box with its own category badge. At 480 entries that is 480
 * boxes and 480 badges saying the same six words over and over. They are
 * grouped under a heading per category now, with the count on the heading and
 * the badges gone: the heading says what the whole run is.
 */
export function ChangelogRelease({
  release,
  isLatest,
}: {
  release: Release;
  isLatest: boolean;
}) {
  const slug = releaseSlug(release.version);
  const groups = groupByCategory(release.changes);
  const total = release.changes.length;
  const machineDate = isoDate(release.date);

  return (
    <article
      id={slug}
      aria-labelledby={`${slug}-heading`}
      className="scroll-mt-24 rounded-xl border border-border/60 bg-card p-5 sm:p-6"
    >
      <div className="mb-4 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`#${slug}`}
            aria-label={`Link to version ${release.version}`}
            className={cn(
              "inline-flex items-center rounded-md px-2.5 py-0.5 font-mono text-sm font-semibold",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              isLatest
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-foreground hover:bg-accent",
            )}
          >
            v{release.version}
          </a>
          <time
            className="text-sm text-muted-foreground"
            dateTime={machineDate}
          >
            {release.date}
          </time>
          {isLatest && (
            <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Latest
            </span>
          )}
          <span className="text-xs tabular-nums text-muted-foreground">
            {total} {total === 1 ? "change" : "changes"}
          </span>
        </div>
        <h2
          id={`${slug}-heading`}
          className="text-lg sm:text-xl font-semibold tracking-tight text-foreground text-balance"
        >
          {release.title}
        </h2>
        {release.summary && (
          <p className="max-w-[76ch] text-sm leading-relaxed text-muted-foreground">
            {release.summary}
          </p>
        )}
      </div>

      {/* The shape of the release in one line. On a 480-entry release it is
          also the only practical way in: each count jumps straight to its
          group instead of leaving you to scroll for it. */}
      {groups.length > 1 && total >= GROUP_PREVIEW && (
        <nav
          aria-label={`Changes in ${release.version} by type`}
          className="mb-6 flex flex-wrap gap-x-5 gap-y-2 border-y border-border/50 py-3"
        >
          {groups.map((group) => (
            <a
              key={group.category}
              href={`#${slug}-${group.category}`}
              className="group/link flex min-h-9 items-center gap-1.5 rounded-sm text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className={cn("h-1.5 w-1.5 rounded-full", group.accent)}
              />
              <span className="font-semibold tabular-nums text-foreground">
                {group.items.length}
              </span>
              <span className="text-muted-foreground group-hover/link:text-foreground">
                {group.label}
              </span>
            </a>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-7">
        {groups.map((group) => (
          <CategorySection key={group.category} group={group} slug={slug} />
        ))}
      </div>
    </article>
  );
}
