# Remediation agent rules (round 4)

Repo: `C:\Github-Projects\VulnRadar\vulnradar.dev`. You are fixing real audit
findings in a production codebase (~50 real users). Seven other agents are
working in parallel on different files.

## Where this stands

This is the FOURTH remediation pass. **462 findings are already closed** and
their ids are excluded from your file, so everything in it is genuinely open as
far as the audit record knows. Some will still turn out already-fixed: several
audits are months old and later rounds closed things without updating the
record. Verify first, every time. Rounds 1 to 3 found ~30 findings that were
already correct, and one that the audit had described accurately but nobody had
actioned turned out to be a live billing bug. Both outcomes are useful; a fix
invented for a problem that is not there is not.

Everything ships as ONE release, **3.8.0**. Do not create a new version.

**Target: close everything you can.** The owner wants the whole audit done for
this release, so bias toward fixing rather than skipping. Skip only for a real
reason: it needs a file you do not own, it is a full page redesign, or it is a
product decision (removing a feature, changing what is public). Say which.

## Your scope

Your task prompt names a findings file and the **file paths you own**. Fix
findings from that file, editing ONLY files inside your ownership boundary.

**Do not edit a file outside your boundary, ever.** If a fix genuinely needs a
change elsewhere, skip it and report it in your summary as blocked, naming the
file and the exact change needed so the coordinator can land it. Parallel
agents are editing other areas and an out-of-boundary edit will be lost or will
conflict.

**Never edit `lib/changelog/data.ts`.** Every agent would collide on it. Write
your changelog entries to the JSON file named in your prompt instead (format
below); the coordinator merges them with validation.

## Hard rules

1. **Never run a writing npm command.** `npm install`, `npm i`, `npm ci`,
   `npm update`, `npm audit fix`, `npm dedupe`, `npm prune`, and every `pnpm`
   and `yarn` command are FORBIDDEN. A Windows-regenerated `package-lock.json`
   strips the Linux native bindings and breaks CI and the Docker build.
   `npm run <script>`, `npx tsc`, `npx vitest`, `npx prettier`, `npx eslint`
   are all fine.
2. **Never run a destructive git command.** No `git stash`, `git reset --hard`,
   `git checkout --`, `git clean`. You may read with `git diff`, `git log`,
   `git show`. Do not commit; the coordinator commits.
3. **Do not run the full `npx vitest run`.** It takes minutes and eight agents
   doing it at once will thrash the machine. Run only the test files covering
   what you touched: `npx vitest run tests/path/to/relevant`.
4. **`npx tsc --noEmit` must exit 0 before you finish.** It is repo-wide, so if
   you see an error in a file you do not own, another agent is mid-edit: ignore
   that one, but make sure none of the errors are in YOUR files.
5. **Run `npx prettier --write` on every file you changed.** Enforced in CI.
6. Exclude `.claude/worktrees/`, `node_modules/`, `.next/` from every search.

## How to fix well

- **Verify the finding before fixing it.** Open the cited `file:line` and
  confirm the problem is real and still present. If it is not, do not invent a
  fix: record it as `already-correct` in your report with what you actually
  found.
- **Fix the cause, not the symptom.** If a test fails because behaviour
  legitimately changed, update the test to assert the NEW correct behaviour and
  say so. Never weaken an assertion to make it pass, and never delete a test.
- **Match the surrounding code.** This codebase has dense explanatory comments
  on non-obvious decisions. Where you fix something subtle, leave a comment
  saying what was wrong and why the new form is right. Keep the existing
  comment density and idiom. Do not add comments that merely restate the code.
- **No em dashes anywhere.** Project rule, including in code comments.
- **Add a test for anything security- or correctness-relevant you fix.** The
  suite is the only thing that stops a regression: `main` has no branch
  protection yet.
- Findings marked `design`, `ux`, `qol` or `opportunity` are often proposals
  rather than defects. Implement the ones that are concrete and contained. Skip
  anything that amounts to redesigning a page, and say so.
- Brand colour is blue `#60a5fa` (`--primary`). Never reintroduce cyan/teal.

## Changelog entries

For each user-visible fix, append an object to your changelog JSON file:

```json
[
  {
    "icon": "Shield",
    "label": "Short Title In Title Case",
    "desc": "Plain-language explanation for a user reading release notes. Say what was wrong, what it meant for them, and what happens now. No jargon, no file paths, no finding ids. Two to four sentences.",
    "category": "fixed"
  }
]
```

`icon` must be a lucide-react name already imported in `lib/changelog/data.ts`
(safe choices: Shield, ShieldCheck, ShieldAlert, Bug, Wrench, Settings, Lock,
Key, Mail, Eye, Search, Filter, Layout, List, Users, Globe, Database, Timer,
Gauge, Zap, FileText, Trash2, RefreshCw, Bell, Share2, Container, Network,
Activity, Sparkles, Code, Palette, Smartphone, CheckCheck).
`category` must be one of: `fixed`, `added`, `changed`, `security`,
`performance`, `deprecated`.

Purely internal fixes (a test, a type, a comment) need no changelog entry.

## Final report

In your reply give:

- how many findings you fixed, skipped, and found already-correct
- one line per fixed finding: `id: what changed`
- the ids you found already-correct, with what you actually saw
- anything you were blocked on, with the exact out-of-boundary change needed
- confirmation that `npx tsc --noEmit` exits 0 and your targeted tests pass
