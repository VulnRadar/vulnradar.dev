# AUDIT-011 — Plan

**Created:** 2026-08-28
**Title:** Product surface audit — scanning page, UI breakage, design language, QOL, capability drift
**Status:** in_progress (batch 1 of N)

---

## Repo shape (measured, not assumed)

| Area | Size |
|---|---|
| `app/` | 314 files, 60,517 lines |
| `lib/` | 252 files, 80,070 lines (29 subdirs) |
| `components/` | 313 files, 65,147 lines (28 groups) |
| `tests/` | 362 files, 89,192 lines |
| `extension/src/` | 25 files, 7,048 lines |
| `cli/` | 4 files |
| Pages | 71 `page.tsx` |
| API routes | 155 `route.ts` under `app/api/` |
| Scanner | 101 files under `lib/scanner/` |

191 commits have landed since AUDIT-010 shipped (`c58d0481`).

---

## Batch decision

**This run covers sections 6, 4, 3, 5, 7, 8** — six of the twenty listed.

### Why these six

Ten prior audits exist (`AUDIT-001` .. `AUDIT-010`). Every one of them
carries `auth`, `ssrf`, `crypto`, `idor`, or `scanner` in its scope list,
and all but one shipped. Sections 1 (correctness/security) and 2 (SSRF and
scan abuse) are the single most-worked ground in this repository; the
marginal value of an eleventh pass over them is low relative to the rest.

**Not one prior audit carries a UI, design, mobile, UX, or a11y scope.**
The entire user-facing surface — 71 pages, 313 component files, the
extension, the emails, the docs — has never been audited. That is also
precisely where the product owner named concrete, already-known pain:

- `/history` badly broken on mobile
- `/profile` on the old tab component while `/admin` and `/docs` moved on
- the scanning page's timer actively undermining the core speed claim
- `/admin` "genuinely confusing with no clear organization"
- bulk actions that should probably be removed

Section 8 (capability drift) rides on the same API-route walk and is
concrete enough to finish properly in the same pass.

### Ordering within the batch

Ordered by damage-to-the-business, not by the order listed in the brief:

1. **Section 6 — the scanning page.** Named as actively hurting. It has a
   falsifiable technical question attached (why 15-20s when the engine
   takes 2-5s), so it gets a dedicated latency-forensics pass.
2. **Section 4 — UI fixes, mobile and desktop.** Known breakage, real users.
3. **Section 3 — client-visible breakage.** Same page-by-page walk as 4, so
   auditing them together costs little more than auditing 4 alone.
4. **Section 5 — design consistency.** Requires first establishing the
   design language from the strongest existing work, then measuring every
   other surface against it.
5. **Section 7 — UI quality of life,** including the full bulk-action
   inventory.
6. **Section 8 — backend/frontend capability drift.**

---

## Section status — as delivered

117 findings written to `findings.json`: 7 critical, 37 high, 53 medium,
20 low. Sorted severity-descending as the brief requires.

| # | Section | This run | Status | Findings |
|---|---|---|---|---|
| 1 | Correctness and security | no | outstanding | — |
| 2 | SSRF and scan abuse | no | outstanding | — |
| 3 | Client-visible breakage | yes | **COMPLETE** | 38 |
| 4 | UI fixes — mobile and desktop | yes | **COMPLETE** | 27 |
| 5 | Design consistency — whole product | yes | **PARTIAL** | 6 |
| 6 | The scanning page | yes | **PARTIAL** | 8 |
| 7 | UI quality of life (incl. bulk actions) | yes | **PARTIAL** | 4 |
| 8 | Backend / frontend capability drift | yes | **COMPLETE** | 26 |
| 9 | Performance | no | outstanding | 1 (incidental) |
| 10 | Tests | no | outstanding | — |
| 11 | Dependencies | no | outstanding | — |
| 12 | Database and migrations | no | outstanding | — |
| 13 | Build and deploy | no | outstanding | — |
| 14 | Documentation | no | outstanding | 1 (incidental) |
| 15 | Hardcoded values | no | outstanding | 1 (incidental) |
| 16 | Consistency and dead code | no | outstanding | 3 (incidental) |
| 17 | Error handling and observability | no | outstanding | — |
| 18 | Accessibility and states | no | outstanding | 2 (incidental) |
| 19 | Discoverability and marketing surface | no | outstanding | — |
| 20 | Competitive gaps | no | outstanding | — |

"Incidental" means the finding surfaced while auditing a section in this
batch and is tagged to its true home section. It does **not** mean that
section was audited; those sections remain fully outstanding.

### Why three sections are PARTIAL

The run was structured as two waves. Wave 1 (7 agents) completed. **Wave 2
was cancelled by the owner mid-run** so they could switch models before it
started. Wave 2 held the second half of three sections:

- **Section 5 — design consistency.** Wave 1 extracted the design language
  from the strongest existing work; it is written up in full at
  `audits/AUDIT-011/design-language.md` (color tokens, type scale, spacing
  rhythm, component idioms, layout principles, voice, and a 14-point
  tell-tale checklist). What did **not** happen is the conformance pass:
  measuring each of the 71 pages, the extension UI, the email templates,
  the PDF/SARIF/Markdown report renderers, and the error pages against that
  spec. The 6 design findings recorded here are ones that fell out of the
  extraction itself, not the result of a surface-by-surface audit.
- **Section 6 — the scanning page.** The latency half is complete and the
  root cause is identified with a fix (`scan-01`). The **UI rebuild** half,
  "rebuild that page's UI to match the design language from section 5", was
  not done — it depended on section 5's conformance pass.
- **Section 7 — UI quality of life.** The bulk-action inventory is complete
  (all six instances found, each with a keep/remove/redesign verdict and a
  removal line count). Not done: the `/admin` restructure proposal, the
  page-by-page information-hierarchy review, the repetitive-flow and
  missing-shortcut sweep, the feedback/progress/undo review, and the
  mobile-density review.

### Not built this run

`report.html` is **not** built. Per the brief it is built only once the
last section is done, merging every `audits/AUDIT-*/findings.json`.
See the schema warning under assumption 5 before building it.

---

## Assumptions recorded

Decisions made without asking, per instruction:

1. **Twenty sections, not eighteen.** The brief says "there are eighteen
   sections below" but lists twenty. Treated all twenty as the set. The
   status table above is the authoritative list.

2. **`n` = 011.** `audits/registry.json` had `nextId: 11`, and
   `AUDIT-001` .. `AUDIT-010` exist. This run is `AUDIT-011`.

3. **Sections 3 and 4 audited as one walk.** The brief separates "broken"
   (3) from "responsive" (4), but both require reading the same page files.
   They are audited together and separated again in the output via the
   `type` field (`bug` vs `mobile`).

4. **Section 5's design language is derived, not assumed.** The brief names
   the landing page, the OG image, and `extension/public/store/` as the
   strongest work. A spec was extracted from those first, and every other
   surface was measured against that spec rather than against generic
   design taste.

5. **Findings schema follows the brief, not the existing repo convention.**
   `audits/README.md` documents an older finding shape (`<scope>-NN` ids,
   different keys). The brief specifies an explicit key set (id, title,
   section, type, severity, effort, category, file, line, description,
   impact, recommendation). The brief wins; `findings.json` uses the brief's
   schema so the eventual merged `report.html` is uniform. Finding ids
   still follow the readable `<scope>-NN` convention so code comments can
   reference them as `ref: AUDIT-011#scan-01`.

6. **Severity is judged by user-facing damage,** not by exploitability,
   since this batch contains no security sections. A page that is unusable
   on mobile is `high`; a page that is ugly but usable is `low`.

7. **"Don't change any code outside `audits/`" taken literally.** Every
   finding describes a fix; none were applied. No subagent was permitted to
   edit, and none were permitted to run `git stash` or any destructive git
   command.

8. **Effort sizing:** `small` = under an hour, one file. `medium` = a few
   files, half a day. `large` = a rebuild of a surface or a cross-cutting
   change touching many files.

9. **Section 5's yardstick was derived, then applied to CLAUDE.md itself.**
   The extraction found that `CLAUDE.md` line 1 ("cyan/teal, ~190° hue") is
   wrong: every shipped surface is blue `#60a5fa` (213°). Rather than audit
   against the documented brand, I audited against the shipped one and
   filed the doc as the defect (`design-01`).

10. **`bulk-01` is recorded as a decision, not a verdict.** The brief's
    default was REMOVE. Five of the six bulk features had a defensible
    keep case, so I recorded those with reasons. For the sixth — the one
    the brief named — I costed *both* paths (≈565 lines out, or ≈2 days to
    redesign) rather than picking, because it turns on whether triaging
    100+ findings is a workflow the product wants to own. That is a product
    call, not an audit call.

11. **A stale git worktree exists inside the repo** at
    `.claude/worktrees/agent-ad8a7d09dcde23fcc/`, holding a second copy at
    a different revision. Two independent agents tripped over it. Every
    finding here was verified against the main tree only. **Any repo-wide
    grep during the merge/report step must exclude it** or it will
    double-count every file.

---

## How the next batch should be run

See the closing note in the run summary. The recommended next batch is
sections 1, 2, 9, and 17 — the correctness/security/performance/
observability cluster — because those four share a code-reading path
through `lib/` and `app/api/` in the same way this batch shared one
through `app/` and `components/`.
