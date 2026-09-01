import { APP_NAME } from "@/lib/config/client-constants";
import { CHANGELOG } from "@/lib/changelog/data";
import { ChangelogRelease } from "@/components/changelog/changelog-release";
import { ChangelogLoadMore } from "@/components/changelog/changelog-load-more";

// How many releases render up front. Later batches come from the server
// action in changelog-actions.tsx.
const INITIAL_BATCH = 4;

/**
 * The changelog.
 *
 * This used to be one `"use client"` component that imported CHANGELOG
 * directly, which serialised the entire release history into the route's
 * client chunk: 89 KB gzipped downloaded to render four entries, growing with
 * every release appended under the project's changelog-per-change rule. The
 * data now stays on the server. This component renders the first batch as
 * HTML and hands the reveal behaviour to a client child that knows only an
 * offset and a total.
 */
export function ChangelogList() {
  // An empty CHANGELOG (a fork that has not written one yet) used to fall
  // straight through to "The beginning of VulnRadar" under a blank list,
  // which reads as the page having failed to load rather than as there
  // being nothing to show.
  if (CHANGELOG.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        No releases have been published yet.
      </p>
    );
  }

  const initial = CHANGELOG.slice(0, INITIAL_BATCH);

  return (
    <>
      <div className="flex flex-col gap-6">
        {initial.map((release, index) => (
          <ChangelogRelease
            key={release.version}
            release={release}
            isLatest={index === 0}
          />
        ))}
      </div>

      {CHANGELOG.length > initial.length ? (
        <ChangelogLoadMore
          initialOffset={initial.length}
          total={CHANGELOG.length}
        />
      ) : (
        <p className="text-sm text-muted-foreground text-center mt-12 pt-8 border-t border-border/50">
          The beginning of {APP_NAME}
        </p>
      )}
    </>
  );
}
