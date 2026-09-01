# Remediation agent rules

Repo: `C:\Github-Projects\VulnRadar\vulnradar.dev`. You are fixing real audit
findings in a production codebase (~50 real users). Another agent is working in
parallel on a different set of files.

## Your scope

Your task prompt names a findings file under
`...\scratchpad\fix\<bucket>.json` and the **file paths you own**. Fix findings
from that file, editing ONLY files inside your ownership boundary.

**Do not edit a file outside your boundary, ever.** If a fix genuinely needs a
change elsewhere, skip it and report it in your summary as blocked. Parallel
agents are editing other areas and an out-of-boundary edit will be lost or will
conflict.

**Never edit `lib/changelog/data.ts`.** Every agent would collide on it. Write
your changelog entries to the JSON file named in your prompt instead (format
below); the coordinator merges them.

## Hard rules

1. **Never run a writing npm command.** `npm install`, `npm i`, `npm ci`,
   `npm update`, `npm audit fix`, `npm dedupe`, `npm prune`, and every `pnpm`
   and `yarn` command are FORBIDDEN. A Windows-regenerated `package-lock.json`
   strips the Linux native bindings and breaks CI and the Docker build.
   `npm run <script>`, `npx tsc`, `npx vitest`, `npx prettier`, `npx eslint`
   are all fine.
2. **Do not run the full `npx vitest run`.** It takes minutes and several
   agents doing it at once will thrash the machine. Run only the test files
   covering what you touched: `npx vitest run tests/path/to/relevant`.
3. **`npx tsc --noEmit` must exit 0 before you finish.** It is repo-wide, so if
   you see an error in a file you do not own, another agent is mid-edit: ignore
   that one, but make sure none of the errors are in YOUR files.
4. **Run `npx prettier --write` on every file you changed.** Formatting is
   enforced in CI.
5. Exclude `.claude/worktrees/`, `node_modules/`, `.next/` from every search.

## How to fix well

- **Verify the finding before fixing it.** Some are stale, some were already
  fixed, some are wrong. Open the cited `file:line` and confirm the problem is
  real and still present. If it is not, do not invent a fix: record it as
  `already-correct` in your report with what you actually found.
- **Fix the cause, not the symptom.** If a test fails because behaviour
  legitimately changed, update the test to assert the NEW correct behaviour and
  say so. Never weaken an assertion to make it pass, and never delete a test.
- **Match the surrounding code.** This codebase has dense explanatory comments
  on non-obvious decisions. Where you fix something subtle, leave a comment
  saying what was wrong and why the new form is right. Keep the existing
  comment density and idiom.
- **No em dashes anywhere.** Project rule. Use a colon, a comma, or rewrite.
- **Prefer a real fix to a note.** But if a proper fix is genuinely out of
  scope (needs a schema change, a new API, or a file you do not own), skip it
  and report it rather than doing something half-safe.
- Findings marked `design`, `ux`, `qol` or `opportunity` are often proposals
  rather than defects. Implement the ones that are concrete and contained. Skip
  anything that amounts to redesigning a page, and say so.

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
- anything you were blocked on and why
- confirmation that `npx tsc --noEmit` exits 0 and your targeted tests pass
