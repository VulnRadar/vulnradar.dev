# VulnRadar Public Docs: AI Knowledge

_Auto-compiled from `app/docs/*/page.tsx` on 2026-08-25._

This file is consumed by the AI system prompt at runtime so the
assistant can answer questions about every public docs page. Edit
the source pages; this file regenerates on `npm run build` and
`npm run dev`.

Extraction covers: DocsHero, DocsSection, DocsCallout,
DocsCodeTabs, CodeBlock, EndpointCard (typed endpoints array),
Feature[] arrays (platformFeatures, apiCategories, etc.), TOC
headings, and prose paragraphs.

---

## account-security
Route: /docs/account-security

### Sections
- **Overview** (`#overview`)
- **Two-step verification** (`#two-factor`)
- **Sessions and trusted devices** (`#sessions`)
- **Sign in with Google, GitHub, Discord** (`#oauth`)
- **Notifications and posture digest** (`#notifications`)
- **Your data and privacy** (`#data`)

### Callouts
> **INFO: Pick the app method if you can**
> An authenticator app is the stronger of the two: the code is
generated on your device and works with no signal, and it is not
exposed if your email account is compromised. Email codes are only
as safe as the inbox they land in. Use email codes when you cannot
keep an authenticator app, not as the de

> **INFO: Signing in is not the same as sharing scans**
> A social login only authenticates you. It does not post anything to
the provider and does not change who can see your scans, that is
governed entirely by the privacy settings below.

> **WARNING: Deletion is immediate and final**
> There is no grace period or undo once the purge runs. If you only
want to step away, sign out everywhere and turn off email
categories instead of deleting, then export your data first if you
might want it later.

### Notes
- Your password is the floor, not the ceiling. On its own it means a single leaked or reused credential is enough to sign in as you. Everything below sits on top of it: a second factor so a stolen password is not enough, a session list so you can see and cut off anything you do not recognise, and privacy controls over what a scan leaves behind and what stores.
- Every control here is under Profile , split across four tabs: Security (password, two-step verification, sessions), Connections (social logins), Notifications (which emails you get), and Privacy (data export, scan visibility, account deletion). Changing anything sensitive asks for your current password again, so a hijacked session alone cannot quietly rewire your security.
- Two-step verification (2FA) asks for a second code after your password at sign-in. offers two methods and you run one at a time: a rotating code from an authenticator app, or a code emailed to you. Turning either one on, off, or switching between them asks for your current password first. To switch, turn the active method off, then turn the other on.
- An authenticator app is the stronger of the two: the code is generated on your device and works with no signal, and it is not exposed if your email account is compromised. Email codes are only as safe as the inbox they land in. Use email codes when you cannot keep an authenticator app, not as the default.
- Works with Google Authenticator, Authy, 1Password, or any other TOTP app. In Profile > Security, under Two-step verification, choose Set up authenticator app and follow the two steps:
- The secret that seeds those codes is stored encrypted at rest (AES-256-GCM), and the server refuses to set up app 2FA at all unless that encryption key is configured, so a database read never yields a usable seed. If a code is rejected, it is almost always because the 30-second window rolled over: use the one showing right now. Turning the app method off later also asks for your password and deletes both the enrolled secret and every backup code.
- Simpler to set up and nothing to install. In Profile > Security, choose Turn on email codes and confirm your password. After that, every sign-in sends a fresh 6-digit code to your account email, which you enter to finish signing in. There are no backup codes for this method, because access to your inbox is already the recovery path. Turning it off asks for your password again.
- When you turn on the authenticator-app method, issues eight single-use backup codes. Each one signs you in exactly once if you lose your phone, so they are the difference between a lost device and a lost account. They are shown a single time. Copy or download them then, and keep them somewhere that is not the phone running the authenticator.
- A session is one signed-in browser or device. A trusted device is one that has already cleared 2FA and is allowed to skip the second-factor prompt for a while. Both are listed and revocable in Profile > Security, and they are the fastest way to answer "is anyone else in my account".
- The Active sessions list shows every device currently signed in: a summary of the browser and OS, the IP address, and when it signed in. The one you are on is tagged This device. Anything you do not recognise, sign it out with one click.

### Code examples
```text
Profile > Privacy > Export your data > Download now
  -> vulnradar-data-export-YYYY-MM-DD.json
```

## ai
Route: /docs/ai

### Sections
- **Overview** (`#overview`)
- **The Vera assistant** (`#vera`)
- **AI endpoints** (`#endpoints`)
- **Finding verification** (`#verify`)
- **Scan summaries** (`#summary`)
- **Auto-tags** (`#autotag`)
- **Bring your own key** (`#byok`)
- **Token budgets** (`#budgets`)
- **AI credits** (`#credits`)
- **Privacy** (`#privacy`)

### Callouts
> **WARNING: AI can be wrong**
> Model output is a convenience, not the source of truth. The
findings, IDs, and severities come from the deterministic scanner;
verify anything critical against the finding itself rather than the
summary or the verdict.

### Notes
- Detection in is deterministic: the same URL yields the same findings and the same stable IDs, with no model in the loop. AI sits on top of that as a set of opt-in conveniences, never as the thing that decides whether a finding exists.
- Four features call a language model: Vera (the support chat widget), finding verification , scan summaries , and auto-tags . They all resolve a provider the same way: a user&rsquo;s own key if one is configured, otherwise the deployment&rsquo;s managed AI. On a self-hosted instance with no AI_BASE_URL set, each feature simply does nothing rather than erroring.
- AI is also per-user switchable. Any user can turn it off entirely in Profile > AI settings, which hides the chat widget and refuses verify and summary calls. Server-side setup (provider, model, key) lives in the Configuration reference ; this page is about what the features do and how they are gated.
- Vera is the floating chat widget in the bottom-right corner (hidden on the docs, admin, and live-browser pages). It is scoped to only: it answers questions about scan findings, how to fix them, API usage, and self-hosting, and declines anything off-topic. Sending a message requires being signed in; the widget shows a sign-in gate otherwise.
- Vera&rsquo;s system prompt is built from the live codebase, not a hand-maintained copy. The scanner-category table and check counts come straight from the check registry, alongside the severity levels, the per-scan verdict signals (0-10 danger score, safe / caution / unsafe rating, engine confidence), the API reference, and a set of common findings with their fixes. A few small account facts are also baked in: your display name, plan, role, daily scan limit, and the month you joined.
- To keep every message small, heavier context is loaded only when you ask for it with a slash command. Type / in the composer for autocomplete.
- Account facts are passed as a structured data block, not interpolated into instruction text, so a display name that looks like an instruction is treated as data. Anything you paste in, including scan output and scanned page content, is likewise treated as untrusted data rather than instructions, because an attacker can embed text in a page that later gets scanned.
- The HTTP surface behind the features, all under /api/v3/. Only /ai/info is public; the chat and context routes require a session.
- POST /api/v3/scan/verify takes a scan you own and re-checks its findings with the model. For each finding it makes a fresh HTTP probe of the target (status code, final URL, response headers, and a bounded body snippet) and asks the model whether the finding is real given that live evidence. Each finding comes back with one of three verdicts, plus a confidence score and a short reason, and the enriched findings are written back onto the scan.
- POST /api/v3/history/"}/summary is the whole-scan counterpart to verification: one call that reads the stored scan result and returns a short, plain-language write-up. It is owner-only and takes the same dual auth (session, or a key with scan:write).

### Code examples
```bash
curl -sS -X POST "<value>/api/v3/scan/verify" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"scanHistoryId": "SCAN_PUBLIC_ID"}'
```

```bash
curl -sS -X POST "<value>/api/v3/history/SCAN_PUBLIC_ID/summary" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY"

# Force a regenerate instead of the cached summary
curl -sS -X POST "<value>/api/v3/history/SCAN_PUBLIC_ID/summary?regenerate=true" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY"
```

## cli
Route: /docs/cli

### Sections
- **Overview** (`#overview`)
- **Install** (`#install`)
- **Usage** (`#usage`)
- **Options** (`#options`)
- **Exit codes** (`#exit-codes`)
- **CI example** (`#ci`)

### Callouts
> **INFO: It is the scan API underneath**
> Every flag maps to the same POST /api/v3/scan{" "}
the rest of these docs cover, so anything the CLI does you can also do
with a raw request. Authentication is the same Bearer API key.

### Notes
- The vulnradar CLI wraps the scan API: it starts a scan, polls until it finishes, prints a summary, and exits non-zero when the finding counts go over the limits you set. That exit code is the whole point: drop it into a pipeline step and a regression fails the build.
- Run it straight from npm with no global install:
- Or install it globally if you call it often:
- Pass your key with --api-key or the VULNRADAR_TOKEN environment variable. Prefer the variable in CI so the key never lands in shell history or logs.
- 0 when every finding count is at or under its threshold; 1 when a threshold is exceeded or the scan errors out. That is what lets a CI job block a merge on a new critical.
- A GitHub Actions step that fails the build on any new critical or high:

### Code examples
```bash
npx vulnradar scan https://example.com --api-key vr_live_...
```

```yaml
vulnradar scan <url> [options]
```

```text
npm install -g vulnradar
vulnradar scan https://example.com
```

```text
- name: VulnRadar scan
  env:
    VULNRADAR_TOKEN: \<value>}
  run: npx vulnradar scan https://staging.example.com --max-critical 0 --max-high 0
```

## github
Route: /docs/github

# GitHub Scanning
Runs the secret scan and AI code review against a connected repo's source. Session only.

### Sections
- **Overview** (`#overview`)
- **How a scan runs** (`#how-it-works`)
- **Connecting GitHub** (`#connect`)
- **Running a scan** (`#running`)
- **Credits and token budgets** (`#budgets`)
- **Filing findings as an issue** (`#filing-issues`)
- **Privacy and limits** (`#privacy`)
- **API endpoints** (`#endpoints`)

### Callouts
> **INFO: Session only, no API key**
> Everything here requires a logged-in session. There is no Bearer-key
path for GitHub scanning yet, unlike the URL scan API. Requests
without a session return 401.

> **INFO: .env files are not auto-cleared**
> A committed .env or{" "}
.env.example is not skipped by filename.
Instead, obvious placeholder values on{" "}
KEY=VALUE lines (
your_key_here,{" "}
changeme,{" "}
postgres://user:password@localhost/db,
and similar) are redacted before the detectors see them. A
real-looking value on the same line sti

> **WARNING: No AI endpoint, no AI findings**
> If no AI provider is resolved (the server has none configured and
you have not connected your own key), the AI pass is skipped
cleanly: the secret findings still return and the response reports{" "}
aiReviewSkipped: true. AI calls resolve
your own configured endpoint first and fall back to {APP_NAME

> **SUCCESS: Bring your own AI key**
> Connect your own AI provider key in Profile > AI settings and the
per-window cap is bypassed entirely, because those calls cost{" "}
{APP_NAME} nothing. The per-run token ceiling below still applies.

### Notes
- The GitHub scanner is a separate scanning mode from the live-URL scanner. Instead of fetching a website and inspecting its HTTP responses, it authenticates as your connected GitHub account, lists a repo&apos;s files, fetches the text ones, and reviews the source itself. Two passes run over that source: a deterministic secret scan that reuses the URL scanner&apos;s credential detectors verbatim, and an AI pass that reads whole files looking for injection, weak crypto, auth logic mistakes, and secrets the patterns missed.
- Everything here requires a logged-in session. There is no Bearer-key path for GitHub scanning yet, unlike the URL scan API. Requests without a session return 401.
- The whole flow lives on /repos: connect an account, curate a working set of repos, scan one, read the findings, and file an issue. The sections below map each step to the endpoint behind it.
- POST /api/v3/scan/github runs the pipeline in order and short-circuits at the first gate that fails, so an oversized or empty repo is rejected before a single AI token is spent.
- Filtering happens on tree metadata alone, before any content is fetched, so it is cheap enough to run as a gate. Directory segments like node_modules, vendor, dist, build, .next, target, and venv are skipped, as are binary-looking extensions (images, fonts, archives, compiled artifacts) and, deliberately, .lock and .map files. Anything not recognized as binary is fetched and only then size-checked, so an unusual-but-valid text extension is not silently dropped.
- Three caps bound cost and abuse. They are runtime settings an admin can retune, shipped at:
- When a cap cuts the list short, the scan still runs on what fit and the response reports filesSkippedByCaps: true.
- The secret pass runs every detector from the URL scanner&apos;s secrets-extended check set against each file&apos;s raw text. Those detectors already ignore the URL and headers and only read the body, so they run unmodified against source. Findings come back with confidence 70, detection method Source file pattern matching, and a location.file instead of a URL.
- A committed .env or .env.example is not skipped by filename. Instead, obvious placeholder values on KEY=VALUE lines ( your_key_here, changeme, postgres://user:password@localhost/db, and similar) are redacted before the detectors see them. A real-looking value on the same line still fires. Detection follows the shape of the value, not the filename.
- Line numbers are not populated on secret findings: the shared detectors return an evidence string, not a match position.

### Code examples
```text
curl -X POST https://your-instance/api/v3/scan/github \\
  -H "Content-Type: application/json" \\
  --cookie "session=..." \\
  -d '{"repoFullName":"octocat/hello-world","ref":"main"}'
```

## reports
Route: /docs/reports

### Sections
- **Overview** (`#overview`)
- **The report endpoint** (`#endpoint`)
- **Report formats** (`#formats`)
- **Access control** (`#access`)
- **SARIF and CI** (`#sarif`)
- **Compliance crosswalk** (`#compliance`)
- **What the crosswalk is not** (`#caveats`)

### Callouts
> **INFO: You need a completed scan id first**
> This endpoint reports on a scan that already ran. Start one with{" "}
POST /scan, poll{" "}
GET /scan/status/{"{id}"} until it is{" "}
completed, then feed that id here. See
the{" "}

API reference
{" "}
for the scan and polling flow.

> **WARNING: Guidance, not a compliance determination**
> The crosswalk is indicative. It points an engineer or a reviewer at
the requirements a finding is relevant to; it does not make a site
compliant and it is not an audit, certification, or attestation. The
report says exactly this in a disclaimer at the top of its output.

### Notes
- stores each scan once and renders reports from it on demand. The in-app export menu on a scan runs the report generators client-side; the same generators are exposed over one HTTP endpoint so a pipeline or a script can fetch the exact same output with a Bearer key. There is no separate "report" object to create or poll: you already have a scan id, so you already have every report.
- The endpoint lives under /api/v3/ like the rest of the v3 API . Pick a format with the format query parameter; the response is a file download, not a JSON envelope, so pipe it to a file or hand it straight to whatever consumes it.
- One GET, authenticated exactly like GET /history/"}. The format parameter selects the generator; the response headers tell you what came back.
- Five outputs off the one endpoint. md and markdown are the same generator under two names; everything else is distinct.
- The report inherits the scan&apos;s access model, so there is nothing new to authorise. A caller who can read the scan can pull any format of its report; a caller who cannot gets the same 404 the scan itself returns.
- SARIF is the format worth wiring up first. The export is SARIF 2.1.0, the JSON schema GitHub Code Scanning consumes natively. Critical and high map to level: error, medium to warning, low and info to note. Each result carries a partialFingerprints.vulnradarFindingId equal to the stable check id, so re-running the scan updates the same alert instead of opening a duplicate. When a finding has a real computed CVSS score it is exported as security-severity; otherwise a per-band default is used.
- Store the key as a repo secret, fetch the SARIF for a completed scan, then hand it to the official upload action. The findings appear on the Security tab, annotated against the target.
- This endpoint reports on a scan that already ran. Start one with POST /scan, poll GET /scan/status/"} until it is completed, then feed that id here. See the API reference for the scan and polling flow.
- The compliance format expresses each finding as the framework controls it touches, so an engineer or a GRC reviewer can see "these findings are relevant to PCI requirement 6.2.4" without hand-mapping every result. The output is Markdown: a disclaimer, an overview, one section per framework grouped by control, an explicit list of findings that did not map to anything, and a short note on how the mapping is derived.
- Every finding is routed through its OWASP Top 10 (2021) category first, then to the controls each framework uses to govern that class of weakness. That routing is the vetted backbone; the frameworks all hang off it.

### Code examples
```bash
curl -sS "<value>/api/v3/history/123/report?format=sarif" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY" \\
  -o vulnradar.sarif
```

```yaml
- name: Fetch VulnRadar SARIF
  run: |
    curl -sS "<value>/api/v3/history/\<value>}/report?format=sarif" \\
      -H "Authorization: Bearer \<value>}" \\
      -o vulnradar.sarif

- name: Upload to code scanning
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: vulnradar.sarif
```

```bash
curl -sS "<value>/api/v3/history/123/report?format=compliance" \\
  -H "Authorization: Bearer vr_live_YOUR_API_KEY" \\
  -o vulnradar-compliance.md
```

## scheduled-scans
Route: /docs/scheduled-scans

### Sections
- **Overview** (`#overview`)
- **Creating a schedule** (`#create`)
- **Frequencies and plan limits** (`#frequencies`)
- **Time of day and timezones** (`#timezone`)
- **Where results go** (`#delivery`)
- **Pausing, teams, and auto-disable** (`#control`)
- **The schedules API** (`#api`)
- **How runs are triggered** (`#worker`)

### Callouts
> **INFO: This runs in a long-lived deployment**
> The worker is an in-process poller, the same pattern as the periodic
database cleanup job. It only runs in a persistent Node or Docker
deployment. A serverless target has no process to poll, so schedules
will sit due and never fire there. The feature can also be turned
off entirely per deployment wi

> **INFO: Self-hosted with billing off**
> When BILLING_ENABLED is false, every plan
gate here is lifted: no count cap and every frequency unlocked,
the same way each other plan-gated feature behaves on a
self-hosted deployment. Staff accounts are treated as Pro
Supporter, not unlimited.

> **INFO: Runs land near the slot, not on the second**
> Each schedule gets a small, deterministic per-schedule jitter added
to its next run: up to 25% of the interval, capped at 59 minutes,
and capped at 15 minutes for hourly. That is what keeps a wave of
same-cadence schedules from all firing in the same tick. Combined
with the polling interval, expect 

> **INFO: A one-off failure never disables a schedule**
> A run that throws for a transient reason (a database hiccup, the
scan engine erroring) is logged and rescheduled at the normal
cadence. Only a failed safety check disables a schedule.

> **INFO: Poll interval, claim limit, and concurrency are tunable**
> The poll interval, the number of rows claimed per tick, and the
batch concurrency are all admin settings, so an operator can dial
the worker up or down for their deployment without a code change.

### Notes
- A scheduled scan is a stored URL plus a cadence. A background worker wakes up on a short interval, finds the schedules that are due, and runs each one through the exact same scan path a manual scan takes. The result is a normal entry in your scan history, tagged with a scheduled source, so everything that reads a scan (the history view, reports, the diff against the previous run) works on it unchanged.
- The point is regression detection you do not have to remember. Set a production URL to re-scan daily and you get told when a new critical or high finding appears, when a header you fixed comes back, or when the target starts failing safety checks, all without opening the app. Manage schedules in the app under /profile in the Developer tab, or over the /api/v3/schedules endpoints below.
- The worker is an in-process poller, the same pattern as the periodic database cleanup job. It only runs in a persistent Node or Docker deployment. A serverless target has no process to poll, so schedules will sit due and never fire there. The feature can also be turned off entirely per deployment with FEATURE_SCHEDULED_SCANS, in which case POST /schedules returns 403.
- In the app, open /profile, go to the Developer tab, and pick Scheduled Scans. Paste a URL, choose a frequency, and set the time of day (and day of week or month, when the frequency needs one). The pickers are in your local time; the browser converts them to UTC once before sending.
- Prefer the API? The same create call is one POST, documented under The schedules API below. It is session-authenticated, so it runs with your logged-in session cookie, not a Bearer key.
- Five cadences. The two sub-daily ones are gated by plan tier, because an hourly schedule is up to 24 times the scan volume of a daily one. The other three carry no extra frequency gate beyond being able to schedule at all.
- Separate from the frequency gate, each plan caps how many schedules you can have at once. The count is enforced on create against the schedules you personally own. These are the shipped defaults; an admin can retune them live, where -1 means unlimited and 0 disables scheduling on that plan.
- When BILLING_ENABLED is false, every plan gate here is lifted: no count cap and every frequency unlocked, the same way each other plan-gated feature behaves on a self-hosted deployment. Staff accounts are treated as Pro Supporter, not unlimited.
- The frequency gate is re-checked at run time, not just at creation. If your plan drops below what a sub-daily schedule needs, the worker defers that run and reschedules it at its normal cadence instead of deleting or disabling it. Re-upgrade and the next occurrence simply runs again.
- Schedules are stored entirely in UTC. The row carries a preferred_hour_utc (0-23), a preferred_day_of_week (0-6, Sunday is 0, used only for weekly), and a preferred_day_of_month (1-28, used only for monthly). The app never asks you to think in UTC: the time-of-day pickers hold your local selection and the browser converts to UTC exactly once, at submit.

## sharing
Route: /docs/sharing

# Sharing & Public Pages
A completed scan does not have to stay in your history. Hand someone a read-only link, list it in a public directory, publish a stable per-host report, drop a live badge in a README, or diff two runs to show what changed. Every surface reads the same stored scan, and every one has an explicit privacy boundary drawn in code.

### Sections
- **Overview** (`#overview`)
- **Sharing a scan** (`#share-links`)
- **The Public Scans directory** (`#public-scans`)
- **What a viewer can see** (`#redaction`)
- **Per-host reports** (`#host-reports`)
- **Assets and attack surface** (`#assets`)
- **Security badges** (`#badges`)
- **Comparing two scans** (`#compare`)

### Callouts
> **INFO: Directory rate limit**
> The directory API is unauthenticated, so there is no session or
key to throttle against. It is limited per IP to 60 requests a
minute; over that returns a 429 with a{" "}
Retry-After header.

> **WARNING: Redaction only happens for a foreign badge scan**
> There is exactly one path where {APP_NAME} redacts. A live security
badge set to global{" "}
scope can resolve to a public scan someone else ran. That
person never consented to being named just because a stranger&apos;s
badge picked up their scan, so for a foreign scan the viewer shows
only the aggr

> **INFO: It never reflects a private scan**
> Every writer of the reputation cache skips a non-public scan, and
flipping a scan from public to private deletes its cached row
outright. An authenticated scan is always private, so it never lands
here. A host nobody has publicly scanned comes back as{" "}
known: false, and a bare IP is rejected as


> **INFO: Global scope keeps other people private**
> When a global badge resolves to a scan you did not run, only the
findings summary is shown. That scan&apos;s notes and the identity
of whoever ran it stay private, and the public gate (
is_public = true) means a stranger&apos;s
private or authenticated scan can never be pulled in this way.

### Notes
- stores each scan once. The public-facing surfaces are different views over that one row, each gated by its own flag on the scan_history record. Two flags do most of the work, and they are deliberately independent of each other:
- Everything below is one of those views. Creating and revoking share links, listing them, and building badges are all session-only actions, the same as webhooks: a logged-in user, never a Bearer API key. The read-only viewer pages, the directory, and the host report need no account at all.
- "Share this scan" issues a 64-character token and returns a link to /shared/<token>. Anyone with the link reads the full report without logging in. The token is stored as a SHA-256 hash (share_token_hash, added in migration 3.1.0), so the plaintext is never compared directly in the database.
- A link can expire after 7, 30, or 90 days, or never (the default). Any other value is a 400. An expired link is excluded from the viewer lookup entirely, exactly like a revoked one, so its findings never reach a response for even one request. Revoking a link (DELETE on the share route, or the Revoke action on the Shared reports page) sets share_token back to null, and the link stops working immediately for everyone who already has it.
- Re-sharing a scan that still has a live token returns the same token, so a link you already handed out stays valid. Only once a token has actually lapsed does the next share replace it with a fresh one.
- Publishing or revoking a share is a write action scoped to the scan&apos;s own team. The scan&apos;s owner can always do it; a teammate can only when the team resource-access check grants write on that scan. For a private personal scan there is no team, so the owner is the only one who can share it. Anyone else, including a team admin reaching for a teammate&apos;s private personal scan, gets a generic 404. The endpoint never confirms a scan exists to someone who cannot manage it.
- The Shared reports page lists every one of your links that still works (expired ones are filtered out the same way the viewer excludes them). Each row can open the share modal, toggle its public listing, or revoke it.
- The Public Scans directory is an unauthenticated, paginated, most-recent-first list of scans someone chose to make discoverable. Each entry links straight to its read-only report. A row appears only when all three conditions hold on the underlying scan.
- After creation, the listing status only changes through the explicit per-share toggle in the Shared reports row menu. That toggle requires an active share link (a scan with no link returns 400) and is scoped to the same owner or team-write check as sharing itself.
- The directory API is unauthenticated, so there is no session or key to throttle against. It is limited per IP to 60 requests a minute; over that returns a 429 with a Retry-After header.

### Code examples
```text
<a href="<value>/shared/YOUR_TOKEN" target="_blank" rel="noopener noreferrer" style="display: inline-block;"><img src="<value>/api/v3/badge/YOUR_TOKEN" alt="Secured by <value>" style="border: 0;"/></a>
```

```text
[![Secured by <value>](<value>/api/v3/badge/YOUR_TOKEN)](<value>/shared/YOUR_TOKEN)
```

## teams
Route: /docs/teams

### Sections
- **Overview** (`#overview`)
- **Creating a Team** (`#creating`)
- **Plan Limits** (`#plan-limits`)
- **Roles and Permissions** (`#roles`)
- **Invitations** (`#invitations`)
- **Sharing Scans** (`#sharing`)
- **Webhooks and Domains** (`#team-resources`)
- **API Endpoints** (`#endpoints`)

### Callouts
> **INFO: Team roles are not staff roles**
> A member&apos;s team role (owner, admin, manager, operator, member,
viewer) is completely separate from their account-level staff role (
user, support,{" "}
moderator, admin,{" "}
super_admin, and the specialist tiers) that
governs the /admin panel. The members list
surfaces a person&apos;s staff ro

### Notes
- A team is a group of accounts that can see each other&apos;s scans once those scans are shared into the team. Exactly one account is the owner (set at creation, never handed out by invite), and every other member joins through an emailed or in-app invitation. Membership attaches to an account, not an email address alone, so accepting an invite requires being signed in as the account the invite was sent to.
- The whole feature is gated behind the FEATURE_TEAMS flag. When it is off, the create endpoint returns 403 and no team routes do anything useful.
- POST /api/v3/teams with a name (2 to MAX_TEAM_NAME_LENGTH, 255 by default). The creator is inserted as the sole owner in the same transaction, and a URL slug is generated from the name plus a short timestamp suffix.
- Two independent caps apply, and both are read from the owner&apos;s plan, not the plan of whoever is doing the inviting: how many teams an account may own, and how many seats a team may hold. A seat is one member plus one pending, unexpired invite, so outstanding invites count against the cap until they are accepted, declined, or expire.
- There are six team roles. They are built from four underlying capabilities: manage_team (rename the team), manage_members (invite, remove, change roles), manage_scans (create and edit team-scoped scans), and view_reports (read shared reports), plus the owner-only delete_team. Every role holds view_reports.
- Manager and operator are deliberate opposites: a manager handles people and settings but does not run scans, while an operator runs scans and adjusts settings but does not handle onboarding. That is why the roles are not a single ladder.
- Because the roles are a partial order rather than a strict ranking, a caller may only invite, promote, demote, or remove someone at a role whose permission set is a subset of the caller&apos;s own (the canAssignTeamRole check). Without it, a manager (who has manage_members but not manage_scans) could promote someone to admin and hand out a capability the manager itself lacks, or evict a higher-privileged admin. The owner holds every permission, so the owner can act on any role; the owner&apos;s own role can never be changed or removed through the member routes.
- POST /api/v3/teams/members with sends an invite. role defaults to viewer and may be any role except owner. The caller needs manage_members, the role ceiling applies, and the request is rate-limited per user to stop invite spam from a compromised account.
- Both accept paths go through POST /api/v3/teams/accept-invite and both require a signed-in session:
- Either way, the accept enforces that the signed-in account&apos;s email matches the invite&apos;s email (a 403 otherwise, so a guessed inviteId is useless), that the invite has not expired (400), and that you are not already a member (400). List your own pending invites with GET /api/v3/teams/invitations, and decline one with DELETE /api/v3/teams/invitations (scoped to your own email).

### Code examples
```text
// POST /api/v3/teams
{ "name": "Platform Security" }

// 200
{
  "team": {
    "id": 42,
    "name": "Platform Security",
    "slug": "platform-security-lq9f3k",
    "role": "owner",
    "member_count": 1,
    "created_at": "2026-08-24T15:30:00.000Z"
  }
}
```

## triage
Route: /docs/triage

### Sections
- **Overview** (`#overview`)
- **Remediation tracking** (`#remediation`)
- **Support tickets** (`#tickets`)

### Callouts
> **INFO: The freshest value wins**
> The control seeds from the status the server attached to the
finding, then re-confirms against the API on open, so a change
made in another tab or session shows up rather than being silently
overwritten.

> **WARNING: Bulk is deliberately conservative**
> Status is always applied. Assignee and due date are applied only
when you actually set them in the bar, so a bulk "mark
fixed" does not wipe assignees or dates you set on individual
findings. The per-finding note is never touched by a bulk action.
Setting the bulk status to Open clears each selected

> **INFO: Per-user reply rate limit**
> Because every reply emails the other party, replies are rate
limited per user (not per IP, since a reply is always
authenticated) on the standard API budget. Hit it and the reply
returns a 429 telling you how long to wait. Opening tickets is
bounded separately by the 20-open-tickets cap.

### Notes
- splits the after-scan workflow into two things a scan report cannot do for you. The first is deciding what to do about each finding and remembering that decision: remediation tracking. The second is asking a human when a scan alone is not enough: support tickets. Both are private to you: remediation is per-user and never appears on a shared or public view of a scan, and a ticket is visible only to you, staff, and any teammate you explicitly loop in.
- Remediation tracking is separate from the accuracy feedback on a finding (confirmed, false positive, not applicable). That feedback tunes the global detection confidence model; remediation records what you have done about the finding and nothing else. The two controls sit next to each other on an open finding but never touch the same data.
- The HTTP endpoints below live under /api/v3/, the same base as the rest of the app. The support ticket UI lives on the Contact page under the Support Ticket option.
- Open any finding on your own scan and you get a Your remediation tracking control: a status, and once the status leaves Open, a note, an assignee, and a due date. It is stored per finding, per user, and it is remembered the next time you scan the same target.
- Five states, in the order they appear in the control. Open is the default and is never stored as a row; the other four persist.
- Once a finding is anything other than Open, three optional fields appear:
- The control seeds from the status the server attached to the finding, then re-confirms against the API on open, so a change made in another tab or session shows up rather than being silently overwritten.
- This is the part that makes tracking worth doing. A remediation row is keyed on the finding, not on the scan that surfaced it. The finding id is deterministic: the same check firing against the same URL always produces the same id, which is the same identity the compare, diff, and regression-alert features already rely on.
- So a finding you marked fixed on Monday still reads fixed when you rescan the same host on Friday, even though that is a brand new scan row. The status is attached only on the owner&apos;s own result-load paths (scan status and history); the public /shared/[token] and /host/[hostname] views never read it, so your private tracking never leaks onto a link you share. If the underlying table has not been migrated yet, the read fails soft to an empty map and the result page still loads.
- Setting one finding at a time is fine for a couple of them, but a fresh scan can surface dozens. The findings list on your own scan has an opt-in Select mode: the list stays clean (no checkboxes) until you turn it on, and only then do row checkboxes and a sticky bulk bar appear. Pick a status, optionally an assignee and a due date, and apply it to everything you selected, up to 200 findings per request.

### Code examples
```json
finding_id = <checkId>--<fnvHash(scannedUrl)>

// Deterministic: the same check against the same URL always
// yields the same id, so a remediation row is keyed on the
// finding, not on the scan_history row that surfaced it.
remediation key = (user_id, finding_id, finding_url)
```

```text
// POST /api/v3/scan/remediation/bulk
{
  "items": [
    { "findingId": "hsts-missing--9f2c1a", "findingUrl": "https://example.com" },
    { "findingId": "csp-missing--9f2c1a",  "findingUrl": "https://example.com" }
  ],
  "status": "in_progress",
  "assignee": "alex"
}
```

## Overview
Route: /docs

# ${APP_NAME} documentation
Paste a URL, get a ranked list of what is wrong with it and how to fix each one. These pages cover the REST API, webhooks, quotas, self-hosting, and the internals if you want to add a check of your own.

### Sections
- **First scan** (`#quick-start`)
- **The documentation set** (`#documentation`)
- **What gets checked** (`#coverage`)
- **Keeping pages out of a scan** (`#exclude-from-scan`)
- **Support and versions** (`#support`)

### Headings
- {section.title}

### Notes
- probes is optional. Leave it out and only the web checks run. Full request and response shapes are on the API reference .
- detections live in lib/scanner/checks-data/, one JSON file per category, each paired with a detector module in lib/scanner/checks/. Every check has a stable id, so a finding you triage today keeps the same id on the next scan and in the API response.
- Service probes are separate and opt-in. They open a bounded TCP socket, read the greeting, and report version disclosure and reachability for https:// target.
- Beyond the check catalogue, every scan also fingerprints the software the host runs (server, framework, CDN, analytics, and client-side libraries) and correlates any version it can read against known CVEs through OSV.dev and the NVD, enriched with CISA KEV and FIRST.org EPSS. A vulnerable version raises one aggregated finding that lists its CVE IDs.
- The full catalogue is served, unauthenticated, from GET /api/v3/finding-types. Use it if you are building an SDK and want every id ahead of time. See Developer documentation for the payload shape.
- When crawls a site for a multi-page scan, its crawler identifies itself as and reads /robots.txt before discovering pages. To keep specific paths out of a scan, add a group that names with Disallow rules:
- Only a group that names specifically is honored. A blanket User-agent: * rule does not fence the scanner out, so a site&rsquo;s general bot policy never quietly narrows a security scan you asked for. Rules are matched as standard robots.txt path prefixes.
- This affects page discovery only. Search engines follow their own * rules, so anything you disallow for stays fully indexable for them. And a URL you enter directly is always scanned, robots.txt or not: the rule shapes what the crawler wanders into, not what you deliberately point it at.
- If something here is wrong or missing, say so. Bug reports and doc corrections go to the issue tracker; anything account-specific goes through the contact form. Legal terms, the privacy policy, and the acceptable-use rules for scanning targets you do not own are on the legal pages .

### Code examples
```text
User-agent: <value>
Disallow: /checks
Disallow: /generated/
```

## Setup
Route: /docs/setup

### Sections
- **Prerequisites** (`#prerequisites`)
- **Installation Steps** (`#installation`)
- **Database Setup** (`#database`)
- **Environment Configuration** (`#environment`)
- **App Configuration** (`#config`)
- **Running the Application** (`#running`)
- **Verification** (`#verification`)
- **Troubleshooting** (`#troubleshooting`)
- **Deployment Options** (`#deployment`)
- **Docker Deployment** (`#docker`)
- **Schema Migration** (`#migration`)
- **Version Check** (`#version`)

### Callouts
> **INFO: Never commit .env**
> .env and{" "}
.env.local are git-ignored by default. If
you fork the repo, double-check .gitignore.

> **INFO: There is no YAML config file**
> Earlier (pre-v2.3.0) planning docs referenced a{" "}
config.yaml file. The current
implementation does not use one. All non-secret configuration is in{" "}
lib/config/config-values.ts; all secrets
are environment variables.

> **SUCCESS: Prerequisites**
> Docker 24+ and Docker Compose v2.

> **ERROR: HTTPS required**
> Put the app behind a reverse proxy (Caddy, Traefik, nginx) for TLS
termination. Cookie flags (secure) and CSP
headers assume HTTPS in production.

### Headings
- Step 1: Clone the Repository
- Step 2: Install Dependencies
- Option A: Dedicated database (no Docker)
- Option B: Docker Compose (recommended)
- Schema auto-creates on boot
- Create .env from the template
- Common changes
- Development (with hot reload)
- Production
- 1. Access the app
- 2. Sign up the first user
- 3. Promote to admin
- 4. Generate an API key
- 5. Run a scan
- {item.title}
- Vercel
- Self-hosted (Linux)
- Docker Compose
- Step 1: Project directory
- Step 2: Get docker-compose.yml
- Step 3: Configure .env
- Step 4: Start
- Step 5: Verify
- Common operations
- Run a migration

### Notes
- Before you begin, ensure you have the following installed:
- Allow-scripts for native packages (bcrypt, esbuild, sharp, unrs-resolver, core-js) are whitelisted in .npmrc.
- The included docker-compose.yml provisions Postgres with credentials vulnradar:vulnradar on port 5432. See the Docker section below.
- instrumentation.ts runs CREATE TABLE IF NOT EXISTS for every table on first server boot. No manual migration is required for a fresh database. For databases upgraded from an older schema, see Schema Migration .
- Secrets and per-deployment overrides go in .env (or .env.local for local-only overrides; Next.js loads .env.local with higher precedence than .env ).
- Open .env and fill in at minimum:
- Optional: SMTP, Stripe, Discord, Turnstile. Full reference on the Configuration page.
- .env and .env.local are git-ignored by default. If you fork the repo, double-check .gitignore.
- Non-secret deployment tunables live in lib/config/config-values.ts. Branding, app name, and SEO values are baked in at build time, so edit those before the first build and restart to pick up changes. Most of the rest (rate limits, feature flags, billing, scan timeouts) can also be changed at runtime after signup, from /admin&rsquo;s Settings tab, with no restart. See Configuration for which is which.
- Earlier (pre-v2.3.0) planning docs referenced a config.yaml file. The current implementation does not use one. All non-secret configuration is in lib/config/config-values.ts; all secrets are environment variables.

### Code examples
```bash
<value>  # Check version
```

```bash
git clone https://github.com/<value>.git
cd <value>.dev
```

```sql
psql -U postgres

CREATE DATABASE vulnradar;
CREATE USER vulnradar_user WITH PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE vulnradar TO vulnradar_user;
\\q
```

```bash
# Database
DATABASE_URL=postgresql://vulnradar:your-password@localhost:5432/vulnradar
DATABASE_SSL=false

# Public URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# API key encryption (REQUIRED). Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key
```

```bash
npm run build
npm start
```

```bash
docker compose exec postgres psql -U vulnradar -d vulnradar -c \\
  "UPDATE users SET role = 'admin' WHERE email = 'you@example.com'"
```

```bash
curl -X POST "<value>/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'
```

```bash
docker --version
docker compose version
```

## Browser Extension
Route: /docs/extension

# Browser Extension
Scan the page you're actually looking at, without pasting a URL. The extension runs the same engine as the web app, connected to your own account with an API key.

### Sections
- **Overview** (`#overview`)
- **Install** (`#install`)
- **Scanning from the popup** (`#scanning`)
- **The on-page card** (`#reputation-card`)
- **Auto-scan modes** (`#auto-scan`)
- **Pages you're signed into** (`#signed-in-pages`)
- **Settings** (`#settings`)
- **Permissions and privacy** (`#permissions`)

### Callouts
> **SUCCESS: Live on the Chrome Web Store**
> Firefox Add-ons review is still in progress. Chrome and other Chromium
browsers (Edge, Brave) can install straight from the store; Firefox
needs the packaged release below until AMO approves it.

### Headings
- Chrome / Edge
- Firefox

### Notes
- The extension is a thin client over the same scan engine and the same account as the web app: it doesn't store findings locally beyond a small recent-history cache, and it doesn't run its own copy of the checks. Two things it can do that the web app can't from a URL bar alone: react to the page you're currently on (the on-page reputation card, auto-scan on navigation) and read a page the way you're actually seeing it, cookies and all, when you ask for that explicitly.
- One click from the store. Updates itself from here on, no manual re-download.
- One click from Firefox Add-ons. Updates itself from here on, no manual re-download.
- Need an API key first? Generate one from #api-keys while logged in.
- Click the toolbar icon on any page and hit Scan. Quick and Deep mirror the same two modes on the web app's scan form: Quick runs the fast header/TLS/content family checks, Deep also crawls linked pages on the same host. Which check families run is controlled from the extension's own Settings, independent of your web app defaults, so you can keep the popup fast day-to-day and still reach every check when you want it.
- A scan started from the popup counts against the same daily limit as any other scan on your account and shows up in your regular scan history: there's no separate extension-only history to lose track of.
- When enabled, a small card can appear in the corner of a page reporting one of two things: this host has been scanned before (and what its last result was), or it hasn't and you can scan it now. Site alerts are entirely separate from auto-scan below: this is about surfacing information, not triggering a scan on its own.
- Off by default. Three modes decide when a scan fires without you clicking anything:
- A whitelist/blacklist and a global pause are available in Settings for hosts or stretches of time you never want auto-scanned, regardless of mode.
- Open the full settings page from the popup's gear icon. Everything above (check families, service probes, auto-scan mode and throttle, notification threshold, card position, mute lists, and theme) lives there and is stored locally in the browser, not on your account, so it's per-install rather than per-user.

## Self-Hosting
Route: /docs/self-hosting

### Sections
- **Overview** (`#overview`)
- **Hardware Requirements** (`#hardware`)
- **Prerequisites** (`#prerequisites`)
- **Clone and Configure** (`#clone`)
- **Create .env** (`#env`)
- **AI Features (Optional)** (`#ai`)
- **docker-compose** (`#docker`)
- **Start the Stack** (`#start`)
- **First Admin User** (`#admin`)
- **TLS (Reverse Proxy)** (`#tls`)
- **Configure Stripe Webhook (If Billing)** (`#stripe`)
- **Backups** (`#backups`)
- **Updates** (`#updates`)
- **Troubleshooting** (`#troubleshooting`)
- **Security Checklist** (`#security`)

### Callouts
> **INFO: Time estimate**
> About 30 minutes if you already have Docker + a domain pointed at your
server.

> **WARNING: Bring a real context window**
> These features load actual scan output into the prompt, not a short
chat message. As a floor, use a model with around{" "}
300,000 tokens of
context. A small local model, e.g. Ollama&rsquo;s default{" "}
llama3.2, does not have that headroom and
will degrade or break outright once enough context is 

> **WARNING: pg_dump must be installed (postgresql-client)**
> The backup and restore scripts shell out to{" "}
pg_dump and psql,
which come from the postgresql-client{" "}
system package. Minimal Node images, including the{" "}
Pterodactyl Node egg,
do not ship it, so backups fail with{" "}
pg_dump not found and no{" "}
backups/ directory is created. Install i

> **WARNING: Use a persistent volume**
> BACKUP_DIR defaults to{" "}
./backups at the app root. On a container
that is ephemeral: mount a persistent/host volume there (or set{" "}
BACKUP_DIR to a mounted path), otherwise
every backup is wiped on the next rebuild or redeploy. Set{" "}
BACKUP_OFFSITE_UPLOAD_URL as well so a copy
leaves the h

> **INFO: Encryption and restore**
> Each dump is encrypted with AES-256-GCM. When{" "}
BACKUP_ENCRYPTION_KEY is unset the script
falls back to API_KEY_ENCRYPTION_KEY, so a
plaintext backup is never written by accident. A separate{" "}
BACKUP_ENCRYPTION_KEY is still recommended
for defense in depth. An encrypted .enc{" "}
file is resto

> **WARNING: After schema changes**
> If instrumentation.ts changed in the new
release, run npm run db:migrate inside the
app container to apply the diff interactively. The script is
idempotent; safe to re-run.

### Headings
- Option A: Stripe dashboard
- Option B: auto-setup endpoint
- Backup environment variables

### Notes
- The fastest path to running yourself. Assumes a single Linux server with Docker. For Kubernetes, multi-region, or bare-metal setups, adapt accordingly.
- Edit lib/config/config-values.ts to set:
- If you don&apos;t want billing features, set:
- Full reference on the Configuration page.
- These features load actual scan output into the prompt, not a short chat message. As a floor, use a model with around 300,000 tokens of context. A small local model, e.g. Ollama&rsquo;s default llama3.2, does not have that headroom and will degrade or break outright once enough context is loaded.
- The default docker-compose.yml provisions Postgres + the app container + a healthcheck + a smoke test. The app reads .env via env_file.
- On boot, instrumentation.ts runs CREATE TABLE IF NOT EXISTS for every table. The meta row in vulnradar_schema_meta is written on the first successful migration. Look for Database schema verified successfully in the logs.
- does not terminate TLS itself. Put a reverse proxy in front. Minimal Caddy config:
- Caddy auto-provisions a Let&apos;s Encrypt certificate.
- For nginx, see the official nginx + Next.js guide .

### Code examples
```typescript
git clone https://github.com/<value>.git
cd vulnradar.dev

# Generate a 32-byte API encryption key (64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → paste into API_KEY_ENCRYPTION_KEY
```

```bash
export const CONFIG_BILLING_ENABLED = false;
```

```bash
# Required
DATABASE_URL=postgresql://vulnradar:STRONG_PASSWORD@postgres:5432/vulnradar
DATABASE_SSL=false
API_KEY_ENCRYPTION_KEY=<paste your 64-char hex>
NEXT_PUBLIC_APP_URL=https://scanner.yourdomain.com

# Optional: SMTP for transactional email
SMTP_HOST=smtp.yourdomain.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@yourdomain.com

# Optional: Discord OAuth
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...

# Optional: Cloudflare Turnstile
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...

# Optional: Stripe (only if CONFIG_BILLING_ENABLED=true)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

```caddyfile
UPDATE users
SET role = 'admin'
WHERE email = 'you@yourdomain.com';
```

```bash
# Log in via the web UI as an admin user, then export the cookie:
curl -b cookies.txt https://scanner.yourdomain.com/api/v3/stripe/setup-webhook
# First call: returns { success: true, webhookSecret: "whsec_..." }
# Paste the secret into STRIPE_WEBHOOK_SECRET in .env and restart.
```

```text
export const CONFIG_APP_NAME = "YourBrand Scanner";
export const CONFIG_APP_URL = "https://scanner.yourdomain.com";
export const CONFIG_APP_REPO = "yourname/your-repo";
export const CONFIG_DISCORD_INVITE_URL = ""; // optional

export const CONFIG_SUPPORT_EMAIL = "support@yourdomain.com";
export const CONFIG_LEGAL_EMAIL = "legal@yourdomain.com";
export const CONFIG_SECURITY_EMAIL = "security@yourdomain.com";
export const CONFIG_ENTERPRISE_EMAIL = "enterprise@yourdomain.com";
export const CONFIG_NOREPLY_EMAIL = "noreply@yourdomain.com";
```

```text
cp .env.example .env
```

```text
docker compose up -d
docker compose logs -f app   # watch startup
```

## Configuration
Route: /docs/config

### Sections
- **Overview** (`#overview`)
- **Quick Reference** (`#quick-reference`)
- **Architecture** (`#architecture`)
- **Layer 1: Static App Config** (`#layer-1`)
- **Admin Settings Page** (`#admin-settings`)
- **Layer 2: Runtime Secrets** (`#layer-2`)
- **AI Providers & Models** (`#ai-models`)
- **Self-Hosting Checklist** (`#checklist`)
- **Validation** (`#validation`)

### Callouts
> **INFO: TL;DR**
> Most things you want to change live in{" "}
lib/config/config-values.ts. Secrets go in{" "}
.env. Edit{" "}
config-values.ts first.

> **INFO: ~30 second propagation**
> The resolver caches the whole table for 30 seconds so a value read
on every request (like a rate limit) does not hit Postgres every
time. The admin who makes a change sees it immediately (the write
clears that process&rsquo;s cache); every other running instance
picks it up the next time its own 30 

> **WARNING: AI features need real context**
> Verifying findings or summarizing a full scan means loading a lot of
scan output into the prompt. As a floor, look for a model with
around 300,000 tokens{" "}
of context. A small local model such as Ollama&rsquo;s default{" "}
llama3.2 has nowhere near that: it will
degrade or break outright as more

### Notes
- has a two-layer configuration model designed to keep secrets out of source code while making non-secret deployment settings easy to customize for self-hosters.
- Single source of truth: lib/config/config-values.ts exports raw CONFIG_* constants. Everything else (types, derived objects, route maps) is built from those constants. Edit config-values.ts to customize your deployment.
- Edit lib/config/config-values.ts to change the shipped default for any of these. Whether that edit needs a restart depends on the setting&rsquo;s tier: General, Branding, and SEO values are baked into the build and need a rebuild either way, but most of the rest (rate limits, feature flags, billing, scan timeouts, auth windows, and more) can also be overridden at runtime, without touching source, from the Admin Settings Page below.
- All values are per-IP unless noted. The window is in minutes. Internally lib/config/constants.ts multiplies by 60 for the per-second window.
- The /demo page lets unauthenticated visitors run scans. Rate-limited per IP.
- Disable demo mode entirely with CONFIG_FEATURE_DEMO_MODE = false.
- Plan catalogs (limits per plan) live in lib/billing/catalog.ts. The values below only configure the upper bounds and the retention window.
- of the values above also have a row in the system_settings database table and a control on /admin &rsquo;s Settings tab, sign in as an admin to reach it. The tab list there () and every field on it is generated from the same registry that generates the reference tables below, so the two cannot drift apart.
- Every setting on the page is one of two tiers, shown as a badge per tab rather than repeated on every field:
- The database wins because that is the layer the admin panel edits. An environment variable of the same name comes next, so a container can pin a value without a database write. The shipped CONFIG_* constant is the last resort, which is why a fresh install with an empty system_settings table behaves exactly as it does today.

### Code examples
```text
lib/config/
├── config-values.ts        ← SOURCE OF TRUTH (raw CONFIG_* constants)
├── constants.ts            ← Re-exports + derived route/error maps
├── client-constants.ts     ← Client-safe subset (no server-only values)
├── config.ts               ← Cached loader (loadConfig, getConfigValue)
└── public-paths.ts         ← Middleware public-path allowlist

lib/types/
└── config.ts                ← Type definitions + DEFAULT_CONFIG
                              (DERIVED from config-values.ts)
```

```text
resolve(key) = database value  ??  environment override  ??  shipped default
```

## API Reference
Route: /docs/api

### Sections
- **Overview** (`#overview`)
- **Authentication** (`#authentication`)
- **Endpoints** (`#endpoints`)
- **Code Examples** (`#code-examples`)
- **CI/CD Gating** (`#ci-cd`)
- **Rate Limiting** (`#rate-limiting`)
- **Error Handling** (`#error-handling`)
- **Before You Ship This** (`#best-practices`)

### Callouts
> **WARNING: Keys leak, so rotate them**
> Each plan caps how many active keys you can hold (one on the
free tier, more on paid plans). Keep them out of version control
and rotate with{" "}
POST /api/v3/keys/[id]/rotate, which
deletes the old key in the same call.

> **INFO: POST /scan does not return findings**
> The scan runs as a background job: the create call only returns a{" "}
scanId, so any gate that reads{" "}
.summary straight off that response is
reading a field that doesn&apos;t exist yet. The action above polls{" "}
GET /scan/status/&#123;scanId&#125; until{" "}
status is completed{" "}
before ch

> **INFO: Sessions and keys count separately**
> A scan run from the web app decrements a per-user counter. A scan
run with a Bearer key decrements that key&apos;s counter. Both emit
the same X-RateLimit-* headers, but the
reset is midnight UTC for sessions and a rolling 24 hours for keys.

### Endpoints
#### `POST /scan`: Create a Scan
Start a vulnerability scan against a target. Pass a hostname or a full URL; we auto-prepend https:// if you omit the scheme. Service probes are opt-in via the probes field. The scan runs as a background job: this call returns immediately with a scan id, and you poll GET /scan/status/{scanId} for progress and the final result.

- **Request body:**
```json
{
  "url": "example.com",
  "probes": ["ssh:22", "smtp:587"]
}
```

- **Response (200):**
```json
{
  "scanId": 12345,
  "status": "running"
}
```

#### `GET /scan/status/{id}`: Get Scan Job Status
Poll a scan job started by POST /scan or POST /scan/crawl. Returns live progress while the job runs and the full result once it completes.

- **Response (200):**
```json
{
  "status": "running",
  "currentCategory": "headers",
  "categoriesCompleted": 4,
  "categoriesTotal": 12,
  "elapsedMs": 1820
}
```

#### `DELETE /scan/status/{id}`: Cancel a Scan Job
Cancel a scan that is still pending or running. Has no effect on a scan that already finished.

- **Response (200):**
```json
{
  "status": "failed",
  "cancelled": true
}
```

#### `POST /scan/authenticated`: Authenticated Scan
Scan a single page after logging in first. Credentials are supplied in this one request and are never stored: they live only in memory for the duration of the call. Unlike POST /scan, this endpoint is synchronous (no polling) and scans exactly one page; it does not crawl.

- **Request body:**
```json
{
  "url": "https://example.com/dashboard",
  "auth": {
    "method": "form",
    "loginUrl": "https://example.com/login",
    "username": "demo@example.com",
    "password": "correct-horse-battery-staple"
  }
}
```

- **Response (200):**
```json
{
  "scanHistoryId": 12345,
  "url": "https://example.com/dashboard",
  "scannedAt": "2026-08-05T15:30:00.000Z",
  "duration": 2210,
  "findings": [],
  "summary": { "critical": 0, "high": 0, "medium": 1, "low": 0, "info": 0, "total": 1 },
  "responseHeaders": { "content-type": "text/html; charset=utf-8" },
  "authReport": { "status": "authenticated", "method": "form" }
}
```

#### `POST /scan/bulk`: Bulk Scan
Submit multiple URLs in one request, up to your plan's URLs-per-bulk-request limit (5/10/25/100 for free/core/pro/elite). Each URL counts as one dailyScans quota unit, checked and consumed atomically per URL as the batch runs, regardless of auth method.

- **Request body:**
```json
{
  "urls": [
    "https://example.com",
    "https://example.org",
    "https://example.net"
  ]
}
```

- **Response (200):**
```json
{
  "total": 3,
  "successful": 2,
  "failed": 1,
  "skipped": 0,
  "results": [
    { "url": "https://example.com/", "success": true, "scanHistoryId": 1001, "summary": { "critical": 0, "high": 1, "medium": 2, "low": 1, "info": 0, "total": 4 } },
    { "url": "https://example.org/", "success": true, "scanHistoryId": 1002, "summary": { "critical": 0, "high": 0, "medium": 0, "low": 1, "info": 2, "total": 3 } },
    { "url": "https://example.net/", "success": false, "error": "Could not reach https://example.net/." }
  ]
}
```

#### `POST /scan/verify`: AI-Verify a Scan's Findings
Re-run every finding on a scan you own through AI verification and persist the result: each finding gets aiVerdict (confirmed, possible_fp, or uncertain), aiConfidence, and aiReason written back onto the scan, so a later GET /scan/status/{scanId} or GET /history/{id} shows them in place.

- **Request body:**
```json
{
  "scanHistoryId": 12345
}
```

- **Response (200):**
```json
{
  "success": true,
  "findings": [
    {
      "id": "hsts-missing",
      "title": "HSTS Header Missing",
      "aiVerdict": "confirmed",
      "aiConfidence": 92,
      "aiReason": "No Strict-Transport-Security header on any response checked."
    }
  ]
}
```

#### `POST /history/{id}/summary`: Generate an AI Scan Summary
Generate a short plain-English summary of a completed scan you own and persist it onto the scan's result_meta.aiSummary. A plain call returns the cached summary (no AI call, no rate-limit cost) once one already exists; pass ?regenerate=true to force a fresh one.

- **Response (200):**
```json
{
  "success": true,
  "summary": "This scan of example.com found 4 issues, none critical. The most notable is a missing HSTS header, which leaves the first request on a network exposed to downgrade attacks.",
  "cached": true
}
```

#### `POST /scan/crawl`: Deep Crawl Scan
Crawl the target and scan each discovered page. Either provide a pre-selected URL list or let the crawler discover links. Up to 15 pages per crawl. Like POST /scan, this runs as a background job: the call returns immediately with a scan id, and you poll GET /scan/status/{scanId} for progress and the final aggregate result.

- **Request body:**
```json
{
  "url": "https://example.com",
  "urls": ["https://example.com/about", "https://example.com/contact"]
}
```

- **Response (200):**
```json
{
  "scanId": 12346,
  "status": "running"
}
```

#### `POST /scan/crawl/discover`: Discover URLs
Discover links from a target without scanning them. Useful for previewing what a crawl would cover.

- **Request body:**
```json
{
  "url": "https://example.com"
}
```

- **Response (200):**
```json
{
  "urls": [
    "https://example.com",
    "https://example.com/about",
    "https://example.com/contact",
    "https://example.com/blog"
  ],
  "total": 4
}
```

#### `POST /scan/discover`: Discover Subdomains
Enumerate subdomains for a domain. Aggregates results from crt.sh, HackerTarget, Subdomain.Center, RapidDNS, and brute-force DNS.

- **Request body:**
```json
{
  "url": "https://example.com",
  "forceRefresh": false
}
```

- **Response (200):**
```json
{
  "subdomains": [
    { "host": "www.example.com", "source": "crt.sh" },
    { "host": "api.example.com", "source": "rapiddns" },
    { "host": "staging.example.com", "source": "brute" }
  ]
}
```

#### `GET /history`: List Scan History
Returns up to 100 most recent scans for the authenticated user. Retention follows the user's plan (Free: 30 days, Core: 90, Pro/Elite: forever). Staff roles bypass retention.

- **Response (200):**
```json
{
  "scans": [
    {
      "id": 1,
      "url": "https://example.com",
      "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
      "findings_count": 7,
      "duration": 1423,
      "scanned_at": "2026-03-10T15:30:00.000Z",
      "source": "api",
      "tags": ["production", "weekly-scan"]
    }
  ]
}
```

#### `GET /history/{id}`: Get Scan Details
Return full scan details: findings, response headers, scan metadata. Owner or same-team member can view.

- **Response (200):**
```json
{
  "url": "https://example.com",
  "scannedAt": "2026-03-10T15:30:00.000Z",
  "duration": 1423,
  "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
  "findings": [
    { /* full Vulnerability object, see /scan response */ }
  ],
  "responseHeaders": {
    "content-type": "text/html; charset=utf-8",
    "server": "nginx/1.18.0"
  }
}
```

#### `DELETE /history`: Delete All Scan History
Permanently delete every scan and tag for the authenticated user. Cannot be undone.

- **Response (200):**
```json
{
  "success": true,
  "deleted": 47
}
```

#### `DELETE /history/{id}`: Delete a Single Scan
Permanently delete a single scan by ID. Owner only.

- **Response (200):**
```json
{
  "success": true,
  "message": "Scan deleted successfully"
}
```

#### `PATCH /history/{id}`: Update Scan Notes
Update the user note on a scan. Owner only.

- **Request body:**
```json
{
  "notes": "Investigating HSTS issue with infra team"
}
```

- **Response (200):**
```json
{
  "success": true
}
```

#### `POST /browser/sessions`: Start a Browser Session
Open an ephemeral BrowserBase session so the user can view the scanned site from a remote, sandboxed browser. Sessions are time-limited and end automatically when the popup closes. Only enabled when BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID are configured on the server.

- **Request body:**
```json
{
  "url": "https://example.com",
  "ttlSeconds": 300
}
```

- **Response (200):**
```json
{
  "session": {
    "id": "01HXY...",
    "status": "RUNNING",
    "url": "https://example.com",
    "debuggerUrl": "https://www.browserbase.com/devtools/inspector.html?wss=connect.browserbase.com%2Fdebug%2F...",
    "debuggerFullscreenUrl": "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.browserbase.com%2Fdebug%2F...",
    "connectUrl": "wss://connect.browserbase.com/debug/...",
    "liveViewerUrl": "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=...&navbar=false",
    "expiresAt": "2026-06-26T18:25:55.722+00:00"
  },
  "expiresInSeconds": 300
}
```

#### `GET /browser/sessions?id={id}`: Read Browser Session
Fetch the latest BrowserBase session metadata (status, current URL, viewer URL). Used by the popup page to refresh after the user reconnects.

- **Response (200):**
```json
{
  "session": {
    "id": "bb_session_abc123",
    "status": "RUNNING",
    "url": "https://example.com/login",
    "liveViewerUrl": "https://app.browserbase.com/..."
  }
}
```

#### `DELETE /browser/sessions?id={id}`: End Browser Session
End a BrowserBase session early. Idempotent, so it is safe to call from window.onbeforeunload.

- **Response (200):**
```json
{
  "ended": true,
  "id": "bb_session_abc123"
}
```

#### `GET /api/version`: Version Check
Compare installed version against the latest GitHub release. Unauthenticated. Cached upstream of GitHub for 1 hour.

- **Response (200):**
```json
{
  "current": "${APP_VERSION}",
  "engine": "${ENGINE_VERSION}",
  "latest": "${APP_VERSION}",
  "status": "up-to-date",
  "message": "You're running the latest version.",
  "release_url": "https://github.com/${APP_REPO}/releases/tag/v${APP_VERSION}"
}
```

#### `GET /finding-types`: Finding Types
Returns the full catalogue of detection checks. Use this to display human-readable titles, categorize findings, or build SDKs that know every check ID ahead of time.

- **Response (200):**
```json
{
  "success": true,
  "count": 754,
  "categories": {
    "content": 144,
    "headers": 138,
    "code": 121,
    "secrets-extended": 58,
    "information-disclosure": 47,
    "vibe-code": 37,
    "api": 36,
    "client-side": 26,
    "cookies": 29,
    "configuration": 24,
    "email": 22,
    "supply-chain": 14,
    "dns": 19,
    "host-validation": 13,
    "tls": 11,
    "ssl": 7,
    "active-probes": 5,
    "reputation": 3
  },
  "data": [
    {
      "id": "hsts-missing",
      "type": "header",
      "title": "HSTS Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "HTTP Strict Transport Security header is not set."
    },
    {
      "id": "csp-missing",
      "type": "header",
      "title": "Content Security Policy Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "Content Security Policy header is not set."
    }
  ]
}
```

#### `GET /keys`: List API Keys
List API keys for the authenticated user. Secret values are never returned.

- **Response (200):**
```json
{
  "keys": [
    {
      "id": 1,
      "name": "CI",
      "prefix": "vr_live_abc12345",
      "created_at": "2026-03-10T15:30:00.000Z",
      "last_used_at": "2026-03-10T16:00:00.000Z",
      "daily_limit": 150,
      "revoked_at": null
    }
  ]
}
```

#### `POST /keys`: Create API Key
Generate a new API key. The raw value is returned ONLY in this response, so copy and store it immediately. The number of active keys you can hold depends on your plan.

- **Request body:**
```json
{
  "name": "CI"
}
```

- **Response (200):**
```json
{
  "id": 1,
  "name": "CI",
  "key": {
    "raw_key": "vr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "prefix": "vr_live_xxxxxxxx",
    "daily_limit": 50
  }
}
```

#### `POST /keys/{id}/rotate`: Rotate API Key
Hard-delete the key and create a new one with the same name. Returns the new raw key once.

- **Response (200):**
```json
{
  "id": 2,
  "name": "CI",
  "key": { "raw_key": "vr_live_…", "prefix": "vr_live_…", "daily_limit": 50 }
}
```

#### `POST /keys/{id}/revoke`: Revoke API Key
Set revoked_at on the key. The key stops working immediately.

- **Response (200):**
```json
{
  "success": true
}
```

#### `GET /domains`: List Domains
Your verified and pending domains, plus any assigned to a team you belong to.

- **Response (200):**
```json
{
  "domains": [
    {
      "id": 12,
      "domain": "example.com",
      "team_id": null,
      "status": "verified",
      "verification_method": "dns_txt",
      "created_at": "2026-08-01T00:00:00.000Z",
      "verified_at": "2026-08-01T00:05:00.000Z",
      "last_checked_at": "2026-08-01T00:05:00.000Z",
      "last_check_error": null,
      "verificationRecordName": "_vulnradar-verify.example.com"
    }
  ]
}
```

#### `POST /domains`: Add a Domain
Add a domain (or subdomain) pending verification. Returns a fresh DNS TXT record to publish. Verifying a domain covers every subdomain under it; it does not require ownership proof up front, since publishing the returned token in DNS is exactly what proves it.

- **Request body:**
```json
{
  "domain": "example.com"
}
```

- **Response (200):**
```json
{
  "id": 12,
  "domain": "example.com",
  "status": "pending",
  "createdAt": "2026-08-01T00:00:00.000Z",
  "verificationRecordName": "_vulnradar-verify.example.com",
  "verificationRecordValue": "vulnradar-verify=<64-char token>"
}
```

#### `POST /domains/{id}/verify`: Verify a Domain Now
Looks up the DNS TXT record right now and updates the domain's status. Safe to call repeatedly while fixing a typo'd record.

- **Response (200):**
```json
{
  "verified": true,
  "status": "verified"
}
```

#### `DELETE /domains?id={id}`: Remove a Domain
Removes a domain. Active Probing stops being allowed against it (and its subdomains) immediately.

- **Response (200):**
```json
{
  "success": true
}
```

### Headings
- Getting a key
- Try these calls in your browser
- GitLab CI
- Command line
- Headers on a successful response
- Body of a 429
- Create a scan
- List scan history
- Get scan details

### Notes
- Authentication is either the session cookie the web app already holds, or a Bearer API key prefixed vr_live_ ( CONFIG_API_KEY_PREFIX). Which one you use changes how quota is counted, so read Rate Limits before you wire this into CI.
- Prefer a machine-readable spec? The OpenAPI 3.1 description of this API lives at /api/v3/openapi.json. Import it into Postman, Insomnia, or Bruno, or try calls right in the browser on the API playground .
- Each plan caps how many active keys you can hold (one on the free tier, more on paid plans). Keep them out of version control and rotate with POST /api/v3/keys/[id]/rotate, which deletes the old key in the same call.
- The API Playground loads this same spec and sends real requests: pick an endpoint, paste a key, and read the live response. Your key stays in the browser and is never stored.
- The same three calls in curl, JavaScript, and Python. Swap the placeholder key and they run as-is. The Python tab uses the official SDK (pip install vulnradar, source at github.com/VulnRadar/Python-SDK ) instead of raw HTTP calls.
- Finding IDs are stable, so a scan can gate a pull request: fail the build when critical or high findings show up, without hand-rolling the poll loop yourself.
- Store your API key as a repo secret named VULNRADAR_TOKEN, never hardcoded in the workflow. Self-hosting? Point api-base-url at your own deployment's /api/v3.
- The same gate as a GitLab CI job. Add VULNRADAR_TOKEN as a masked CI/CD variable, then include the template and set the URL:
- Prefer not to include a remote file? Copy the job straight from the template into your own .gitlab-ci.yml. Self-hosting? Override VR_API_BASE with your deployment's /api/v3.
- Same gate, from any shell or CI, dependency-free (Node 18+):

### Code examples
```yaml
- uses: <value>/.github/actions/scan-gate@main
  with:
    url: https://your-staging-url.com
    api-key: \<value>}
    # Optional, both default to 0:
    max-critical: 0
    max-high: 0
```

```yaml
include:
  - remote: "<value>/gitlab/vulnradar-scan.gitlab-ci.yml"

vulnradar_scan:
  variables:
    VR_URL: "https://your-staging-url.com"
    # Optional, both default to 0:
    VR_MAX_CRITICAL: "0"
    VR_MAX_HIGH: "0"
```

```bash
VULNRADAR_TOKEN=your-token npx vulnradar scan https://your-staging-url.com --max-high 0
```

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 150
X-RateLimit-Remaining: 147
X-RateLimit-Used: 3
X-RateLimit-Policy: daily
X-RateLimit-Reset: 2026-03-12T00:00:00.000Z
```

```json
{
  "error": "Daily scan limit reached. Resets at 2026-03-12T00:00:00Z.",
  "limit": 150,
  "used": 150,
  "remaining": 0,
  "resets_at": "2026-03-12T00:00:00Z"
}
```

```http
Authorization: Bearer YOUR_API_KEY_HERE
```

## Webhooks
Route: /docs/webhooks

# Webhooks
Retrieve all webhooks for the authenticated user.

### Sections
- **Overview** (`#overview`)
- **Supported Platforms** (`#supported-platforms`)
- **API Endpoints** (`#endpoints`)
- **Webhook Payloads** (`#payloads`)
- **Security** (`#security`)
- **Integration Examples** (`#examples`)

### Headings
- Discord
- Slack
- Generic
- Creating a Discord webhook
- Local development: receive on webhook.site

### Notes
- detects the platform by matching the URL pattern. Override with the type body field if needed.
- Manage webhooks through these session-authenticated endpoints (the /api/v3/webhooks family requires a logged-in user; API keys are not accepted).
- Each platform receives a tailored payload. The summary object is the same in all three: critical, high, medium, low, info, total.
- Embed color: 0xef4444 (red, any critical), 0xf97316 (orange, any high), 0xeab308 (yellow, any medium), 0x22c55e (green, otherwise).
- Delivered with Content-Type: application/json, User-Agent: -Webhook/1.0, and (if the webhook has a secret) an X-VulnRadar-Signature header -- see Security below.

### Code examples
```json
{
  "embeds": [
    {
      "title": "<value> Scan Complete",
      "description": "Scan finished for **https://example.com**",
      "color": 15158332,
      "fields": [
        { "name": "Critical", "value": "1", "inline": true },
        { "name": "High", "value": "2", "inline": true },
        { "name": "Medium", "value": "1", "inline": true },
        { "name": "Low", "value": "1", "inline": true },
        { "name": "Info", "value": "0", "inline": true },
        { "name": "Total Issues", "value": "5", "inline": true },
        { "name": "Duration", "value": "1.4s", "inline": true }
      ],
      "footer": { "text": "<value> Security Scanner" },
      "timestamp": "2026-03-10T15:30:00.000Z"
    }
  ]
}
```

```json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "<value> Scan Complete"
      }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*URL:* https://example.com" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Critical:* 1" },
        { "type": "mrkdwn", "text": "*High:* 2" },
        { "type": "mrkdwn", "text": "*Medium:* 1" },
        { "type": "mrkdwn", "text": "*Low:* 1" },
        { "type": "mrkdwn", "text": "*Total:* 5" },
        { "type": "mrkdwn", "text": "*Duration:* 1.4s" }
      ]
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Sent by <value> Security Scanner" }
      ]
    }
  ]
}
```

```json
{
  "event": "scan.completed",
  "data": {
    "url": "https://example.com",
    "summary": {
      "critical": 1, "high": 2, "medium": 1, "low": 1, "info": 0, "total": 5
    },
    "findings_count": 5,
    "duration": 1423,
    "scanned_at": "2026-03-10T15:30:00.000Z"
  }
}
```

## Rate Limits
Route: /docs/rate-limits

### Sections
- **Overview** (`#overview`)
- **Daily Quotas by Plan** (`#limits-by-plan`)
- **Per-IP Limits** (`#ip-rate-limits`)
- **Rate Limit Headers** (`#headers`)
- **Handling 429 Responses** (`#handling`)
- **Best Practices** (`#best-practices`)

### Callouts
> **INFO: Where the numbers come from**
> Daily quotas are defined in{" "}
lib/billing/catalog.ts (one entry per plan:{" "}
dailyScans and{" "}
apiRequestsPerDay). New API keys default to{" "}
CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50 (
lib/config/config-values.ts).

> **INFO: Staff accounts have no limit**
> Users with role admin,{" "}
moderator, or{" "}
support are exempt from daily quotas (
daily-limits.ts returns{" "}
Infinity).

> **SUCCESS: Crawl count semantics**
> For Bearer-authenticated deep crawls (
/api/v3/scan/crawl
), the call itself counts as{" "}
1 daily quota unit. For
session-authenticated crawls, each scanned page counts as 1 unit (10
pages = 10 quota units). Discovery (
/api/v3/scan/crawl/discover) counts as 1
unit regardless of how many URLs it r

> **INFO: Not the same as IP session binding**
> These are frequency limits: how often a given IP or key may call an
endpoint. A separate, optional setting can additionally bind a
session or API key to the subnet it started on and end it on a
mismatch. That is an identity check, off by default, documented on
the{" "}

Configuration
{" "}
page, not

> **INFO: Reset semantics differ by auth**
> For session auth, the
daily counter resets at{" "}
00:00 UTC. For{" "}
API-key auth, the
counter is a rolling 24-hour window anchored to the oldest usage in
the current period. The same{" "}
X-RateLimit-Reset header reflects whichever
applies.

### Headings
- 429 response
- Exponential backoff (TypeScript)
- Python

### Notes
- Two separate limit systems protect the platform. They are enforced in different places and behave differently on overflow.
- Two separate counters: scans/day enforced for session-authenticated users, and API requests/day enforced for Bearer-authenticated API keys.
- Daily quotas are defined in lib/billing/catalog.ts (one entry per plan: dailyScans and apiRequestsPerDay). New API keys default to CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50 ( lib/config/config-values.ts).
- Users with role admin, moderator, or support are exempt from daily quotas ( daily-limits.ts returns Infinity).
- IP-based rate limits are configured in lib/config/config-values.ts as CONFIG_RATE_LIMIT_*_ATTEMPTS + _WINDOW_MINUTES pairs. The window is converted to seconds at boot.
- For Bearer-authenticated deep crawls ( /api/v3/scan/crawl ), the call itself counts as 1 daily quota unit. For session-authenticated crawls, each scanned page counts as 1 unit (10 pages = 10 quota units). Discovery ( /api/v3/scan/crawl/discover) counts as 1 unit regardless of how many URLs it returns.
- These are frequency limits: how often a given IP or key may call an endpoint. A separate, optional setting can additionally bind a session or API key to the subnet it started on and end it on a mismatch. That is an identity check, off by default, documented on the Configuration page, not a rate limit.
- Every successful scan response includes rate-limit headers. A 429 response includes the same headers plus Retry-After.
- For session auth, the daily counter resets at 00:00 UTC. For API-key auth, the counter is a rolling 24-hour window anchored to the oldest usage in the current period. The same X-RateLimit-Reset header reflects whichever applies.
- When you exceed your quota, the API returns 429 with a structured body.

### Code examples
```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 150
X-RateLimit-Remaining: 147
X-RateLimit-Used: 3
X-RateLimit-Policy: daily
X-RateLimit-Reset: 2026-03-12T00:00:00.000Z
```

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 43200

{
  "error": "Daily scan limit reached. Resets at 2026-03-12T00:00:00Z.",
  "limit": 150,
  "used": 150,
  "remaining": 0,
  "resets_at": "2026-03-12T00:00:00Z"
}
```

```typescript
async function scanWithRetry(url: string, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch('<value>/api/v3/scan', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '60');
      const wait = Math.min(retryAfter * 1000, 2 ** attempt * 1000);
      console.log(\`Rate limited. Waiting \<value>s before retry.\`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    return response.json();
  }
  throw new Error('Rate limit retries exceeded');
}
```

```python
import requests
import time

def scan_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        response = requests.post(
            '<value>/api/v3/scan',
            headers={'Authorization': 'Bearer YOUR_API_KEY'},
            json={'url': url},
        )
        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', 60))
            wait = min(retry_after, 2 ** attempt)
            print(f"Rate limited. Waiting {wait}s.")
            time.sleep(wait)
            continue
        return response.json()
    raise Exception('Rate limit retries exceeded')
```

## Architecture
Route: /docs/architecture

### Sections
- **Overview** (`#overview`)
- **Project Layout** (`#layout`)
- **Key Subsystems** (`#subsystems`)
- **Request Lifecycle** (`#lifecycle`)
- **CI/CD Pipeline** (`#cicd`)

### Callouts
> **INFO: Single source of truth**
> Almost every tunable lives in{" "}
lib/config/config-values.ts. The rest of the
config system is built from those constants. Edit there, not in random
files.

### Notes
- is a Next.js 15 App Router application with a single-process deployment. The runtime stack is deliberately small: one Next.js process + one PostgreSQL database. No Redis, no message broker, no separate API server. Everything you need to understand lives in this repository.
- See the Configuration page for full details. Flow:
- The detection engine is split across per-category files:
- Categories (lib/scanner/types.ts, 16 total): headers, ssl, tls, content, cookies, configuration, information-disclosure, dns, email, api, code, secrets-extended, vibe-code, client-side, supply-chain, host-validation. Severities: info, low, medium, high, critical.
- Service probes ( lib/scanner/protocols/banner.ts) open a bounded TCP socket to the target hostname on a well-known or user-supplied port, read the greeting, and report version disclosure and reachability. The 6 supported probes are ssh, smtp, imap, pop3, ftp, and mongodb. Probes are independent of the URL scheme: opt into "probes": ["ssh:2222"] from the dashboard without constructing ssh://host.
- REST v3 is the only API this build serves. There is no /api/v1 or /api/v2 route tree. Each v3 route handler:
- Role hierarchy (defined in lib/config/client-constants.ts):
- All four checks (lint, typecheck, test, build) run on Node 22 LTS in CI. See .github/workflows/.

### Code examples
```text
vulnradar.dev/
├── app/                          # Next.js App Router
│   ├── (root pages)              # /, /landing, /pricing, /demo, /contact, /donate
│   ├── admin/                    # Admin dashboard (staff-gated)
│   ├── api/v3/                   # REST API v3 (and /api/security-txt, /api/version)
│   ├── dashboard/                # User dashboard (authenticated)
│   ├── docs/                     # This documentation site
│   ├── history/                  # Scan history (authenticated)
│   ├── legal/                    # Terms, privacy, etc.
│   ├── login, signup,            # Auth pages
│   ├── forgot-password,
│   │  reset-password,
│   │  verify-email
│   ├── pricing/                  # Pricing + Stripe checkout
│   ├── profile/                  # User profile
│   ├── shared/[token]/           # Public shared-scan viewer
│   ├── staff/                    # Public staff list
│   └── teams/                    # Team management
│
├── components/                   # React components (mostly client)
│   ├── admin/                    # Admin UI
│   ├── auth/                     # Auth forms
│   ├── badge/                    # Public badge widgets
│   ├── billing/                  # Stripe checkout UI
│   ├── docs/                     # Documentation site components
│   ├── landing/                  # Marketing landing
│   ├── scanner/                  # Scan UI (results, footer)
│   ├── shared/                   # Cross-cutting (notifications, logo)
│   └── ui/                       # shadcn/ui primitives
│
├── lib/                          # Server-side libraries (no React)
│   ├── api/                      # API helpers (Bearer validation, request utils)
│   ├── auth/                     # Sessions, 2FA, password hashing, device trust
│   ├── billing/                  # Stripe + plan catalog
│   ├── config/                   # Configuration system
│   ├── database/                 # PostgreSQL pool, query helpers, cleanup
│   ├── discord/                  # Discord OAuth helpers
│   ├── email/                    # Transactional email (SMTP)
│   ├── notifications/            # In-app + email notification preferences
│   ├── rate-limiting/            # Generic + plan-based rate limits
│   ├── reports/                  # PDF report generation
│   ├── scanner/                  # Detection engine
│   ├── types/                    # Shared TypeScript types
│   └── uploads/                  # Avatar validation
│
├── instrumentation.ts            # Next.js startup hooks (DB init, schema check)
├── middleware.ts                 # Auth + public-path middleware
│
├── public/                       # Static assets
├── scripts/                      # DB migration + audit scripts
│   ├── _lib/                     # Shared helpers
│   ├── create-fresh-db/          # Side-by-side DB clone
│   └── migrate/                  # Schema migrations
│
├── .github/                      # Workflows, dependabot, PR template
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.mjs
├── eslint.config.mjs
├── vitest.config.ts
└── package.json
```

```text
user (0) → support (1) → moderator (2) → admin (3)
```

```text
Browser / client
  │
  ▼
middleware.ts
  - Allow public paths (lib/config/public-paths.ts)
  - For /api/v3/* with Authorization: Bearer … → pass through
    (the route handler performs API-key validation)
  - Otherwise: parse session cookie → look up session row
    - Disabled / expired session → destroy cookie, redirect to /login
  - Inject Cross-Origin-* security headers
  │
  ▼
Route handler (app/api/v3/<resource>/route.ts)
  1. withErrorHandling wrapper
  2. Auth check (getSession OR validateApiKey)
  3. Rate limit check (lib/rate-limiting/rate-limit.ts)
  4. Daily quota check (lib/rate-limiting/daily-limits.ts, API-key + session)
  5. Input validation (Zod via Validate)
  6. Authorization (requireStaff / requireAdmin / verifyOwnership)
  7. Business logic
  8. Database query (lib/database/db.ts)
  9. ApiResponse.json(...)
  │
  ▼
instrumentation.ts (server startup only)
  - Initialize/verify DB schema on first boot
  - Read vulnradar_schema_meta; refuse to start if version < required
  - Add api_keys.key_locator column if missing (v2.3.x delta)
```

```text
On push to main / PR
  ├── Lint (ESLint 9, flat config in eslint.config.mjs)
  ├── Typecheck (tsc --noEmit, hard gate)
  ├── Test (vitest run)
  ├── Format check (prettier --check)
  └── Build (next build)

On tag v*
  └── Docker publish (ghcr.io/<value>/${`<repo>
```

## Developers
Route: /docs/developers

### Sections
- **Overview** (`#overview`)
- **Finding Types API** (`#finding-types`)
- **Building SDKs** (`#building-sdks`)
- **Development Guide** (`#development`)
- **Prerequisites** (`#prerequisites`)
- **Node Version Policy** (`#node-version-policy`)
- **Quick Start** (`#quick-start`)
- **Scripts** (`#scripts`)
- **Linting** (`#linting`)
- **Type Checking** (`#typecheck`)
- **Commit Conventions** (`#commits`)
- **Pull Request Process** (`#pull-requests`)
- **Project Structure** (`#structure`)
- **Common Pitfalls** (`#pitfalls`)
- **Debugging** (`#debugging`)
- **Contributing** (`#contributing`)

### Callouts
> **INFO: A Python SDK already exists**
> pip install vulnradar wraps this API with
typed response models and a proper exception hierarchy. Source and
usage docs:{" "}

github.com/VulnRadar/Python-SDK

. Building one in another language? Open an issue on GitHub with a
link and we will list it here. Requirements: GPL-3.0 compatible
license, 

> **WARNING: Node 22 is required, not just recommended**
> The engines field in{" "}
package.json is{" "}
{ "node": ">=22.0.0" }. There is no
fallback to Node 20: the Dockerfile builds and runs on{" "}
node:22.11.0-alpine, and CI runs the full
lint, typecheck, test, and build matrix on Node 22 only. Match that
locally.

> **WARNING: We will ask you to switch first**
> Bug reports filed against Node 20 or earlier get closed with a
request to reproduce on 22 before we look further. If a real bug
exists, it reproduces on 22 too, so open it there directly and save
a round trip.

### Headings
- SDK Checklist
- Open source
- Request
- Response
- Response fields
- 1. Authentication
- 2. Base URL
- 3. Core endpoints
- 4. Error handling

### Notes
- This page covers two audiences:
- Endpoints, request/response shapes, and rate-limit semantics live on the API Reference and Rate Limits pages. The rest of this page is the integration manual.
- The Finding Types endpoint returns the full catalogue of detection checks. Use it to display human-readable titles, categorize findings, or build SDKs that know every check ID ahead of time.
- Backed by lib/scanner/checks-data/*.json, one file per category, for the 652 legacy checks. Adding one of those means editing the JSON for its category and the matching detector in lib/scanner/checks/. The other 43 checks live on a newer PageCheck architecture under lib/scanner/checks/page-checks/ with metadata declared inline; see Architecture .
- When building an SDK for , follow these guidelines.
- All authenticated requests require a Bearer token. Keys are prefixed vr_live_:
- Full request/response shapes: see API Reference .
- Each non-2xx response includes a JSON body with at minimum an error string. Map HTTP status to typed exceptions (400 / 401 / 403 / 404 / 422 / 429 / 500). On 429, honour the Retry-After header and the X-RateLimit-Reset header.
- pip install vulnradar wraps this API with typed response models and a proper exception hierarchy. Source and usage docs: github.com/VulnRadar/Python-SDK . Building one in another language? Open an issue on GitHub with a link and we will list it here. Requirements: GPL-3.0 compatible license, type-safe models, real tests against a live instance.
- Setup for contributing to . Covers local dev, scripts, commit conventions, common pitfalls.

### Code examples
```bash
curl <value>/api/v3/finding-types
```

```json
{
  "success": true,
  "count": 695,
  "data": [
    {
      "id": "hsts-missing",
      "type": "header",
      "title": "HSTS Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "HTTP Strict Transport Security header is not set."
    },
    {
      "id": "csp-missing",
      "type": "header",
      "title": "Content Security Policy Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "Content Security Policy header is not set."
    }
  ]
}
```

```text
<value>/api/v3
```

```bash
# nvm / fnm / volta / asdf will all auto-pick this from the repo root
nvm use          # reads .nvmrc (which says 22)

# or install + use explicitly
nvm install 22
nvm use 22
node --version  # should print v22.x.x
```

```bash
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

```http
Authorization: Bearer vr_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

```text
# 1. Clone
git clone https://github.com/<value>.git
cd vulnradar.dev

# 2. Install dependencies
npm ci

# 3. Set up environment
cp .env.example .env
# Edit .env: DATABASE_URL, API_KEY_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL

# 4. Start the dev server (schema auto-creates on first boot)
npm run dev
# → http://localhost:3000
```

```text
npm run lint        # check
npm run lint:fix    # auto-fix
```

---

## Extraction summary (for debugging)

| Page | Hero | Sections | Callouts | Code tabs | Code blocks | Endpoints | Features | Paragraphs | Headings |
|---|---|---|---|---|---|---|---|---|---|
| `/docs/account-security` | - | 6 | 3 | 0 | 1 | 0 | 0 | 22 | 0 |
| `/docs/ai` | - | 10 | 1 | 0 | 2 | 0 | 0 | 19 | 0 |
| `/docs/cli` | - | 6 | 1 | 0 | 4 | 0 | 0 | 6 | 0 |
| `/docs/github` | ✓ | 8 | 4 | 0 | 1 | 0 | 0 | 25 | 0 |
| `/docs/reports` | - | 7 | 2 | 0 | 3 | 0 | 0 | 12 | 0 |
| `/docs/scheduled-scans` | - | 8 | 5 | 0 | 0 | 0 | 0 | 19 | 0 |
| `/docs/sharing` | ✓ | 8 | 4 | 0 | 2 | 0 | 0 | 28 | 0 |
| `/docs/teams` | - | 8 | 1 | 0 | 1 | 0 | 0 | 15 | 0 |
| `/docs/triage` | - | 3 | 3 | 0 | 2 | 0 | 0 | 20 | 0 |
| `/docs` | ✓ | 5 | 0 | 0 | 1 | 0 | 0 | 9 | 1 |
| `/docs/setup` | - | 12 | 4 | 0 | 22 | 0 | 0 | 27 | 30 |
| `/docs/extension` | ✓ | 8 | 1 | 0 | 0 | 0 | 0 | 10 | 2 |
| `/docs/self-hosting` | - | 15 | 6 | 0 | 12 | 0 | 0 | 19 | 3 |
| `/docs/config` | - | 9 | 3 | 0 | 2 | 0 | 0 | 28 | 0 |
| `/docs/api` | - | 8 | 3 | 0 | 6 | 28 | 0 | 14 | 9 |
| `/docs/webhooks` | ✓ | 6 | 0 | 0 | 3 | 0 | 0 | 5 | 5 |
| `/docs/rate-limits` | - | 6 | 5 | 0 | 4 | 0 | 0 | 10 | 3 |
| `/docs/architecture` | - | 5 | 1 | 0 | 4 | 0 | 0 | 8 | 0 |
| `/docs/developers` | - | 16 | 3 | 0 | 9 | 0 | 0 | 20 | 9 |
