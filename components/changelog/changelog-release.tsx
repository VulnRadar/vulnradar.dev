import {
  CHANGE_CATEGORIES,
  type Change,
  type ChangeCategory,
  type Release,
} from "@/lib/changelog/data";

// Reading order within a release, not authorship order: security first
// (the thing people scanning a changelog for "am I safer now" look for),
// then new capabilities, then bug fixes, then everything else. Within a
// group, original order is preserved (Array.prototype.sort is stable).
const CATEGORY_ORDER: ChangeCategory[] = [
  "security",
  "added",
  "fixed",
  "changed",
  "performance",
  "deprecated",
];
const UNCATEGORIZED_RANK = CATEGORY_ORDER.length;

function categoryRank(category?: ChangeCategory): number {
  if (!category) return UNCATEGORIZED_RANK;
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? UNCATEGORIZED_RANK : i;
}

function CategoryBadge({ category }: { category?: ChangeCategory }) {
  if (!category) return null;
  const { label, color } = CHANGE_CATEGORIES[category];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${color}`}
    >
      {label}
    </span>
  );
}

/**
 * One release card.
 *
 * Deliberately not a client component. `Change.icon` is a lucide component
 * reference, which cannot cross the server/client boundary as data, so this
 * is what resolves it: the release is rendered to HTML on the server and only
 * the markup reaches the browser. That is what keeps lib/changelog/data.ts
 * (about 480 KB of release records, and growing by a block per change) out of
 * the /changelog client bundle.
 */
export function ChangelogRelease({
  release,
  isLatest,
}: {
  release: Release;
  isLatest: boolean;
}) {
  const changes: Change[] = [...release.changes].sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category),
  );

  return (
    <article className="rounded-xl border border-border/60 bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-1 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-sm font-semibold font-mono ${
              isLatest
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-foreground"
            }`}
          >
            v{release.version}
          </span>
          <time className="text-sm text-muted-foreground">{release.date}</time>
          {isLatest && (
            <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-medium">
              Latest
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {release.title}
        </h2>
        {release.summary && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {release.summary}
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {changes.map((change, changeIndex) => (
          <li
            key={changeIndex}
            className="flex gap-3 rounded-lg bg-muted/30 p-3"
          >
            <change.icon
              className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <h3 className="font-medium text-sm text-foreground">
                  {change.label}
                </h3>
                <CategoryBadge category={change.category} />
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {change.desc}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
