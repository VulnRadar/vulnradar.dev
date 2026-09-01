# UI backlog, reported by the owner 2026-08-31

Raised while round 7 was still running. Work these once the agent wave lands.
Numbered so they can be referred to individually.

## Layout and ordering

1. **"More about this host" / scan-info section must sit ABOVE the findings
   list on EVERY result page.** This is a stated preference, not a bug: "thats
   HOW I like it." It has to land in the shared renderer so dashboard,
   history, shared and host pages all get it, not one page at a time. See
   `components/scanner/` scan-result detail and the shared result renderer.

2. **"Mark this result" and the remediation-tracking control on a finding are
   too low.** Currently at the very bottom of the finding detail. Move them up.
   Owner is not certain of the exact target position, so propose one and show
   it rather than guessing silently.

## Sharing

3. **The actions menu lists one row per team** ("Share with test", "Share with
   testing"). Replace with a single **"Share with a team"** row that opens a
   modal listing the teams. This is the control added in round 4; the modal is
   the shape the owner wanted. See the scan actions menu.

4. **Scan sharing still has no expiry control.** The owner has asked for this
   more than once. `scan_history` already carries `share_expires_at` and
   `PATCH /api/v3/history/[id]` handles sharing, so this is a UI gap, not a
   schema one. Verify the API accepts an expiry before building the control.

## Regressions from this session, treat as highest priority

5. **The AI-verification "re-read the evidence" modal has lost its CSS
   entirely.** Owner: "NOW JUST COMPLETELY GONE.. like why is that." Almost
   certainly collateral from this session's design consolidation work
   (`dsn-03` radius pass, `dsn-08` inline-alert migration, or the
   `@source inline(...)` safelist rework in `app/globals.css`). Check
   `git diff` on the evidence modal and on the safelist before anything else:
   a class that only ever appears in a `lib/` file is invisible to Tailwind's
   content globs, which is exactly the bug that left the role badges
   colourless earlier today.

6. **`/admin` renders the wrong skeleton while loading.** Overview is now the
   landing tab (added this session for `qols-02`), but the loading skeleton
   still matches the old Users landing.

7. **The Badge tab was removed from the navbar and replaced by Developer.**
   The owner does not want that: "we did not want that personally." This was
   `AUDIT-014#qolf-12` in round 6, which added `DEVELOPER_HREF` to `NAV_LINKS`
   and dropped Badge. **Restore Badge to the nav.** Keep Developer only if both
   fit; the owner's preference wins over the audit finding here.

## Visual quality

8. **The select checkboxes on a result page look bad** (owner screenshot: bare
   square checkboxes floating left of each finding row). This is the bulk-select
   mode added for `bulk-01`. Redesign so selection reads as part of the row.

9. **The support-tickets tab in admin still looks bad**, even after this
   session's CSS improvements. The owner expects the user-facing ticket surface
   is just as bad: check both, not only the admin side.

10. **Toggle buttons have no animation**, for example on the dashboard. Add
    transitions consistent with `lib/ui/animations.ts`.

11. **The demo result page looks bad.** Owner did not detail this one; inspect
    `/demo` and report what is wrong before changing it.

## Navbar consistency

12. **`/changelog` shows a signed-in navbar when logged in.** It is a public
    page and should not.

13. **The docs pages use a different navbar from the other public pages**
    (changelog, pricing, demo). Unify them. Note `AUDIT-011#shell-07` covers
    exactly this and was closed as "the two concrete defects are gone, picking
    one convention across the four public shells is a product decision". The
    owner has now made that decision: unify.

## Notes for whoever picks this up

- The owner's stated preference beats an audit finding. Items 7 and 13 both
  reverse or settle earlier decisions.
- Items 5, 6 and 8 are all consequences of work done TODAY. Check `git diff`
  before assuming they are long-standing.
- Nothing here is in `audits/merged-findings.json`, so the 802-finding counter
  does not track it. Track it here.

---

## Added after the first list

14. **"Clear all history" sits at the very bottom of the history page**, and
    the owner names the general pattern: **too many important actions are
    buried at the bottom, across the whole project.** Treat this as a
    project-wide pass, not a single fix: audit every page for a primary or
    destructive action parked below the fold and bring it somewhere visible.

    Note this is a REVERSAL of work done today. `AUDIT-014#qolf-09` moved Clear
    All out of the filter row into "a labelled danger section below the list",
    and added a type-DELETE confirmation. The confirmation is worth keeping;
    the placement is not what the owner wants. Same class of correction as
    items 7 and 13: the audit's recommendation and the owner's preference
    disagree, and the owner wins.

    Related and already in this list: item 1 (host info above findings) and
    item 2 (remediation tracking too low) are the same complaint about the
    result page. Fix them as one ordering pass so the whole app reads
    consistently, rather than three separate patches.

## Investigation notes, item 5 (evidence modal CSS)

Ruled out so far, so nobody repeats it:
- `components/scanner/ai-verify-result-modal.tsx` itself is **unchanged** this
  session (`git diff HEAD` is empty for it).
- `components/ui/dialog.tsx` DID change (scrim `bg-black/80` to
  `bg-background/80 backdrop-blur-xs`, panel `bg-background` to `bg-card`), but
  that matches what `alert-dialog.tsx`, `sheet.tsx` and `command.tsx` already
  use, and `backdrop-blur-xs` is a real class on Tailwind v4 (this repo is on
  `^4.3.3`). Consistent, not obviously the regression.
- Still to check: `Stat` imported from `components/scanner/scan-summary.tsx`
  (still exported), the `dsn-03` radius pass, the `dsn-08` inline-alert
  migration, and whether any class the modal relies on lives only in a `lib/`
  file and is therefore outside Tailwind's content globs. That last one is the
  same root cause as the colourless role badges found earlier today, and is the
  first thing to test.

Do not start this while an agent owns `components/scanner/`.

15. **"File as GitHub issue" shows on every scan, but it only makes sense for
    repo scans.** Verified while logging this:
    - The menu entry at `components/scanner/scan-actions-menu.tsx:839-847` has
      no condition on the scan's source. It renders for an ordinary URL scan
      exactly as it does for a repo scan.
    - The route it calls (`app/api/v3/scan/github-issue/route.ts`) is built
      around a repo: it requires `repo: "owner/name"`, validates it against
      `REPO_RE`, and files through the caller's connected GitHub account.
    - There IS a field to gate on: `scan_history.source` is `'github'` for repo
      scans (`app/api/v3/scan/github/route.ts:265` inserts it literally).

    So the fix is to show the action only when the scan came from the GitHub
    repo scanner. Check what `source` values reach the menu before gating, and
    decide what a user with a connected GitHub account but a plain URL scan
    should see: probably nothing, rather than a disabled row.

    Related: `AUDIT-014#comp-08` (still open) proposes going the other way and
    expanding GitHub ticketing to per-finding issues. If that is ever built,
    this gate is the thing that decides where it appears. Do not let comp-08
    reintroduce the action on non-repo scans.

16. **The check-family count disagrees with itself across surfaces.** The
    dashboard hero reads "795+ checks across 17 families"
    (`components/scanner/scan-hero.tsx:11`, from `ALL_CATEGORIES.length`)
    while the landing page reads "797 checks, 18 categories" (from
    `EXACT_CHECK_CATEGORY_COUNT` in the generated stats).

    Cause: `ALL_CATEGORIES` in `lib/scanner/types.ts:54` lists 17 entries;
    `lib/scanner/checks-data/` holds 18 JSON files. The missing one is
    `active-probes`.

    This may be deliberate, because active probes are opt-in and the scan form
    counts them separately (the "17/17" and "0/9" badges). But a visitor sees
    17 on one page and 18 on another for the same idea, so at minimum the two
    surfaces need to agree on what a "family" or "category" is. Decide which
    definition is user-facing and make both read from one constant. Do not
    simply add active-probes to ALL_CATEGORIES without checking what iterates
    it: that list drives which families run on a passive scan.
