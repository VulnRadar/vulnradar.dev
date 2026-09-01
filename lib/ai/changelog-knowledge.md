# VulnRadar Changelog - AI Knowledge

_Auto-compiled from `lib/changelog/data.ts` on 2026-09-01._

This file is consumed by the AI system prompt at runtime so the
assistant can answer questions about specific versions, release
dates, and shipped features. When a user asks "what changed in
v2.3.0?" or "when was the API keys feature added?", answer from
this file. The latest release is always the first entry.

Versioning: major.minor.patch. The engine version (scanner rules)
and the app version (UI/backend) are tracked separately in the
config (see `lib/config/config-values.ts`).

Each release entry shows: version, date, title, summary, and every
change with its category tag (added/changed/fixed/security/performance)
and full description.

---

## v3.8.0 - August 29, 2026 **(highlights)**
**Self-Hosting Works, Scans Tell the Truth, and Nothing Runs Free**

The release that acts on a full audit of the codebase, top to bottom. Four things in here matter most. Self-hosting was broken end to end: the Docker image tag in our own compose file was never published, the app refused to start against an empty database, and the command it told you to run to fix that was not in the container. All three are fixed, so `docker compose up -d` against a blank Postgres now works the way the docs always said it did. A scan that did not finish could show as a clean result, which on a security scanner is the worst thing that can happen; an unfinished scan now says so. Three patterns in the scan engine could be made catastrophically slow by the site being scanned, the worst of them letting a single anonymous scan stall the server for minutes. And crawl scans run through an API key were charging nothing at all against your daily limit, so the number you saw was not the number you were using. Plus a new CI job that builds the real image and boots it against an empty database, which is the check that would have caught the self-hosting failures before they ever shipped.

### Changes
- [Settings] **[FIXED]** **Your .env Actually Reaches the Container**
  The compose file forwarded only the eleven environment variables it named explicitly, out of roughly forty-eight the app reads. Everything else you set in .env, including OAuth client IDs, AI provider keys, Browserbase, Discord, the GitHub App and search-engine verification, was silently dropped, so those features appeared broken with nothing to explain why. The documentation had been telling operators the app reads .env for some time; now it does. Values compose derives itself, like the internal database URL, still take precedence.
- [UserCheck] **[FIXED]** **You Can Log In to a Self-Host Without Configuring Email First**
  Setting up an instance without SMTP left you permanently locked out. Signing up created the account, sending the verification email failed because there was no mail server, and login then refused because the address was never verified. The documented way out required being logged in. Email verification exists to prove control of an address by sending to it, so on an instance that genuinely cannot send mail it is not a stricter setting, it is a dead end. Accounts created on an instance with no email configured are now verified on creation. Where mail is configured nothing changes and verification is still required.
- [Mail] **[FIXED]** **Self-Hosted Instances Show Their Own Support Address**
  Setting a support email changed the address in outgoing mail but not the one shown in the app, because pages rendered in the browser can only read values baked in when the app is built. A self-hosted instance ended up split: its own address in emails, ours on the contact page and every error screen, quietly directing its users to us. The address is now available to both halves, is wired through the Docker build and compose file so setting it once covers everything, and the example environment file explains why two variables exist.
- [Filter] **[FIXED]** **Published Limits Match the Enforced Ones**
  Two documented limits were wrong. Crawl scans were described as capped at 15 pages in three places, citing a constant that no longer exists; the real cap depends on your plan (25, 50, 100 or 250) and each page counts as one scan against your daily limit, which was not mentioned anywhere. The rate-limits page also published a per-IP limit as applying to every API route, when it is applied to a handful of specific ones. Both now describe what the code actually does.
- [CheckCheck] **[FIXED]** **An Incomplete Test Run Can No Longer Pass**
  Our test runner occasionally fails to start one of its worker processes. When that happened it reported only the files that did run and still exited successfully, so a run that silently skipped several test files looked exactly like a clean one. We saw runs report 356, 353, 352 and 349 files, all green. Every conclusion drawn from a short run was unsound and there was no way to tell. The runner now compares how many test files ran against how many exist and fails the run if any are missing, so the problem is visible instead of silent.
- [Timer] **[CHANGED]** **The Scanning Screen No Longer Shows a Stopwatch**
  The live scanning card ran a seconds counter beside the progress bar. It invited you to judge the scanner by a wall-clock number that was mostly time spent waiting on external lookups rather than time spent scanning, which made a fast engine look slow. It is gone. In its place the card shows how many of the scan's checks have actually finished, which is real work reported by the server rather than a guess. Removing it also stopped the page re-rendering itself twice a second for the whole scan.
- [Share2] **[FIXED]** **Revoking a Share Link Tells You If It Failed**
  Revoking a share link, and switching a report in or out of the public directory, did nothing visible when the request failed. The spinner stopped, the row stayed exactly as it was, and there was no way to tell a failed revoke from a successful one. On a control whose entire purpose is withdrawing access to a security report, appearing to work is the worst outcome available. Both now say plainly that the link is still active, or that the visibility is unchanged.
- [Eye] **[FIXED]** **The Profile Page Says When It Could Not Load Something**
  The profile page loads ten things at once and replaced any that failed with an empty list, so a failed request to load your API keys rendered as "you have no API keys". That is indistinguishable from genuinely having none, and could lead you to think a key had been revoked or to create a duplicate. Worse, the two privacy defaults fell back to "public", so a failed request could tell you your scans are public when they are not. The page now names whatever it could not load and says those sections may be showing a default rather than your real setting.
- [RefreshCw] **[FIXED]** **Repository Views No Longer Spin Forever on an Error**
  Two loaders in the repository view returned early when the API responded with an error, skipping the line that turns the loading state off. The skeleton kept animating indefinitely and the error message the component already had was unreachable. Both now clear the loading state on every path, so a failure shows the error instead of a permanent spinner.
- [Trash2] **[FIXED]** **Database Cleanup Asks Before Deleting**
  The admin "Run Cleanup Now" button permanently deleted expired scan history and audit-log rows across every account on the instance, on a single click, from a card that looks like the rest of the settings page. Meanwhile resetting one setting to its default, which is trivially reversible, opened a confirmation dialog. The confirmation now sits on the action that cannot be undone, and says what it removes and that cleanup also runs on its own schedule.
- [Key] **[FIXED]** **Suggested Passwords Are Always Rated Very Strong**
  The password generator could produce a password that the strength meter next to it then rated only Strong, because it sometimes emitted runs of repeated characters and the meter marks those down. Measured across 50,000 generated passwords it happened to about 1 in 185. The generator now checks its own output against the same meter and draws again on the rare miss, so a suggested password is always rated Very Strong. Measured again over 50,000 samples after the change: 100 percent.
- [ScanSearch] **[ADDED]** **You Can Scan Your Own Site Without an Account**
  The demo page ran the real scanner, showed the whole report, and could only ever point at our own deployment: the URL was hardcoded even though the endpoint accepted any address. Meanwhile the roughly 780 public check pages sent their only call to action here, the API scanner tool page promised "just paste the URL" with no field to paste into, and the demo's own follow-up copy said "That was our site. Try yours." next to a signup form. There is now a box to type your own address into, right under the scan-us button. The same limits apply as before: a few scans per connection, then an account.
- [Share2] **[FIXED]** **Shared Reports Show a Preview Again**
  Pasting a shared report link into Slack, X, LinkedIn, Discord or iMessage produced a bare URL with no title, description or image. Our robots.txt told every crawler to stay off shared and public report pages, and link-preview fetchers honour that, so they never read the preview tags those pages already had. Preview fetchers are now allowed on those two paths. This does not make the pages searchable: they carry a noindex tag, which is what actually keeps them out of search results, and that is unchanged.
- [Puzzle] **[FIXED]** **The Landing Page Stopped Denying the Extension Exists**
  The FAQ answered "Do I need to install anything?" with "there is no browser extension", and the feature list said the same. The extension has been live on the Chrome Web Store and Firefox Add-ons for a while. The FAQ answer was also published as structured data, so search engines were being given the incorrect claim directly. Both now say what is true: nothing needs installing, and an extension is available if you want one.
- [FileText] **[FIXED]** **The API Reference Documents the Field That Actually Exists**
  The per-service probes array was removed from the scan endpoint some time ago and consolidated into a single portScan flag, but no documentation was updated. probes remained the headline example on the API reference page, in the request sample, in the OpenAPI schema, and in the reference material the in-app assistant answers from, while portScan was documented nowhere at all. Anyone following the docs sent a field the API ignores and never discovered the one they wanted. All four surfaces now describe portScan, including the verified-domain requirement it carries.
- [ShieldCheck] **[FIXED]** **Self-Hosting Docs No Longer Tell You to Demote Your Own Admin**
  Four pages told a new self-hoster to sign up and then run SQL setting their account's role to admin. The first account on a fresh instance is already created as super_admin, which is a higher level, so that command silently demoted the only administrator, and nothing in the product can grant super_admin back. The pages now say plainly that the first account needs no SQL at all, and the command they show is scoped to promoting a later colleague.
- [GitMerge] **[FIXED]** **Contributor Docs Warn About the Lockfile Trap**
  Our own support guide told bug reporters to delete package-lock.json and reinstall, which is exactly the action that breaks the build: regenerating the lockfile on macOS or Windows drops the Linux native binaries that CI and the Docker image need, so the reporter's machine works and everyone else's build fails. The setup and bug-report instructions now use npm ci, and both explain why the lockfile must not be regenerated and why pnpm and yarn cause the same damage.
- [Eye] **[FIXED]** **Light Mode Is Readable**
  Light and dark mode shared a single value for every accent colour, and those values were picked for the dark background. Used as text on light surfaces they were far below the WCAG AA minimum this product publicly claims to meet: the medium-severity label measured 1.56 to 1, high 2.19, critical 2.98, and links 1.99, where the standard asks for 4.5. On a product whose entire output is colour-coded by severity, that is the output itself being hard to read. Light mode now has its own values for severity, warning, success, muted text and link text. The hue and saturation are unchanged, so it is the same palette rather than a new one, only darkened to the point where it is legible: every one of them now clears the standard, and severity badges carry their white text at 6 to 7 to 1. Dark mode already passed and is untouched.
- [Fingerprint] **[FIXED]** **Keyboard Focus Is Visible on Every Button**
  The focus outline colour and the primary button colour were the same value, and the outline is drawn inside the element, so tabbing to Sign in, Sign up or Start scan drew a ring in exactly the colour it sat on. Keyboard and screen-magnifier users had no visible indication of where they were on the highest-traffic controls in the product. Filled buttons now draw their focus ring in the colour already chosen to be legible on them, so it is guaranteed to show up in both themes, and the general focus colour has been darkened so it stands out against light backgrounds too.
- [Layout] **[FIXED]** **"Skip to content" Works on Every Page**
  The skip link at the top of every page, the first thing a keyboard user reaches, pointed at a target that only existed on some layouts. On the documentation, on the roughly 750 public check pages, and on the public report pages it pointed at nothing, so activating it did not move focus anywhere. All three layouts now carry the target.
- [BarChart3] **[FIXED]** **The Dashboard Issue Count Goes Down When You Fix Things**
  The "Critical and high" figure on your dashboard added up every scan you had ever run, so it was a lifetime tally rather than a picture of where you stand. Fixing an issue and rescanning made it go up, because the rescan's findings were added on top of the original scan's instead of replacing them, and it could never return to zero no matter how much you fixed. It now counts the most recent scan for each site you track, so it reflects what is actually wrong right now and falls as you fix things.
- [Filter] **[CHANGED]** **Findings Are Ordered by What to Fix First**
  Inside a severity band, the findings list sorted alphabetically by title. That meant a vulnerability under active exploitation appeared no higher than a theoretical one that happened to start with an earlier letter. The scanner already works out three things about every finding: whether it is on CISA's known-exploited list, its EPSS probability of being exploited soon, and its CVSS base score. The list now ranks on those, in that order, before falling back to the title. The CVSS score is also shown on the finding itself, next to the existing exploitation signals; it was being computed and included in exports but never displayed anywhere in the app.
- [Search] **[FIXED]** **History Search Says When It Is Not Searching Everything**
  The history page loads your most recent scans and filters them in the browser, so searching an account with more scans than the page loads quietly missed the older ones: a scan still well inside its retention window simply looked as though it did not exist. Searching a partial list now says so plainly, including how many scans are loaded against how many you have. Searching the full history from the server is a larger change and is still to come; this at least stops the page giving a wrong answer without saying so.
- [CalendarClock] **[FIXED]** **Scheduled Scans Count Against Your Daily Limit**
  A scheduled scan ran without ever checking or charging the daily scan quota, so schedules were a completely unmetered source of scans: an account with unlimited hourly schedules could run far more scans a day than its plan allows, and the usage figure on its billing page stayed at zero throughout. Scheduled runs now charge the same daily counter every manual scan does. Going over your limit does not disable the schedule, it just skips that run and tries again on the next cadence, the same way a plan downgrade is handled. Scheduled runs also now honour the admin blocklist at run time, so a target blocked after the schedule was created stops being scanned instead of continuing every hour.
- [Network] **[FIXED]** **Subdomain Discovery Is Metered and Respects the Blocklist**
  The subdomain discovery endpoint was bounded only by an hourly rate limit. A forced refresh skips the cache and runs the full engine, which is a 191-name DNS brute force plus resolution of up to a thousand more names plus reachability probing, and none of it counted against anything. That let one account aim roughly 200,000 DNS lookups a day at hosts it may not own. A forced refresh now charges one scan against the daily limit; reading a cached result stays free, because it does no outbound work. Discovery also now checks the admin blocklist, which it previously skipped entirely.
- [Bot] **[FIXED]** **The AI Assistant's Large-Context Path Can No Longer Be Spoofed**
  Loading reference material with a slash command gives that message a much larger size allowance than an ordinary chat turn, because the changelog and docs are genuinely big. The check for whether a message was one of those blocks only looked at whether it began with the text "<context", which anyone could type. Doing so moved an arbitrary message onto the large allowance on a path that is free and unmetered. The check now requires the exact shape the slash commands produce, including a command name matched against the real command list, so a hand-typed prefix no longer qualifies.
- [Gauge] **[FIXED]** **Crawl Scans Through an API Key Now Count Against Your Limit**
  A crawl started with an API key was skipping the daily scan quota entirely. The reasoning in the code was that the key's own limit had already been checked, but a key's limit counts API requests, not pages scanned, and the check at the start of a crawl only reads the counter without ever adding to it. Because nothing on that path incremented it, the counter stayed at zero and reported you as under quota forever: a free key could run 25 crawls of 25 pages each against a 25-scan daily plan. Every page of a crawl now counts as one scan on every auth method, matching what single and bulk scans already did, so the usage figure on your billing page is the real one.
- [ShieldAlert] **[FIXED]** **A Hostile Page Can No Longer Stall the Scanner**
  The secrets detectors share a step that blanks out placeholder-looking credentials (things like your_api_key or example_token) so they are not reported as real leaks. The pattern it used had to retry from every position in the page, which made its cost grow with the square of the page size, and it ran once for each of the 74 detectors. A page of plain word characters could hold the server for minutes, and because every timeout in the scan path is a timer rather than a hard interrupt, nothing could cut it short. The step now finds each placeholder marker directly and expands outward, which is linear: on the worst input we measured it went from 30.6 seconds to under a millisecond, and it now runs once per page instead of 74 times.
- [Bug] **[FIXED]** **A Crafted robots.txt Can No Longer Hang a Crawl**
  Crawl scans read the target's robots.txt and honour rules that name our crawler. Each * in a rule was turned into a wildcard in a regular expression, and several wildcards in one rule made the matching cost grow exponentially: seven wildcards against a short path took 33 seconds, and ten took over half an hour. Since the rule comes from the scanned site, any target could do this to a crawl. Matching is now a direct left-to-right walk that cannot backtrack, so the same seven-wildcard rule resolves in about a millisecond. All 442 rule and path combinations we checked produce identical results to before.
- [ShieldCheck] **[FIXED]** **The Rest of the Detector Patterns Got the Same Bound**
  A fix for this class of problem had already been applied in two files, capping the gaps in HTML-matching patterns so they cannot scan an unbounded distance. Sixteen other patterns across seven detector files had been missed and still used the unbounded form. They now all use the same documented cap, so one hardened detector no longer sits next to fifteen that are not.
- [Container] **[ADDED]** **CI Now Actually Boots a Self-Host**
  Nothing in our pipeline ever built the Docker image or started it against a database, which is why three separate self-hosting failures shipped together in the previous release. A new job builds the production image, checks that the files our own documentation tells operators to run are actually inside it, boots it against an empty Postgres, and fails unless the app becomes healthy and the full schema is created. Every one of the 3.8.0 self-hosting defects would have failed this job.
- [Container] **[FIXED]** **A Fresh Self-Host Starts on an Empty Database**
  Pointing the app at a blank Postgres made it print a schema-version error and exit, then restart and do it again. The check that did this exists to stop the app starting against an old v1 or v2 database, which is a real hazard, but it treated an empty database the same way. It now tells the two apart: a database with no tables at all is a first boot and gets the current schema created from scratch, while a database that has tables but no version record still refuses and points at the migration tool, exactly as before.
- [Container] **[FIXED]** **The Docker Image Tag in docker-compose.yml Exists**
  Our own compose file pinned ghcr.io/vulnradar/vulnradar:3.0.0. The publish workflow tags images from the release tag, so every image we have ever pushed carries a leading v, and a bare 3.0.0 was never published. Following the README meant failing on `manifest unknown` before anything else could even be attempted. The pin is now a tag that exists, and the comment above it explains the naming so the next bump does not reintroduce it.
- [Wrench] **[FIXED]** **Database and Backup Commands Are Present in the Container**
  The runtime image copied five paths and scripts/ was not one of them, so `npm run db:create`, `npm run db:migrate`, the admin Backup button and the self-updater's migration step all pointed at files that were not there. The container was telling operators to run a script it did not carry. scripts/ now ships in the image. lib/ ships too, which separately fixes the in-app AI assistant answering with no reference material in a published image: it reads its knowledge files from disk at runtime and was silently getting nothing.
- [ShieldAlert] **[FIXED]** **An Unfinished Scan No Longer Reports as Clean**
  The scanner already tracked which check areas ran out of time, and the result page ignored it: a scan whose DNS or TLS checks timed out printed "Nothing found on this scan" and "Every enabled check ran against this host". Reading that as a clean bill of health is exactly the wrong conclusion. A result with unfinished areas now names them and asks you to run the scan again. A check that crashed outright was also being recorded as having completed successfully, so it never reached that warning at all; it is now reported as not checked, and the failure is logged instead of swallowed.
- [Trash2] **[FIXED]** **Clearing History Tells You the Real Number**
  The history page shows the most recent 100 scans, and the "clear all scan history" confirmation counted what was on screen. Clearing history deletes everything, not the visible page, so an account with 400 scans was asked to confirm deleting 100 and then lost all 400. The list now also reports the true account total: the header shows it (and says when it is showing a subset), and the confirmation names the real figure it is about to delete.
- [Container] **[FIXED]** **docker compose build Works From a Checkout**
  The self-hosting docs tell operators to run `docker compose build app` to upgrade, but the app service declared no build context, so that command quietly did nothing and left the old image running. The service now has one, so the documented upgrade path does what it says.
- [Smartphone] **[FIXED]** **Admin Row Actions Visible On Touch**
  Row actions in the notifications, broadcast, security alerts and admin-notes lists only appeared on mouse hover. On a phone or tablet they were invisible but still tappable, so an admin could fire a destructive action, Delete included, by tapping what looked like blank space. Those actions are now always shown below tablet width.
- [ShieldAlert] **[FIXED]** **Blocked Data Panel No Longer Fakes An All-Clear**
  If the admin Blocked Data panel failed to load its rules, it drew a green check and the words "No blocked rules", which reads as a clean bill of health on a security screen. It now says the load failed and tells you to retry. The matching-scans lookup does the same instead of silently reporting zero results.
- [Mail] **[FIXED]** **Save As Draft No Longer Loses A Composed Broadcast**
  Saving a mass email as a draft failed silently: the composer cleared or the work vanished with no warning at all. The form now keeps your text on failure, tells you what went wrong, and confirms when the draft is actually saved.
- [Users] **[FIXED]** **Renaming A Team Works On A Phone**
  The rename button in the admin Teams list existed on mobile but the editor it opened only ever rendered in the desktop table, so tapping Rename did nothing. The name field, save and cancel now appear inline in the mobile card.
- [List] **[FIXED]** **Teams Page-Size Selector Actually Changes The Page Size**
  Picking 25 or 50 rows per page in the admin Teams list highlighted the button and still returned 10 rows, because the request had the limit hardcoded. The selected size is now sent with the request.
- [Layout] **[FIXED]** **Engine Feedback Dialog Scrolls On Short Screens**
  The Promote to Rule dialog had no height limit, so on a short window its own Promote button was cut off below the edge with no way to scroll to it. The dialog now caps its height and scrolls like every other admin dialog.
- [Smartphone] **[FIXED]** **Four More Admin Panels Are Usable On A Phone**
  Engine Feedback, Blocked Data, Content and Billing Overview shipped desktop-only tables to phones, each scrolling sideways inside a screen too narrow to read. They now show the same data as stacked cards below tablet width, matching the other admin panels.
- [Timer] **[ADDED]** **Access Rules Can Expire And Be Paused**
  Every IP or URL rule an admin created was permanent and could only be removed by deleting it, even though a temporary block is the usual case. New rules can now be set to expire in 1 hour, 24 hours, 7 days or 30 days, and any rule can be paused and resumed from its detail panel. Paused rules stay listed behind a toggle instead of disappearing.
- [Settings] **[FIXED]** **Honest Wording For Build-Time Settings**
  The branding and SEO settings showed a banner promising the change would take effect after the next build and deploy. That was not true: nothing in the build reads those saved values, so a rebuild brought the old branding back with no error. The banner now says plainly that these values come from the app's config file, which file to edit, and that the public URL is the one exception because sign-in reads it live.
- [ShieldCheck] **[FIXED]** **System Settings No Longer Shows False Defaults**
  If the settings editor failed to load, it drew every setting at its shipped default with no "Customized" markers, which looks exactly like a fresh install. Saving from there could have wiped real configuration across the product. It now shows a load error and a retry button instead of the editor.
- [Gauge] **[FIXED]** **Admin Panels Say When They Failed To Load**
  The backup, updater, scanner queue and billing panels each rendered a confident but wrong picture when their data did not arrive: "Last backup: Never", "cosign: Not installed", a permanent loading skeleton, and empty tables. Each now says the load failed and that the values are unknown rather than zero.
- [Bug] **[FIXED]** **A Server Error No Longer Reads As "Access Denied"**
  When the admin data request failed for any reason other than a real permissions check, the panel showed "Access Denied: you do not have administrator privileges". During an outage that sent operators off to check roles and 2FA instead of the actual fault. It now shows a distinct error screen with the status code and a Retry button.
- [Zap] **[PERFORMANCE]** **Admin Panel Loads Far Less JavaScript**
  Opening the admin panel downloaded every one of its twenty-odd screens up front, roughly 1.3 MB of JavaScript, to show one of them. Each screen is now fetched only when you open its tab, so the panel becomes usable much faster, especially on a slow connection.
- [Key] **[SECURITY]** **Staff Invites Require Your Password**
  Sending a staff invite hands out a staff role, admin included, to any email address, and it took a single unconfirmed click. Granting the same role from a user's page has always required re-entering your own password. Sending an invite now asks for it too, and the server enforces it.
- [CheckCheck] **[CHANGED]** **Confirmation Dialogs Where They Belong**
  Actions that only give a user capacity back, resetting a daily scan limit, an AI usage window, a GitHub review window, the free trial, or clearing rate limits, opened the same heavy confirmation dialog as deleting an account, which trains everyone to click through dialogs. Those five now run immediately with a toast. Un-banning someone from AI chat no longer demands a password (banning still does), and revoking a gifted subscription is confirmed once instead of twice.
- [Filter] **[FIXED]** **Sorting The Users Table Sorts All Users**
  Clicking the Name or Joined header only reordered the ten rows already on screen while looking like a real sort, so asking for the oldest account on page 1 of 40 gave the oldest of ten. Sorting now happens on the server across every account and returns you to the first page.
- [Share2] **[ADDED]** **Jump Straight To An Account From Support And The Audit Log**
  The requester's address on a support ticket and the target of an audit-log entry were plain text, so cross-referencing meant copying an email, switching tabs, searching, and losing your place. Both are now links that open that account directly. The audit log keeps its filter-by-target action on the avatar.
- [Palette] **[FIXED]** **Admin Risk Scores Match The Scanner**
  The admin Public Scans table coloured its 0-10 risk scores at the wrong boundaries, so a host the scanner rates safe showed amber and a host it rates caution showed red. It now uses the same bands as the host trend chart, the browser extension badge, and the scanner itself.
- [List] **[FIXED]** **Admin Table Headers Stay Put While Scrolling**
  Column headers on every admin table were meant to stick to the top while the rows scrolled, but an extra scroll container in between meant they never did. Worst on the eight-column Engine Feedback table, where the meaning of each column was lost after one scroll. They now stay pinned.
- [Smartphone] **[FIXED]** **Mobile Admin Fixes: Toasts, Filters, Banner And Contents Pill**
  Several small mobile problems in the admin area are fixed: long error toasts no longer run off the edge of the screen, the audit-log filter strip wraps instead of hiding seven of ten filters behind an invisible scroll, the impersonation banner no longer forces the whole site to scroll sideways, and the floating Contents button lifts above the save bar instead of being covered by it.
- [Settings] **[FIXED]** **Settings Tabs Open The Tab You Tapped**
  In the mobile Contents drawer on System Settings, every tab shared one internal identifier, so tapping one could switch to a different one. Each tab now has its own, and the drawer highlights the tab you are on.
- [Lock] **[FIXED]** **Admin Controls Match The Permissions They Need**
  The Active Staff tab was shown to staff roles whose accounts the underlying endpoint always rejects, and the Staff Role and Badges cards were gated on the delete-user permission rather than the permissions they actually use. Each now checks the right permission, so a role no longer sees a screen that immediately fails for it.
- [Eye] **[FIXED]** **Admin Form Fields Are Properly Labelled**
  Fields on the mass-email composer, the IP block-rule form, the engine-feedback dialog, the gift-subscription dialog and the user detail page had visible labels that were not attached to their inputs, so a screen reader announced a run of unnamed edit boxes. That included the control choosing whether a broadcast goes to one person or every registered user. All are now correctly labelled.
- [Layout] **[FIXED]** **Admin Sidebar Stays Clickable Under Banners**
  With a site notice or the impersonation banner showing, the top navigation slid down over the admin sidebar and covered its first entries. The sidebar now shifts down by the same amount the navigation does.
- [Smartphone] **[FIXED]** **Scan Results No Longer Scroll Sideways On A Phone**
  The row of buttons above a scan's findings was wider than a phone screen and pushed the whole page sideways, so History and a scan report both drifted off the edge whenever you scrolled. Those buttons now wrap onto a second line instead of forcing the page wider. Nothing scrolls horizontally any more.
- [Smartphone] **[FIXED]** **Account Settings Tabs Are Readable On Mobile**
  Below 640px the eight tabs across the top of Account Settings showed only their icons, with no text and nothing for a screen reader to announce, so the sections were effectively unlabelled. Every tab now keeps its name at every screen width, and the one you are on is announced as the current page.
- [Smartphone] **[FIXED]** **History Tabs Stopped Wrapping Into Two Ragged Lines**
  My History, Assets, Attack Surface and Public Scans did not fit across a phone screen, so each label broke onto two lines and the underline beneath them came apart. The row now scrolls sideways on its own instead of wrapping, and the tap targets are taller.
- [RefreshCw] **[FIXED]** **Rescan From History Says What Happened**
  Rescanning a URL from the history row menu started a scan in the background and then showed nothing at all: no confirmation, no progress, and no message if the scan was refused or you had hit your daily limit. A failed rescan looked exactly like a successful one, so the natural response was to click again and spend another scan. It now confirms that the scan started and tells you when it will show up, or says why it did not start.
- [Smartphone] **[FIXED]** **History Rows Have Actions On A Phone**
  The per-row menu holding View details, Rescan and Open URL was hidden entirely below 640px, and on desktop it only appeared when you moved a mouse over the row, which a touch screen never does. The menu is now present at every screen size and always visible on touch. Mobile rows also name the worst severity found, so you can tell which ones are worth opening.
- [FileText] **[FIXED]** **Scan Notes No Longer Vanish When Saving Fails**
  Typing notes on a scan and clicking Save closed the editor whether the save worked or not, so a failed request threw the text away and looked like it had been stored. The editor now stays open with your text intact and says what went wrong, and only closes once the note is actually saved.
- [Filter] **[FIXED]** **Deep Scans Respect The Check Families You Picked**
  On a deep (crawl) scan, unticking check families or turning on active probes had no effect: the choices were dropped between configuring the scan and running it, and the scan quietly ran everything. Your selection is now carried through to the scan, which is what a single-page scan already did.
- [Bell] **[FIXED]** **Missing Email Preferences Added To Your Account**
  Four email categories existed in the system with no switch anywhere in Account Settings, so if you unsubscribed from critical-finding alerts or product updates from an email footer you could never turn them back on. Critical Findings, Product Updates and Tips and Guides now have their own switches. The Posture Digest switch was also only setting half of what controls it, so it could read as on while nothing was ever sent; one switch now sets both.
- [Database] **[FIXED]** **A Failed Load No Longer Says You Have No Scans**
  If the server failed to return your history or your share links, both pages fell through to their empty state and told you there was nothing there. For a page listing your scans that reads as data loss. Both now show a distinct message saying the list could not be read, that nothing was deleted, and offer a retry.
- [Bug] **[FIXED]** **Opening A Scan That Cannot Be Loaded Explains Itself**
  Clicking a scan that had been deleted, had aged out of your retention window, or hit a server error silently bounced you back to the list, with the scan still in the address bar. It looked like the click had been ignored. You now get a message that distinguishes a scan that is gone from a server that failed, with a retry for the second case.
- [Bug] **[FIXED]** **Profile Picture Upload Failures Are Visible**
  When an avatar upload was rejected, the error message came back empty and the banner that should have shown it never rendered, so the crop dialog just sat there and the same file could be retried forever. Failures now say so.
- [Lock] **[FIXED]** **A Server Hiccup No Longer Logs You Out Of Your Profile**
  Any failed response while loading Account Settings sent you to the login screen, including a plain server error on a perfectly valid session, which read as being randomly signed out. Only a real authentication failure redirects now; anything else says the page could not load and offers a retry.
- [Bell] **[FIXED]** **Status Messages Follow You Down Long Settings Pages**
  Account Settings writes every success and failure into one banner at the top of the page, but the Developer tab is long enough that deleting a webhook or a schedule near the bottom put the message hundreds of pixels out of view. A failed delete therefore looked like a click that did nothing. The banner now sticks below the header and scrolls itself into view when something fails.
- [Shield] **[FIXED]** **Billing Errors Read Like English**
  If opening the billing portal failed, the message shown was a paragraph of framework internals about the real error being omitted in production. On a billing screen that reads as the product being broken with your money involved. It now says what happened in plain language.
- [ShieldAlert] **[SECURITY]** **Changing A Scan's Visibility Confirms Or Refuses**
  Turning off a scan's public listing, or switching a scan to private, failed in complete silence: the switch flicked back within a fraction of a second and the menu item read exactly as before. A report you believed you had made private stayed public. Both controls now say when the change did not go through and what the scan's visibility still is. Creating a share link and deleting a scan report their failures too.
- [Sparkles] **[FIXED]** **AI Verification Says Why It Did Not Run**
  After a scan, choosing to verify findings with AI and having it fail simply dismissed the dialog, which looks identical to choosing to skip it. Running out of AI credits, a provider outage and a successful run that changed nothing were all the same screen. The dialog now stays up and shows the reason, and a credits problem takes you to the upgrade options.
- [CheckCheck] **[FIXED]** **Post-Scan Dialog Works With A Keyboard**
  The dialog that appears at the end of a scan claimed to be a modal but never moved focus into itself, did not keep Tab inside it, and ignored Escape, so a keyboard user had to tab blindly through the page behind it to reach either button. It now takes focus, keeps it, and closes on Escape, like every other dialog in the app.
- [Search] **[CHANGED]** **Search Findings By Check ID**
  The search box above a scan's findings only matched titles and descriptions, so pasting in a check ID copied from a CI upload, a GitHub code-scanning alert or a check documentation page returned nothing, and the finding looked absent when it was right there. Search now also matches the check ID and the category, by key or by name.
- [FileText] **[FIXED]** **Report Exports Show Progress And Confirm The Download**
  Choosing an export format ran the whole report generator on the spot with no spinner, no disabled menu item and no confirmation, so on a large scan the tab froze for a moment and then said nothing. If the download went to a folder you do not watch, there was no way to tell it had worked. Exports now show which format is running and name the file that was saved.
- [Bug] **[FIXED]** **Scan Tags Report Failures And Cannot Be Double-Clicked**
  Adding or removing a tag on a scan fired off the request without waiting for it and closed the input straight away, so a rejected change was invisible and two quick clicks could leave the tags on screen disagreeing with what was actually saved. Tag changes now wait for the server, disable while in flight, and say when one did not stick.
- [Smartphone] **[FIXED]** **The Invisible Tag Button On History Rows Is Gone**
  An add-tag button sitting under each history row's URL was invisible but still clickable, and because a phone never hovers it stayed that way, so tapping a row near the URL opened a tag input instead of the scan. It is now properly out of the way until the row is hovered or focused.
- [Gauge] **[FIXED]** **Dashboard Activity Handles A Failed Load**
  When the dashboard summary failed to load it rendered nothing at all, leaving the scan box followed by blank space with no explanation and no retry, and a partial response could take the whole page down with an error. It now shows a short message with a retry, and copes with missing pieces instead of crashing.
- [Timer] **[FIXED]** **A Stalled Connection No Longer Freezes The Scanning Page**
  The scanning page checks in with the server every couple of seconds, and a single request that hung without ever failing left the progress bar frozen while the timer kept climbing, with no way out until you reloaded. Each check now has its own deadline. It is also more patient with flaky connections before giving up, and when it does give up it tells you the scan is still running and will appear in your history.
- [Zap] **[PERFORMANCE]** **Leaving The Dashboard Stops The Status Polling**
  Starting a deep crawl and then navigating away left the page checking the scan's status every two seconds for up to sixteen minutes, sending hundreds of requests nothing was left to read. Polling now stops when you leave the page or cancel the scan.
- [List] **[FIXED]** **Bulk Scanning Says Queued, Not Scanned**
  A bulk run reported every URL as scanned the instant the last request was accepted, while all of those scans were still running on the server, and any that later failed was still counted as a success. It now says how many scans were queued and that they appear in your history as each finishes.
- [Smartphone] **[FIXED]** **Software Inventory Header Stops Clipping On Mobile**
  When a scan found components with known CVEs, that count and the expand arrow were pushed off the edge of the panel on a phone, so the panel looked like it had nothing to open at exactly the moment it had the most to show. The header now fits.
- [Bug] **[FIXED]** **Switching Between Findings No Longer Crashes The View**
  Opening a finding with several code examples, selecting the third tab, then going to a finding with only one example broke the page outright. The selected tab is now kept in range whichever finding you open.
- [Layout] **[CHANGED]** **Findings Come First In A Scan Report**
  Every scan report put the list of things to fix last, below the screenshot, response headers, DNS records, open ports, threat intel, software inventory, tags and notes. On a shared or public report that meant a first-time reader saw infrastructure detail before the security result. Findings now sit directly under the summary, with the supporting panels below them.
- [Layout] **[CHANGED]** **The Fix Is Closer To The Top Of A Finding**
  Opening a finding put a status picker and a feedback prompt above the evidence and the fix, so you were asked to triage a finding before being shown the case for it. Evidence, what it means and how to fix it now come first, with the triage controls below them.
- [Network] **[FIXED]** **Fetch DNS Records Or Run A Port Sweep After The Fact**
  Port scanning is opt-in at scan time and DNS records depend on a cache, so a scan could easily carry neither. When that happened both panels disappeared entirely, taking their fetch buttons with them, and the only way to get that data was running the whole scan again and spending another daily scan. Both panels now stay on your own scans and offer to fetch the missing data in place.
- [Key] **[FIXED]** **Removing Your AI Provider Now Asks First**
  Resetting back to built-in AI deleted your provider's API key with no warning, from a small text link as well as a button, and the key is never shown back so the only way to recover was to reissue it with your provider. It now explains exactly what goes and asks for confirmation.
- [Database] **[FIXED]** **Scheduled Backup Failures Now Raise An Alert**
  A scheduled database backup that failed reported a clean pass to the alerting system and wrote nothing to the error log, so a nightly backup that had been broken for weeks looked healthy. Backups that fail now return a real failure, log it, and trip the admin alert after a few consecutive bad runs. If you have automatic backups turned on, you will hear about it when they stop working.
- [Lock] **[SECURITY]** **Suspending An Account Now Stops Its API Keys**
  Disabling an account cleared its sessions but left its API keys working, so a suspended user could keep running scans and reading or deleting their history over the API while the admin panel showed the account as disabled. API key authentication now checks the account's status on every request, so a suspension takes effect everywhere at once.
- [Key] **[SECURITY]** **Rotating The Encryption Key No Longer Destroys 2FA Seeds**
  The startup routine that encrypts stored secrets treated anything it could not decrypt as unencrypted, so after an encryption key change (or a restore from a backup taken under a different key) it would re-encrypt already-encrypted data and permanently lose every stored 2FA seed and Discord token. It now recognises that case, leaves the data untouched, and logs a clear message telling the operator the key looks wrong.
- [ShieldCheck] **[SECURITY]** **Discord Sign-In Is Now Tied To Your Browser**
  The Discord sign-in flow did not check that the browser finishing the sign-in was the one that started it. Someone could prepare a Discord sign-in link for their own account and get you to open it, quietly swapping your session for theirs so your work landed in their account. Discord sign-in now carries a one-time value that only the browser that began the flow holds, matching how Google and GitHub sign-in already worked.
- [Eye] **[SECURITY]** **Asset Directory No Longer Exposes Full Scanned URLs**
  Browsing all hosts in the asset directory returned the exact URL of each host's most recent public scan, query string included. That could reveal a one-time login link, a password reset URL or a signed download link that happened to be scanned. The directory now shows the hostname only, matching the host report page.
- [Shield] **[SECURITY]** **Staff 2FA Enforcement Now Covers Support Tickets**
  When the operator requires two-factor authentication for staff accounts, a staff account without it was correctly locked out of the admin panel but could still open any customer's support ticket, see the customer's email address, and reply to them as Support. Support tickets now go through the same check as every other staff area.
- [Users] **[SECURITY]** **Shared Support Tickets End When The Team Membership Does**
  Sharing a support ticket with a teammate created access that never expired: if that person later left the team, or the team was deleted, they kept reading and replying to the ticket indefinitely and it stayed in their own ticket list. Access is now re-checked on every read, and the stale share records are cleaned up when someone is removed from a team.
- [Gauge] **[PERFORMANCE]** **Public Scans Directory Loads Much Faster**
  The public scans page was loading the complete finding details for every scan on the page, including every description, fix step and code example, just to work out a one-word safety verdict per row. It now asks the database for only the few fields that verdict needs, and fetches the page and its total count together instead of one after the other.
- [Activity] **[FIXED]** **Dashboard Activity Tooltip Shows Real Issue Counts**
  Hovering a bar in the dashboard activity chart always said "0 issues", whatever those scans actually found, because the number was never calculated. It now reports the issues found on that day.
- [Zap] **[PERFORMANCE]** **Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans**
  The dashboard was running seven separate whole-history queries on every load, one of which expanded the findings of every scan you had ever run. It now runs fewer, tighter queries, so the page loads faster and stops crowding out other requests. "Most common findings" also now ranks the latest scan of each site instead of every scan ever, so rescanning one site fifty times no longer pushes its issues to the top of the list.
- [Container] **[FIXED]** **Usage Metering Failures Are No Longer Silent**
  Several background writes that record live-browser usage and free up session capacity were discarded without a trace if they failed, so a persistent problem would quietly stop usage being counted and leak browser session slots until nobody could start one. These failures are now logged and show up in the admin error log, and a settings hiccup can no longer stall the browser session queue.
- [Network] **[SECURITY]** **IPv6 Rate Limits Can No Longer Be Sidestepped**
  Rate limits on sign-in, sign-up, password reset, contact forms and the public scans directory were counted per exact IP address. Because a single IPv6 allocation contains billions of addresses, anyone with one could get a fresh allowance for every request. Those limits now count per IPv6 network block, so one subscriber gets one allowance. IPv4 is unchanged, so people sharing an address are not lumped together.
- [Key] **[SECURITY]** **Turning Off API Keys Now Turns Off Existing Keys**
  Switching the API keys feature off only blocked creating new ones: every key already issued kept working against the whole API, while the admin panel showed the feature as disabled. Turning it off now stops all API key access immediately, which is what you want when a key may have leaked.
- [Bell] **[FIXED]** **A Missing Stripe Webhook Secret Is Reported As A Misconfiguration**
  If the Stripe webhook secret was not configured, every incoming payment event was rejected as "Invalid signature" with no way to tell a setup mistake from an attack, and Stripe stopped retrying. It is now reported as a configuration problem with an admin alert, and Stripe keeps retrying so nothing is lost once the secret is set.
- [Timer] **[FIXED]** **Discord Sign-In Honours The Configured 2FA Code Expiry**
  The email two-factor code sent during Discord sign-in always expired after 10 minutes regardless of the expiry set in the admin panel, unlike every other sign-in path. It now uses the configured value.
- [Share2] **[FIXED]** **Share Settings Now Apply To An Existing Link**
  Changing whether a scan appears in the public directory was silently ignored when the scan already had a live share link: the request reported success but kept the old setting. It now applies. Leaving the setting out of a request still leaves it exactly as it was.
- [Zap] **[PERFORMANCE]** **AI Assistant Context Loads Without Re-Reading Megabytes Per Request**
  Every AI assistant slash command re-read its reference file from disk, up to about a megabyte each time, which briefly stalled the whole server. Those files only change when a new version is deployed, so they are now read once and kept in memory. The account-related commands also stopped looking up your session twice.
- [Gauge] **[FIXED]** **A Gifted Plan Can No Longer Downgrade A Paying Customer**
  If an admin gifted a plan to someone who was already paying for a higher tier, the gift replaced their plan outright: their limits dropped to the lower tier while their card kept being charged the higher price. A gift is now only ever an upgrade, and the higher of the two plans applies everywhere.
- [Trash2] **[SECURITY]** **Account Deletion Now Clears Feedback Notes And Email Records**
  Deleting an account left two things behind: the free-text notes and scanned URLs from any finding feedback you submitted, and your email address in the outgoing mail log. Both are now removed as part of the deletion instead of lingering until an unrelated retention sweep.
- [Globe] **[FIXED]** **Self-Hosted AI Requests Identify Your Own Deployment**
  When routing AI requests through OpenRouter, the app identified itself as vulnradar.dev even on a self-hosted install, so a self-hoster's AI usage was attributed to the hosted service. It now sends your own configured app URL and product name.
- [Globe] **[FIXED]** **Public Host Reports Load Again**
  The shareable host report page failed for anyone who was not signed in. The page itself loaded, but the request it makes for the report data was being bounced to the login screen, so every logged-out visitor and every search engine saw "Could not load this host's report" instead. Signed-in users never hit it, which is why it went unnoticed. Host reports and their danger-score trend now load for everyone, as they always should have.
- [Mail] **[FIXED]** **Contact Form Messages Now Reach Us**
  A message sent from the contact page by anyone who was not signed in never arrived. The form reported a generic "unable to send" error and the message was lost, which included bug reports, feature requests and security disclosures sent by researchers following the address published in our security.txt. The form now submits correctly whether you are signed in or not.
- [Key] **[FIXED]** **Staff SSO Sign-In Works**
  Single sign-on for staff against a corporate or self-hosted identity provider could never complete. The login page could not detect that SSO was configured, so the sign-in link never appeared, and starting the flow by hand or returning from the identity provider both landed on the password form with no explanation. All three steps of the flow are now reachable, so an operator who configures staff SSO gets a working sign-in link.
- [Settings] **[FIXED]** **Admin Settings Now Say What They Actually Do**
  A large group of settings in the admin panel saved successfully and then changed nothing. The branding and SEO fields promised to apply "after the next build and deploy", but nothing reads those saved values at build time or at any other time, and seven more settings that promised to take effect within seconds had no reader at all. The seven dead ones have been removed from the panel, and every remaining field that cannot be changed from the admin panel now says so plainly and names the value to change instead. Turning billing off likewise now explains which half applies immediately and which needs a rebuild.
- [Database] **[FIXED]** **Backups And Avatars Survive A Container Update**
  On a Docker deployment, database backups and locally stored avatars were written into the container's temporary layer, so the documented update command wiped them every time. Worse, the app could not create those directories in the first place and a backup would have failed on a permission error. Both directories are now created with the right ownership and mounted as persistent volumes, so backups taken from the admin panel or on a schedule actually stick around.
- [ShieldAlert] **[FIXED]** **A Missing Encryption Key Now Fails Loudly**
  The API key encryption key is the variable self-hosters most often forget, and leaving it out used to look like success: the stack reported as started and then quietly restarted in a loop, indistinguishable from a database problem. Starting the stack without it now stops immediately with an error naming the variable, so the fix is obvious instead of buried in container logs.
- [Container] **[ADDED]** **ARM64 Docker Images**
  The published container image was built for Intel and AMD only, so anyone self-hosting on a Raspberry Pi, Apple Silicon, or an Ampere or Graviton server got a "no matching manifest" error and could not start it at all. Releases now publish a single image that covers both 64-bit ARM and x86.
- [RefreshCw] **[FIXED]** **Release Candidates No Longer Offered As Upgrades**
  Any tag starting with a v republished itself as the newest release, so cutting a release candidate or a patch for an older version line told every self-hosted instance it was out of date and offered the older or unfinished build as an upgrade. Only a clean, highest version number now becomes the latest release and image, and suffixed tags are published as prereleases. Two releases pushed close together can also no longer race each other.
- [Container] **[FIXED]** **Digest-Pinned Images Stop Disappearing**
  Self-hosters are told to pin their image by digest for an immutable deployment, but the weekly registry cleanup deleted any digest that no longer had a tag on it, with no grace period. Re-running a release pipeline was enough to orphan the exact digest an operator had pinned, and their next pull or restart failed with "manifest unknown" and no way back. The cleanup now leaves anything from the last thirty days alone.
- [ShieldCheck] **[SECURITY]** **Automatic Base Image Updates**
  The Node and PostgreSQL base images behind the container are pinned on purpose, but nothing ever opened the update request that pinning assumes someone will remember, so they drifted about a year behind published security fixes. Dependency updates now cover the container images too, with major version jumps still held back for a deliberate decision.
- [Sparkles] **[CHANGED]** **A Product Description That Says Something**
  The one sentence that describes VulnRadar in search results, link previews, the app manifest and AI answers was generic marketing copy about instant reports and collaboration tools. It now says what the scanner actually does: paste a URL, get deterministic checks back with the response evidence, a finding ID that does not change between runs, and the config line that fixes it.
- [Palette] **[FIXED]** **Fork-Friendly Community And Store Links**
  The Discord invite and the Chrome and Firefox extension listings were hardcoded to ours and were published in structured data as the running site's own verified profiles, which told search engines a fork and VulnRadar were the same organisation. All three can now be set per deployment, and the code comments no longer claim they ship empty when they do not.
- [FileText] **[CHANGED]** **Self-Hosting Documentation Gaps**
  The variable that controls which network interface the app is published on existed only as a comment inside the compose file, so an operator whose reverse proxy was on another machine got a connection refused with nothing to point them at the cause. It is now documented alongside the port setting. The setup notes also now say plainly that the prebuilt image has the upstream address compiled into its pages, and that rebranding the client side means building the image yourself.
- [Settings] **[FIXED]** **Configuration Docs Now Describe The Real System**
  The README and four documentation pages still explained configuration as two files that were deleted, and promised a build-time safety net that went with them. They now describe what actually happens: a setting resolves from the database first, then an environment variable, then the value the repo ships with. Of the 268 settings, 239 take effect the moment you save them in Admin, Settings, with no rebuild. If you had been rebuilding an image to change a rate limit or a feature flag, you no longer need to.
- [Key] **[FIXED]** **A Real Way Back In When 2FA Email Stops Arriving**
  Self-hosting docs told an operator locked out by a broken mail server to call an endpoint that requires the login they cannot complete, so the only recovery offered could never work. The troubleshooting section now gives the database command that actually clears the second factor, explains why the repair script will not help with a healthy account, and documents every diagnose, repair, backup and restore command the project ships.
- [Container] **[ADDED]** **Upgrade And Rollback Are Documented**
  The self-hosting guide's upgrade instructions were two commands with no backup step, no migration step, and no way back if the new version failed to start. It now walks through backing up first, advancing the schema before the new code takes traffic, and rolling back, including what changes when the release altered the database. It also explains why a failed upgrade shows up as a crash loop rather than an automatic revert.
- [Code] **[FIXED]** **API Key Responses Documented As They Actually Are**
  Every API key example in the reference used field names the server does not send. Creating a key returns 201 with everything nested under key, the prefix field is key_prefix, and there is no top-level id or name. A new key's daily limit comes from your plan, 25 on Free through 5,000 on Pro Supporter, not the flat 50 the docs claimed. Rotation was described as deleting and recreating the key; it swaps the secret in place, so the id, name, scopes and today's usage all carry over.
- [List] **[FIXED]** **Scan History Endpoints Corrected**
  The history documentation was wrong in four ways: the scan id is an opaque string, not a number; the list shows only your own scans, never a teammate's; deleting all history returns a plain message rather than a count, and leaves GitHub repo scans alone; and history is kept forever on every plan by default, not deleted after 30 or 90 days. The missing 403 and 429 responses, including the scan:delete scope that new keys do not get by default, are now listed too.
- [Gauge] **[FIXED]** **Rate-Limit Headers: What Actually Arrives**
  The docs said every successful scan response carries five rate-limit headers. Three of them arrive, and only when you authenticate with an API key. A scan started from a session cookie carries none, and neither does any history or status read. Both the API reference and the rate limits page now say exactly which endpoint sends what, so a client that throttles on those headers is not silently doing nothing.
- [Bell] **[FIXED]** **Free Accounts Do Get A Webhook**
  The webhooks page said the free plan allows zero webhooks, in four places. It allows one. Free users were being told a feature they already have is unavailable. The page now states the real caps, and the test-webhook section no longer promises a response field that does not exist or implies the test delivery is signed, because it is not.
- [ShieldAlert] **[SECURITY]** **CI Integration Snippet No Longer Pins A Moving Branch**
  The published GitHub Actions snippet pinned our scan gate to the main branch, which means every push here would have run inside your pipeline with your secrets available. The documented snippet now pins a release tag and shows the stronger commit-hash form alongside it, with a note explaining why the moving reference was a bad idea.
- [Search] **[FIXED]** **Crawl Page Limits Match The Product**
  Several pages and the CLI help still said a crawl covers 15 pages and discovery finds 20 URLs. The real caps are 25, 50, 100 and 250 pages by plan, uncapped on a self-hosted install with billing off, and discovery goes up to 500. Paying users were being told they had a fraction of what they were paying for.
- [Network] **[FIXED]** **Correct HTTP Status Codes In The Error Table**
  The API error table said a blocked or private-address target returns 422; it returns 400. It also omitted five codes the API really sends: 402, 409, 413, 502 and 503. A generic error handler written from the old table had no branch for any of them. Every row is now checked against the routes.
- [Users] **[FIXED]** **The Permissions Model Documented Correctly**
  The architecture page described four roles with the wrong level numbers and pointed at a file that no longer exists. There are nine roles. It now renders the real table, explains that the four roles sharing a level are specialists rather than a rank, and states that the top-level super admin role is assigned only to the first account on a fresh install and cannot be granted through any admin screen.
- [Search] **[FIXED]** **Docs Pages No Longer Publish Contradictory Search Metadata**
  Every page under the docs section emitted two conflicting sets of structured data, one inherited from the parent describing the docs index rather than the page you were on. Search engines treat that as malformed and can discard it entirely, so pages lost the rich results the markup existed to earn. Each page now publishes one correct set, with a breadcrumb trail that starts at the home page like the rest of the site.
- [Eye] **[FIXED]** **API Playground Inputs Are Labelled**
  Expanding an endpoint in the API playground stacked several text boxes whose labels were not connected to them, so a screen reader announced a row of unnamed fields. Every parameter input and the request body now carry a proper label association, and hint text is announced with the field it belongs to.
- [FileText] **[CHANGED]** **Contributor And Security Docs Say What Is True**
  The contributing guide listed two of the seven checks that gate a pull request and never mentioned that the project has tests, or that editing a docs page requires regenerating and committing the AI knowledge files, which is the most common surprise CI failure here. The security policy pointed reporters at a PGP key and a credits list that do not exist, and scoped out self-hosted deployments against a hardening guide that was never written. Both now match reality.
- [Sparkles] **[CHANGED]** **A Better First Screen On The README And Docs**
  The project README opened with a feature list of twenty nouns and no license or build badge. It now leads with what you actually get, links straight to a no-account scan, and each bullet says what the feature is for. The docs landing page used to open with a four-step API onboarding; step one is now scanning a URL with no account at all, and the demo and browser extension are linked above the fold. The extension page also stopped telling Firefox users to sideload a temporary add-on while linking to the live store listing directly above it.
- [Wrench] **[ADDED]** **Every Script The Project Ships Is Now Listed**
  Two places claimed to list every npm script and between them named 24 of 35, omitting every database diagnostic, repair, backup and restore command. An operator with a broken database had five purpose-built tools available and no document that mentioned any of them. Both inventories are complete, the scripts directory listing matches what is actually there, and there is a short guide for when something is wrong with the database.
- [FileText] **[FIXED]** **Readable Arrows And Symbols In PDF Reports**
  Any character outside plain ASCII came out of a PDF report as garbage. A leaked-token finding told you to visit "GitHub Settings a†' Developer Settings" instead of showing an arrow, and accented names, the section sign and curly quotes were all mangled the same way. PDF reports now declare a real text encoding and convert every character to it, so remediation steps read as written.
- [Palette] **[CHANGED]** **PDF Reports Use The Current Brand Colour**
  The cover bar, the wordmark and every section heading in a PDF report were still the old teal, so the one document that leaves the product and gets forwarded to other people did not look like the product. The report now reads its colours from the same brand definition the emails and the site use.
- [Gauge] **[CHANGED]** **Real Severity Bar On The PDF Cover**
  The severity breakdown on a report's cover page was drawn with repeated hash characters and capped at thirty, so a target with forty criticals and three lows looked like a four-to-one split instead of thirteen-to-one. It is now a proportional bar with a legend, matching how severity is shown in the app and in the emails, and the five severity colours match the app exactly.
- [Wrench] **[FIXED]** **Long Evidence No Longer Runs Off The Page In PDF Reports**
  A URL, header value, policy string or token longer than one line was drawn straight past the right edge of the paper and silently lost, with no ellipsis to say anything was missing. Long strings now break at a sensible point and continue on the next line, evidence and code samples are set in a monospace face so they stay aligned, and a finding that spans a page break keeps the report header on the continuation page.
- [Mail] **[FIXED]** **One-Click Unsubscribe On Notification Email**
  Notification emails carried no unsubscribe header, which mail providers treat as a spam signal and which left the in-app spam button as the only way out for some recipients. Every email that can be opted out of now carries a standard one-click unsubscribe your mail client can act on, and the footer's mention of your account settings is finally a working link. Security notices such as password changes and sign-in codes stay exempt, because those are not optional.
- [Eye] **[CHANGED]** **Useful Inbox Preview Text On Every Email**
  Every email previewed in your inbox as the word VulnRadar followed by the first few words of its own heading, which repeats the sender and the subject and tells you nothing. Emails now carry a hidden preview line taken from the first real sentence of the message, so a scan-complete email previews with its finding counts and a code email previews with how long the code lasts. Codes and tokens are deliberately kept out of that preview.
- [Settings] **[FIXED]** **The No-Reply Address Setting Now Affects Outgoing Mail**
  Self-hosters were told to set a no-reply address, and the admin panel offered the field, but nothing read it: mail went out from whatever SMTP username was configured. A configured no-reply address is now used as the From address on outgoing mail. An explicitly set SMTP from-address still wins, and an untouched setting changes nothing, so no existing deployment starts sending from a different address.
- [Timer] **[FIXED]** **Expiry Times In Email Match The Real Setting**
  The sign-in code, billing code and team invite emails all stated a fixed expiry in their text while the actual window came from an editable setting. An operator who shortened the two-factor code window shipped mail telling users it lasted twice as long, and a lengthened team invite still said seven days. Those three templates now take the real value, so the copy follows the setting.
- [Globe] **[ADDED]** **The Browser Extension Can Point At A Self-Hosted Instance**
  The extension was compiled against one fixed address with no way to change it, so a self-hoster's users got a tool that sent their scan targets to the public instance and would never work against their own. Builds now accept an instance URL, and the same value flows into the permissions the browser grants, so a repointed build actually works. It also stops auto-scanning its own instance rather than only skipping the public one.
- [Network] **[FIXED]** **The Extension's Port Sweep Setting Works Again**
  The extension's Service Probes panel let you pick services and ports and sent them on every scan, but the scanner had stopped reading that field long ago, so nothing you set there ever happened. It is replaced by the single port and service sweep option the scanner actually supports, which needs a verified domain the same way active probing does.
- [Lock] **[SECURITY]** **The Extension No Longer Exposes Its Pages To Any Website**
  The extension listed its popup, settings and welcome pages as reachable from any web page, though nothing ever opened them that way. That let any site you visited detect the extension was installed, and let a site frame the settings page to bait a click that wipes your stored API key. Those entries are gone.
- [RefreshCw] **[FIXED]** **The Extension Recovers From An Interrupted Scan**
  If the browser restarted or the extension reloaded while a scan was running, the extension was left believing that scan was still in flight forever. Reopening the popup on that site showed a spinner that never resolved and a disabled Scan button, with no way back short of clearing extension storage. The extension now recognises an interrupted scan, clears it, and tells you to run it again.
- [List] **[CHANGED]** **Clearer Empty And Incomplete States In The Extension**
  A freshly installed extension showed an almost blank panel with nothing to say what it would fill with, and could not tell an empty history from a history that failed to load. A scan with no findings also claimed a clean result even when parts of the scan had run out of time. Both are fixed: the panel explains itself on first run, says so when the history fetch fails, and a scan that did not finish every check is labelled as such instead of being reported as clean.
- [Palette] **[CHANGED]** **The Extension Looks Like The Rest Of The Product**
  The extension declared its colours in several places that disagreed with each other and with the app, so the card injected into a page did not match the popup you opened next, and severity was drawn as loud filled pills where the app uses quiet tinted chips. Everything now comes from one definition, the severity colours match the app exactly in both light and dark mode, and severity reads by weight as well as colour rather than by colour alone.
- [Zap] **[PERFORMANCE]** **Scans No Longer Wait On Subdomain Discovery**
  Every scan of a domain we had not seen before sat for up to 15 extra seconds waiting on automatic subdomain discovery, even though nothing on the result page needed it. Discovery now runs in the background and warms the cache, so a first scan finishes in the two to five seconds it should and a repeat scan of the same domain still shows the subdomain panel instantly. A domain that genuinely has no subdomains is also remembered now, instead of paying the full penalty on every single scan forever.
- [ShieldAlert] **[FIXED]** **Deep Scans Can Now Report An Incomplete Result**
  A deep (crawl) scan had no way to tell you when it came back short. If a page's DNS or TLS checks ran out of time, their findings were quietly replaced with nothing and the result still claimed full engine confidence, so the same crawl re-run could produce different findings with no explanation. Deep scans now record exactly which checks did not finish, lower the confidence figure to match, and a page that could not be fetched at all is reported as a gap rather than as clean.
- [Bug] **[FIXED]** **A Broken Check No Longer Counts As A Passed Check**
  If a single detector crashed mid-scan, the error was swallowed with no log line anywhere and the check was still counted in the checks-run total, so a permanently broken detector could report nothing wrong for months with no signal to anyone. A crashing check is now named in the server log, excluded from the checks-run count, and recorded on the scan so an operator can see it happened.
- [Timer] **[FIXED]** **A Slow-Trickling Target Can No Longer Stall A Scan**
  A server that sent response headers immediately and then dribbled out its body a byte at a time could hold a scan, a crawl or a page-discovery pass open indefinitely, because the request deadline stopped applying the moment the headers arrived. The deadline now covers the whole response, one shared reader with both a size limit and a read timeout is used everywhere a response body is read, and the source-map follow-up fetch is capped even when the server sends no content length.
- [Lock] **[SECURITY]** **More Internal Address Ranges Blocked**
  The scanner's private-address block list was missing the shared address space used by carrier-grade NAT and by Kubernetes pod networks, which meant Alibaba Cloud's instance metadata endpoint was reachable even though the equivalent AWS one was blocked. That range is now blocked, along with the benchmarking, protocol-assignment and documentation ranges, including when they are written in IPv6 form.
- [Gauge] **[PERFORMANCE]** **Faster CVE Correlation At The End Of A Scan**
  After the checks finished, the software inventory looked up known CVEs for each detected component one at a time, which could add tens of seconds of pure waiting to a scan of a site that advertises its server, language and CMS versions. Those lookups now run several at a time with an overall deadline, exploit-likelihood scores are remembered between scans, and a slow third-party CVE service can no longer keep you on the loading page.
- [Bell] **[FIXED]** **Alerts Now Fire When A Finding Gets Worse**
  The new-critical-findings email compared scans by finding identity only, never by severity. A finding that escalated from medium to high on your next scan, which is exactly the event the alert exists for, was treated as already known and never emailed. An issue that climbs into high or critical since the previous scan of the same URL is now reported as new.
- [Search] **[FIXED]** **A Timed-Out Email Security Check Now Says So**
  If the MTA-STS or TLS-RPT lookup ran out of time against a slow or distant DNS resolver, the scan returned nothing for it, which looked identical to a domain that was checked and found fine. That is a silent false negative on a security report. Those checks now state plainly that they did not complete, so you can re-run rather than assume the area is clean.
- [Activity] **[FIXED]** **A Timed-Out Scan Now Actually Stops**
  When a scan hit its overall time limit, the record was marked failed and the concurrency slot was handed back, but the scan itself kept sending requests to the target with no way left to stop it. The time limit now cancels the work as well as the record, so a scan that is declared dead stops immediately.
- [RefreshCw] **[FIXED]** **Scheduled-Scan Worker Health Alerts**
  The alert for a failing scheduled-scan worker only counted crashes of the whole pass, and every individual scheduled scan failing was recorded as a healthy run. That reset the failure streak on every tick, so the alert could never fire no matter how long scheduled scans had been broken. A pass where everything due failed is now counted as a failure.
- [FileText] **[FIXED]** **API Docs And Playground Corrections**
  The API playground prefilled the scan request with an empty scanner category, so the first request a developer sent started a real scan that ran almost no checks, used a daily scan and came back reporting nothing found. It now prefills real categories. The spec also claimed API-key authentication on endpoints that only accept a browser session, and now documents them honestly as session-only.
- [Search] **[FIXED]** **Search Results For Check Pages No Longer Cut Off Mid-Sentence**
  The title on every check page was trimmed to a fixed length, which put an ellipsis on 348 of them and gave 22 different pages only 8 titles between them, so five separate Permissions-Policy pages all showed up in search as the same result. The summary underneath had the same problem: 682 of them stopped in the middle of a sentence. Titles are now built so the part that identifies the check is never the part that gets cut, and a summary only includes the risk sentence when the whole sentence fits. A test now checks the full set so two pages can never share a title again.
- [FileText] **[FIXED]** **Category Pages Show Their Check Count In Search Again**
  Each check category page appended its check count to the search summary and then trimmed the result, which deleted the count again on 17 of the 18 categories. The count now leads the summary, so the one number that tells the categories apart actually reaches the search result.
- [Globe] **[FIXED]** **Nine Missing Documentation Pages Added To The Sitemap**
  The sitemap listed documentation pages by hand and had fallen behind the docs menu, so the CLI, GitHub scanning, teams, triage, sharing, reports, AI, scheduled scans and account security pages were never advertised to search engines. The sitemap now reads the same table that builds the docs sidebar, so a new documentation page is listed the moment it is added.
- [Zap] **[PERFORMANCE]** **The AI Chat Widget No Longer Loads On Every Page Up Front**
  The chat widget and its markdown renderer, about a fifth of the JavaScript on a first visit, were downloaded on every page in the product including the public marketing and check pages, along with an API request most visitors never needed. It now loads once the browser is idle instead of competing with the first paint. The launcher button appears a moment later than before, and the Ask about this button on a scan summary still opens it immediately.
- [Smartphone] **[FIXED]** **The Cookie Notice No Longer Covers Save Buttons And The Docs Menu**
  On a phone the cookie bar painted over anything anchored to the bottom of the screen, including the Contents button that is the only way to reach the documentation menu on a small screen. The bar now publishes its own height, and the controls that sit at the bottom of the screen move up above it. Toasts moved to the bottom on mobile too, where they no longer cover the app header.
- [CheckCheck] **[FIXED]** **Skip To Main Content Now Actually Moves Focus**
  The skip link at the top of every page jumped the page but left keyboard focus behind, so the next Tab walked straight back into the navigation the reader had just skipped. The main region on the public pages, the check and comparison pages and the documentation is now a real focus target, so the link does what it says.
- [Eye] **[FIXED]** **Readable Contrast On Delete Buttons And Secondary Text**
  White text on the red destructive button measured well below the accessibility minimum in both themes, on the one control that confirms deleting an account, deleting a scan or cancelling a subscription. Success buttons had the same problem in dark mode. Secondary text also failed on the raised grey surfaces it most often sits on, which covers table meta, timestamps, hint lines and every input placeholder. All of those now clear WCAG AA on the surfaces they actually appear on.
- [Palette] **[CHANGED]** **One Dimming Style For Every Dialog**
  Some dialogs dimmed the page to near black and others washed it to near white, so in light mode opening two dialogs in a row inverted the whole screen and read like a rendering bug. Dialogs, alerts and slide-over panels now share one backdrop that is correct in both themes, and the panel itself sits on its own surface so it stays clearly separated from the page behind.
- [Smartphone] **[FIXED]** **The Documentation Drawer Traps Focus And Keeps Its Close Button**
  The documentation menu on phones announced itself as a modal but let the keyboard tab straight out into the page behind it, and its close button scrolled away on the first swipe because it lived inside the scrolling area. Tab now cycles inside the drawer, the page behind no longer scrolls, and the close button stays put.
- [Layout] **[CHANGED]** **Documentation Line Length And Header Alignment**
  Eight of the twenty documentation pages let their body text run about 124 characters per line on a wide screen, roughly double the comfortable measure, because the width limit was applied page by page and had been forgotten. The limit now lives in the shared section component, so no page can drift again. The documentation header also lines up with the content beneath it instead of floating 144 pixels inward on large screens.
- [List] **[FIXED]** **Pagination No Longer Pushes The Page Sideways On A Phone**
  Once you had more than 50 scans the page number row on History and Assets grew wider than a phone screen and the whole page could be scrolled sideways. The row now wraps onto a second line instead.
- [Bell] **[FIXED]** **The Notification Bell Says When It Could Not Load**
  If the notifications request failed, the panel showed the same cheerful empty state as having nothing waiting, so a pending team invite that had not loaded looked like an empty inbox. It now says it could not load and offers a retry. The empty state copy is plainer, and the dismiss buttons are a proper size to tap on a phone.
- [Filter] **[ADDED]** **Search And Severity Filters On The Check Index**
  Finding one check by name on the index meant expanding eighteen accordions and using browser find, and there was no way to ask for every critical check even though a severity is shown on every row. There is now a search box that matches both the check name and the check id, plus five severity toggles. The full list is still in the page for search engines, the filter only hides what does not match.
- [Users] **[ADDED]** **You Can Now Propose A Check**
  The detection set is open source but nothing on the check pages ever said a check could be proposed, so a reader who spotted a gap had no way in. Every check page and the index now link the detector proposal template, which asks for the threat model, how to detect it, the false positive risk and a test fixture.
- [Sparkles] **[CHANGED]** **The New Account Tour Sounds Like The Rest Of The Product**
  The tour a new account sees first was written in generic feature-marketing voice and coloured each of its eight steps a different hue off the chart palette, which meant nothing. Every step now says what actually happens rather than why it is good, the colour marks position and nothing else, and the icon plate on each step is gone.
- [FileText] **[CHANGED]** **The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports**
  The hero answered what the product does but never who it is for or why to pick it over the free header checkers, and both answers were already written further down the page. It now leads with both. The landing page also finally mentions two things that have shipped for a while and were advertised nowhere: SARIF export for the GitHub Security tab, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk, both included on the free tier.
- [Search] **[CHANGED]** **The Hero Caption No Longer Undersells The Scan**
  The caption beside the sample report described a headers-only scanner and claimed the engine never renders a page or takes a screenshot, which is not true. It now names what a single scan actually covers: the certificate and TLS handshake, mail records, every cookie attribute and exposed secrets, alongside the headers.
- [RefreshCw] **[FIXED]** **The Probely Comparison Page Is Up To Date**
  The comparison page described Probely in the present tense as an independent product. Snyk acquired it in November 2024 and it now sells as Snyk API and Web. The page says so, keeps its existing address so nothing breaks, and every comparison table gained a reports and compliance row.
- [Shield] **[FIXED]** **The Accessibility Statement Only Claims What We Actually Do**
  The published accessibility statement said we use automated accessibility testing tools and build accessibility testing into the development process. Neither was true: there is no such tool or CI job in the repository. It now describes the manual keyboard and screen reader passes that do happen, and says plainly that automated testing is not in place yet. The form labels claim was narrowed the same way.
- [Filter] **[FIXED]** **Public Scans No Longer Shows Signed-In Tabs To Visitors**
  The public scans directory showed My History, Assets and Attack Surface tabs to anyone, and all three sent a signed-out visitor to the login page. Those tabs now only appear when you are signed in.
- [FileText] **[FIXED]** **Honest Summary On The Configuration Docs Link**
  The docs menu described the configuration page as covering every setting and every environment variable. It names 76 of 308 constants and 61 of 267 runtime settings, so the promise made readers stop looking after not finding their value. The menu now says what the page really is.
- [Users] **[FIXED]** **Team Scan Sharing Actually Saves The Team**
  Scans could be assigned to a team in theory, but nothing that started a scan ever recorded which team it belonged to, so a team's shared scan view was always empty no matter how many scans members ran. Every way of starting a scan (single URL, crawl, bulk, authenticated, GitHub repo) now accepts a team and stores it, and the team is checked against the teams you are actually allowed to publish into. Scans stay personal unless you pick a team.
- [Settings] **[FIXED]** **Feature Switches Now Reach The Whole Feature**
  Turning a feature off in the admin panel only ever blocked part of it. PDF reports stayed downloadable by direct link after being switched off, and webhook deliveries kept firing to registered endpoints. Both now honour the switch, and all nine feature switches are readable by the app itself so disabled features can be hidden instead of failing at the last step.
- [Zap] **[PERFORMANCE]** **Faster Start For Every Scan**
  Starting a scan used to wait on a chain of separate database and DNS lookups one after another, and it counted your running scans twice. The independent checks now run at the same time and the duplicate count is gone, so the scan is acknowledged noticeably sooner. Nothing about which scans are allowed has changed.
- [Search] **[FIXED]** **SQL Injection Detection No Longer Misses Repeated Queries**
  When a page showed a SQL query as an example and then built the same query for real in a script, the scanner scored the real one against the example's surroundings and reported nothing. It now checks every occurrence where it actually appears, so a genuine SQL injection pattern is still reported even if the same query text also appears as sample content elsewhere on the page.
- [Search] **[FIXED]** **AI-Code Checks Now Look At Every Match, Not Just The First**
  Two vibe-code checks stopped after examining the first thing they found. A harmless comment such as "password: minimum 8 characters" near the top of a file hid a real leftover password further down, and a friendly error string embedded as translation data hid the same string sitting inside real error-handling code. Both checks now review every occurrence, so these findings are no longer silently dropped.
- [Bug] **[FIXED]** **Correct Iframe Origin Matching On IPv6 Targets**
  The unsandboxed-iframe check decided whether an embedded frame was first-party or third-party by pattern-matching the site's address, which fell apart when a site was scanned by its raw IPv6 address. A self-hosted or internal site's own frames were reported as untrusted third-party embeds, and some addresses made the check fail outright and quietly report nothing at all. Frame origins are now compared directly, so the finding only appears for genuinely external embeds. The check also now reads the real src attribute only, so a lazy-loading placeholder attribute can no longer be mistaken for the frame the browser actually loads.
- [Search] **[FIXED]** **Debug Toolbar And Broken Redirect Checks No Longer Stop At The First Match**
  Two checks looked at only the first thing they found on a page and then judged the whole page on it. If a page showed a Django Debug Toolbar or Laravel Debugbar snippet inside a code sample near the top, the scanner treated that as documentation and stopped, missing the live debugger actually loaded further down. The broken meta-refresh check had the same shape: an ordinary auto-reload tag at the top hid a genuinely broken redirect below it. Both now examine every occurrence on the page, so a harmless example no longer conceals a real problem.
- [Filter] **[FIXED]** **Fewer False Alarms On Embedded Forms**
  The external form action check flagged any form posting to an absolute URL, including your own site written out in full and the newsletter or contact forms that Mailchimp, HubSpot, Jotform, Formspree, Salesforce and similar services tell you to embed. Those are now recognised and left alone, so an ordinary marketing page no longer collects a page of warnings for doing exactly what the vendor documented. Forms posting to a genuinely unknown domain are still reported, and a form posting over plain HTTP is now called out separately as the cleartext problem it actually is.
- [Search] **[SECURITY]** **Secrets Hidden Behind An Example No Longer Missed**
  Several secret checks looked at only the first match on a page before deciding whether it was a real credential or a documentation placeholder. If a page showed a sample token near the top, a genuine leaked one further down was never reported. Bearer tokens, AWS keys, GitHub tokens, database connection strings, reflected script payloads and clipboard-hijacking scripts are now each judged individually, so a placeholder can no longer hide a real finding behind it.
- [Key] **[FIXED]** **Clearer Stripe Key Finding**
  The Stripe key finding was titled and worded as though any Stripe key in your page were a leak, while its own fix advice said publishable keys are safe in browsers. It only ever reports secret keys now, so the title, description and remediation steps say so plainly and tell you to roll the key and review recent account activity. Publishable keys, which Stripe requires you to put in client-side code, are no longer described as a payment risk.
- [CheckCheck] **[FIXED]** **postMessage Issue No Longer Counted Twice**
  A page with a message listener that does not validate the sender's origin produced two separate high-severity findings for the same line of code, inflating the risk score. The weaker of the two duplicate checks has been retired, so the issue is reported once, by the version that inspects each listener individually instead of scanning the whole page.
- [FileText] **[FIXED]** **Corrected Inline Iframe Finding Text**
  The finding for an inline srcdoc iframe without a sandbox showed a fix instruction where the risk explanation should have been, and its remediation advised a sandbox setting that a different check flags as unsafe, because the two options together let framed content escape the sandbox entirely. The risk is now explained properly and the fix steps recommend the restrictive setting first, adding permissions back only where genuinely needed.
- [Lock] **[FIXED]** **Session Cookie Checks No Longer Stop At The First Safe Cookie**
  The Django, Laravel, and Express cookie checks looked at the cookies in a response one at a time and stopped as soon as they found one that was configured correctly. On a Laravel site that sets a properly hardened CSRF cookie first, that meant a session cookie missing HttpOnly further down the list was never examined and the scan came back clean. Each cookie is now judged on its own, so a correctly configured cookie only clears itself.
- [Key] **[FIXED]** **Hardcoded API Key Check Now Scans The Whole Page**
  The check for API keys left in client-side JavaScript ignores keys that vendors publish in their own documentation, since those are inert examples. It was only looking at the first key-shaped value on the page, so a page that opened with one of those documented example keys was reported clean even when a real credential appeared further down the same file. It now checks every match on the page instead of stopping at the first one.
- [Search] **[FIXED]** **GraphQL Field Suggestions Are Detected Again**
  The check that spots GraphQL servers leaking field-name suggestions was only matching the message when it appeared as plain page text, not as it actually arrives inside a real JSON error response. That meant it quietly found nothing on the exact case it exists for. It now matches both forms, so a GraphQL endpoint handing attackers free schema hints gets reported.
- [ShieldAlert] **[FIXED]** **A Harmless First Match No Longer Hides A Real One**
  Four API checks looked at only the first thing they found on a page and then dismissed the whole page if that one match turned out to be innocent. A tutorial mention near the top of a page, an empty placeholder field, or a short throwaway URL parameter could therefore hide a genuine exposed XML-RPC endpoint, leaked stack trace, internal file path, or access token further down. Each check now weighs every occurrence on its own.
- [Gauge] **[CHANGED]** **More Honest Confidence On Two API Checks**
  The GraphQL batching and OpenAPI sensitive-defaults checks were labelled as plain response-body pattern matches even though they now also require the request URL or document type to line up. Their reported confidence and detection method were understating what they actually verify, so both now show the combined analysis they really perform.
- [FileText] **[CHANGED]** **Clearer Wording On GraphQL Introspection And Exposed Files**
  The GraphQL introspection finding claimed a full schema dump had been returned when the scan had only seen introspection keywords referenced by the endpoint. It now says what was actually observed and asks you to confirm the server resolves the query. Supply-chain findings about exposed lockfiles, Dockerfiles, and .env files also had their punctuation cleaned up to match the rest of the product.
- [ShieldAlert] **[FIXED]** **Mixed Content No Longer Hidden By A Code Sample**
  The mixed-content check skips resource tags that appear inside a code sample, since a documented example is not a real insecure load. It was matching the sample and the live tag to the same spot on the page, so a site that showed an example and then loaded that exact same resource insecurely further down was reported as clean. Each occurrence is now judged where it actually sits, so the real insecure load is reported and the code sample is still ignored.
- [Search] **[FIXED]** **Enumerable ID Check No Longer Stops At The First Match**
  The check that spots easily guessable record numbers in a URL only looked at the first number it found. If that one was too large to be worth guessing, it stopped there and never looked at the rest of the address, so a small, easily guessable order or invoice number later in the same URL was missed entirely. It now checks every candidate in the address instead of giving up after the first.
- [Zap] **[PERFORMANCE]** **Crawl Scans Stopped Repeating Themselves**
  A crawl used to re-run every host-level check on every single page it visited. Scanning 25 pages of one site meant more than a thousand duplicate DNS lookups, 25 identical TLS handshakes, and the same 23 sensitive file paths requested 25 times, all to produce copies of findings that were then thrown away as duplicates. Those checks now run once for the whole crawl, and pages are scanned a few at a time instead of strictly one after another, so a deep crawl finishes far sooner and is much less likely to look like an attack to the site being scanned.
- [ShieldCheck] **[SECURITY]** **Wider Internal IPv6 Address Blocking**
  The scanner refuses to connect to internal and private addresses. Three of the IPv6 rules were narrower than intended and only covered the first slice of the range they were meant to block, so some private and link-local addresses used by container and overlay networks were not caught. The full ranges are now blocked, and there are tests pinning each boundary.
- [Shield] **[SECURITY]** **Address Checks Now Verify The Protocol Too**
  The safety check that every part of the scanner uses before making a request looked at the address but never at the protocol, so a redirect could hand it something that was not a web address at all. Web addresses are now the only thing it will accept, and every redirect step is re-checked against the same rule as the original URL rather than only the first one.
- [Network] **[SECURITY]** **Subdomain Discovery Sources Are Guarded**
  Subdomain discovery pulls from nine free public services. Those requests used to follow redirects blindly and read whatever came back with no size limit, so an outage or hijack at one of those services could have redirected the scanner somewhere internal, or streamed a huge response into memory. Every one of those requests now re-checks each redirect against the same safety rules the rest of the scanner uses, and responses are capped.
- [Eye] **[SECURITY]** **Screenshots Refuse Redirected Pages**
  The optional page screenshot only checked the address you asked for. If the page then redirected the browser somewhere the scanner would never have been allowed to visit, the screenshot was still taken and saved. The capture is now discarded when the page navigates off the target to an address that fails the same safety check.
- [Gauge] **[PERFORMANCE]** **Faster Blocklist Checks On Bulk And Crawl Scans**
  Every scan asked the database twice whether the target was on the admin blocklist, and a bulk or crawl request repeated both questions for every single URL. A 250-page crawl of one site made 500 round trips to answer the same question. The answer is now remembered for a short window per host, so repeat checks are free while a newly added rule still takes effect within seconds.
- [Settings] **[FIXED]** **The Scheduled Scans Switch Now Actually Stops Them**
  Turning scheduled scans off in the admin settings only blocked new schedules from being created. Every schedule that already existed kept firing on its normal cadence, so an operator turning the feature off to shed load or to stop hitting a target saw no change. The background worker now checks the setting too and claims nothing while the feature is off.
- [Gauge] **[FIXED]** **Removed A Daily Scan Limit Setting That Did Nothing**
  Staff could set a per-account daily scan limit that was written down, recorded in the audit log as a real change, and then ignored by the part of the system that actually enforces limits. Worse, the AI assistant read that number and told users it was their limit, so people could be quoted a cap that was never applied. The setting is gone. Daily limits come from your plan, which is the number the scanner has always enforced.
- [Shield] **[SECURITY]** **Dropped A Duplicate Session Revoke Action**
  The admin API carried two ways to sign a user out of every device. Only one of them was reachable from the panel, and the other one skipped the password confirmation the panel requires, on top of not sending the user the notification email. The unreachable duplicate has been removed, so signing an account out always confirms the staff member's password and always tells the user it happened.
- [Timer] **[PERFORMANCE]** **Faster Team List In The Admin Panel**
  Opening or searching the admin Teams tab ran two database queries one after the other: counting every team, then fetching the page you asked for. They do not depend on each other, so they now run at the same time. Every other admin list already worked this way; Teams was the last one left, and it was the slowest to load because of it.
- [Layout] **[CHANGED]** **Admin Panel Now Lines Up With Every Other Page**
  The admin panel was 128 pixels wider than the rest of the signed-in app, so the content edge jumped sideways every time you entered or left it. It now uses the same page width as History, Assets, Repos, Teams, Shares and the dashboard.
- [Smartphone] **[FIXED]** **Billing Plan Table Scrolls Instead Of Squashing**
  The plan breakdown table in the admin Billing tab had no scroll container, so on a narrow window its five number columns compressed into each other rather than scrolling. It now scrolls sideways and keeps every column readable, matching every other table in the panel.
- [CheckCheck] **[FIXED]** **Badge Selection Is Now Announced To Screen Readers**
  In the admin user panel, staging a badge to be awarded or removed showed up only as a ring, a strike-through and a tooltip, none of which a screen reader reports. Each badge is now a proper toggle that announces whether it is queued. Saving a batch of badge changes also raises one summary message instead of one per badge.
- [Mail] **[CHANGED]** **Email Typography Matches The App Again**
  Headings in every email we send were set a full weight heavier than any heading in the product, and the monospace font used for one-time codes, detail values and fallback links was a different stack from the one in the email header, so a single message could render code in two different typefaces. All of it now comes from one definition and one weight scale.
- [FileText] **[FIXED]** **Corrected The Crawl Discovery Quota In The Docs**
  The rate limits page said previewing a crawl with the discovery endpoint cost one daily scan unit. It does not: discovery fetches and parses links, it never scans, and nothing in that endpoint touches your daily counter. The API reference already said so, so the two pages contradicted each other. Discovery is still frequency-limited, just not billed against your daily scans.
- [Share2] **[ADDED]** **Docs For Importing Scans Into DefectDojo And Faraday**
  VulnRadar has always exported SARIF, which both DefectDojo and Faraday read natively, but nothing said so. The reports documentation now shows the exact commands to pull a SARIF report and import it into either one, and explains that re-importing a later scan updates the existing findings instead of duplicating them.
- [Gauge] **[PERFORMANCE]** **Scans No Longer Freeze Each Other**
  The body and header checks used to run as one uninterrupted block, which on a large page meant more than a second where nothing else in the app could respond: other scans stalled, and progress bars stopped updating. The checks now hand control back as they go, so a big page being scanned no longer freezes everyone else's scan or the status you are watching. The scan itself takes the same amount of time.
- [Network] **[PERFORMANCE]** **Fewer Repeated DNS Lookups Per Scan**
  The email and DNS checks each looked up the same records independently, so a single scan asked for the same MX, TXT, NS and SOA records over and over, roughly a hundred queries where a fraction would do. They now share one lookup per record for the length of a scan. That is about 30 percent fewer DNS queries per scan, a lighter load on your resolver, and slightly faster DNS results.
- [Activity] **[CHANGED]** **Politer Exposed-File Probing**
  The check that looks for accidentally published files (.env, .git/config, backups and so on) fired all 23 requests at your site simultaneously. To a rate limiter or WAF that looks like an attack, and the blocks it triggered were indistinguishable from the files simply not being there. It now sends a handful at a time, which is both gentler on the target and more accurate.
- [Zap] **[FIXED]** **Fixed A Scan Stall On Pages With Long Dotted Text**
  The check that looks for exposed email addresses could get stuck on a page containing a long run of dots or dashes, taking over ten seconds on a modest page and far longer on a large one, with nothing able to interrupt it. The pattern it uses has been rewritten so the work grows in step with the page size instead of exploding. The same page now takes a few milliseconds.
- [Database] **[FIXED]** **Database Upgrades No Longer Skip Tables**
  The upgrade command could report success while leaving your database missing tables the app needs, because the upgrade steps and the schema the app builds at startup were maintained separately and had drifted apart twice. They are now compared automatically on every build, so a table added in one place and forgotten in the other fails the check instead of shipping. The upgrade also re-reads the schema afterwards and refuses to report success unless it matches.
- [Database] **[FIXED]** **Cloning A Database Now Copies Everything**
  Copying your data to a new database silently left behind 33 of the 63 tables, including admin settings, IP allow and deny rules, outbound webhooks, embedded badge tokens and every open support ticket, and it reported none of them as skipped. The copy is now worked out from what the two databases actually contain rather than from a fixed list, it copies tables in an order that respects their relationships, and anything deliberately skipped is named on screen with the reason. It also compares row counts afterwards and fails loudly if anything came up short.
- [Database] **[FIXED]** **Fresh Database Setup Was Missing A Sixth Of The Schema**
  Creating a new database from scratch built only 54 of the 65 tables. A pattern-matching bug made the setup script skip a large block of the schema file, so support tickets, custom domains, badge tokens, the credit ledgers and several other tables were never created. Setup now uses the same schema reader the rest of the tooling uses and creates the complete schema.
- [ShieldCheck] **[FIXED]** **Safer Sequence Repair During Upgrades**
  The upgrade's final housekeeping step could move a table's ID counter backwards when old rows had been deleted, which could hand out an ID that already belonged to someone else's record and could collide with a record being created at that exact moment. It now only ever moves a counter forward, and takes a lock while it works.
- [Mail] **[FIXED]** **GitHub Review Usage Tracking Fixed On Upgrade**
  Upgrading a database that still used the old monthly GitHub review counter gave every existing row the same timestamp, so rows for different months collided and the uniqueness rule could not be created. On the app's own startup path that failure was swallowed, leaving the table without the rule and every later usage write failing. Existing rows are now given a distinct timestamp derived from the month they belonged to.
- [Trash2] **[FIXED]** **Webhook Delivery Log Is Now Pruned**
  Every outbound webhook attempt writes a record, and a failing endpoint writes two per event, but nothing ever deleted them: it was the one log table the nightly cleanup did not touch, so it grew forever. Delivery records older than 30 days are now removed on the nightly pass.
- [Key] **[FIXED]** **Email 2FA Works On Google, GitHub And Discord Accounts**
  Turning email two-factor on or off asked for your account password even when your account had never had one, because you signed in with Google, GitHub or Discord. There was no password to type, so the feature dead-ended and those accounts could not use a second factor at all. Being signed in is now the proof of identity for accounts without a password, matching how the other two-factor screens already worked.
- [Users] **[FIXED]** **Turning Teams Off Now Actually Turns Teams Off**
  The Teams feature switch only blocked creating a new team. Viewing, renaming, deleting, inviting and every other team action kept working on a deployment where the operator had switched Teams off. All team endpoints now respect the switch, and the browser is told which features are enabled so disabled ones stop appearing in the interface.
- [Gauge] **[FIXED]** **API Rate-Limit Message Shows Your Real Limit**
  When an API key hit its daily cap, the error text always said "50 requests per 24 hours" no matter what the key's actual limit was. A Pro key cut off after 5,000 requests was told it allowed 50. The message now quotes the key's real limit and when it resets.
- [CheckCheck] **[FIXED]** **Bulk Remediation Changes Now Apply All Or Nothing**
  Marking many findings fixed at once fired one database write per finding with no transaction, so a failure part-way through left some findings changed while the error said nothing had been applied. Retrying then re-applied changes that had already taken. The whole selection is now applied in a single statement, so the all-or-nothing message is true, and selecting the same finding twice no longer causes an error.
- [ShieldAlert] **[SECURITY]** **Failed Scans No Longer Show Server Internals**
  When a scan failed for an internal reason, the raw error text from the server was stored and shown to you verbatim, next to a Copy button. That could include internal hostnames, private IP addresses, and database table names. Failed scans now show a plain explanation (target unreachable, target did not respond, timed out, or an internal error), while the full detail stays in the server logs where an operator can find it.
- [Zap] **[PERFORMANCE]** **Shares Page Loads Much Faster**
  The Shares page loaded the complete details of every finding in every scan you had ever shared, just to draw a safety badge and a count per row. On an account with a lot of shares that was tens of megabytes of data for a list of one-line rows. It now reads only the few fields the page actually shows.
- [Zap] **[PERFORMANCE]** **Smaller Avatar Downloads From GitHub And Discord**
  Profile pictures from Discord and GitHub sign-in were stored at full resolution, so a browser downloaded a large image to fill a fourteen-pixel circle on pages like Public Scans. Those URLs now ask the provider for a small image.
- [Timer] **[FIXED]** **Bulk And Authenticated Scans Respect Your Concurrent Scan Limit**
  Your plan's limit on how many scans can run at once was enforced for single scans and crawls, but not for bulk scans or authenticated scans: those two could run many at a time regardless of the cap, and an operator watching load saw nothing running. Both now take a slot like every other scan, and return a clear "you already have a scan running" response when you are at your limit.
- [Shield] **[SECURITY]** **Report Exports Are Rate Limited**
  Exporting a report as PDF, Markdown or a compliance document builds the whole document in one go on the server. Requests made through the website had no limit at all, so repeated exports of a very large scan could slow the whole service down for everyone. Exports from a signed-in session are now capped the same way API requests already were.
- [Lock] **[SECURITY]** **One Attacker Can No Longer Lock You Out Of Your Account**
  Failed sign-in attempts against an account shared the same small allowance as the per-address limit, so a single attacker had exactly enough attempts to lock any account they knew the email of, over and over, and the real owner was refused even with the correct password and a valid two-factor code. The per-account counter is now much larger, so filling it takes a genuinely distributed attack, and a successful sign-in clears it.
- [Zap] **[PERFORMANCE]** **Faster API Rejection Of Unknown Keys**
  An invalid or revoked API key fell through to a full scan of every older key record with an expensive password-style comparison per record, on the same thread that serves every other request. That check now runs only when older records actually exist, which on a normal install is never.
- [Mail] **[FIXED]** **Billing, Enterprise And Feedback Contact Messages Keep Their Category**
  The contact form offers nine categories, but three of them (Billing Issue, Enterprise and Feedback) were not recognised by the handler, so messages sent under any of those arrived in the support inbox labelled "Other" with your choice discarded. All nine categories now come through as sent.
- [Lock] **[SECURITY]** **Turning Two-Factor Off Now Clears Trusted Devices**
  Marking a browser as trusted lets it skip the second factor. Those marks survived turning two-factor authentication off, so turning it back on later silently re-trusted every browser from before, including one an attacker may have added. Disabling either kind of two-factor now clears the trusted-device list, the same way a password change already did.
- [ShieldCheck] **[SECURITY]** **Changing Your Email Signs Out Your Other Sessions**
  Changing your account password already signed out every other session and cleared trusted devices. Changing your email address, which is just as much of a takeover step, did neither. It now does the same thing, and you stay signed in where you made the change.
- [Users] **[FIXED]** **Staff Accounts Keep Their Plan After A Subscription Ends**
  When a paid subscription was cancelled or lapsed, the account dropped back to a plan floor worked out from a hardcoded list of three staff roles. Four other staff roles were missing from that list and dropped to Free, and super admins lost the higher tier their role grants. The floor is now taken from the same place the rest of the app reads it.
- [Sparkles] **[FIXED]** **A Lapsed Subscription No Longer Removes A Gifted Premium Badge**
  The premium badge can come from a paid subscription or from an admin gift. When a subscription ended, the badge was removed unconditionally, taking it away from people whose gift was still active. It is now kept when a live gift still entitles you to it.
- [Timer] **[FIXED]** **Scheduled-Scan Plan Limit Can No Longer Be Exceeded By Racing**
  Creating a scheduled scan counted your existing ones and then inserted the new row as two separate steps, so two requests sent at the same time could both pass the check and put the account over its plan's limit. The limit is now enforced by the insert itself.
- [Shield] **[SECURITY]** **Stripe Setup Endpoints Follow The Normal Admin Rules**
  The two Stripe setup endpoints did their own admin check instead of the shared one. That skipped the staff two-factor requirement, so an admin without two-factor who is refused everywhere else could still write to the live Stripe catalog, and it also locked out super admins. Both now use the standard admin check.
- [Eye] **[SECURITY]** **Public Scan Reports Are Rate Limited**
  The public per-host report endpoint had no limit at all, so the whole public scan corpus could be walked at any speed. It now uses the same cap as the Public Scans directory. Badge images are deliberately left uncapped so README badges keep working.
- [Eye] **[SECURITY]** **Scan Screenshots Can No Longer Be Enumerated**
  A public scan's screenshot is meant to be viewable by anyone, but it also answered to the old sequential scan number, so someone with no account could walk the numbers and collect every public screenshot. Anonymous requests now have to use the non-guessable scan link; signed-in users' older links still work.
- [Zap] **[PERFORMANCE]** **Data Export No Longer Starves The Rest Of The App**
  Requesting a copy of your data fired twenty-five database queries at once against a pool that holds ten connections, so a single export queued on itself and blocked every other request in the process, including sign-ins and running scans. The export now runs its queries in small batches.
- [Zap] **[PERFORMANCE]** **Faster Account Load And Lighter Weekly Digest**
  The account endpoint the app calls on every page load was reading the same account row three separate times to work out your plan. It now works it out from data it had already fetched. The weekly posture digest was also loading every finding's full text for every site you have ever scanned, twice per digest; it now reads only the few fields it prints.
- [Activity] **[PERFORMANCE]** **Notification Page Filters Can No Longer Freeze A Tab**
  Admin-set page filters on notifications were turned into a pattern that runs in every visitor's browser on every page change, and certain filter text could make that matching take exponentially long. The matching is now a simple left-to-right walk that always finishes quickly.
- [Smartphone] **[FIXED]** **Screen Readers No Longer Read Past A Dialog**
  Hand-built dialogs said they covered the page behind them but never actually hid it from assistive technology, so a screen reader could read straight through into the page the dialog was supposed to block. The rest of the page is now properly hidden and inert while a dialog is open.
- [Container] **[FIXED]** **Demo Scans Stop Their Own Background Work**
  A demo scan that hit its fifteen-second cutoff returned a result but left the remaining checks running against the target with nothing tracking them, and left a timer running even when the checks finished first. Both are now cleaned up when the scan returns.
- [CheckCheck] **[CHANGED]** **Test Coverage Is Actually Enforced Now**
  The project documented a coverage rule that nothing checked: the automated build ran the test suite without measuring coverage, so the per-file minimums could quietly drop to zero between releases and nobody would hear about it. Coverage now runs on every change and a drop fails the build. The stale minimums that had been sitting red for months were corrected to their real values at the same time.
- [Shield] **[CHANGED]** **Static Checks For The Self-Host Scripts**
  The database migration, backup and repair scripts, plus the command-line tool, were excluded from every automated code check in the project. That is the code with the most at stake if it breaks, because it runs against a live database. They are checked now, which already turned up a migration script importing a file that does not exist.
- [Timer] **[CHANGED]** **Scan Speed Guardrails In The Test Suite**
  Nothing in the test suite measured how long a security check takes or how much page content it will accept, so a check that slows down catastrophically on a large or hostile page could ship unnoticed. There is now a time budget every check has to stay inside, and a matching guard on robots.txt rule matching, so this class of slowdown fails the build instead of stalling a scan.
- [Timer] **[PERFORMANCE]** **Finished Scans Appear Sooner**
  The scanner checked on a running scan at a fixed two-second beat, so a scan that finished just after one of those checks sat there looking busy until the next one came round. It now checks more often in the first couple of seconds and again once the last group of checks is running, which is when the result actually lands. A scan that is done reads as done within a fraction of a second.
- [RefreshCw] **[FIXED]** **Try Again Now Actually Retries**
  When a scan failed, the button labelled Try again just cleared the form: you had to retype the URL and re-pick every option to retry something that had failed on a timeout. It now runs the same scan again with the same settings, and Back to scanner beside it is what returns you to an empty form.
- [Activity] **[FIXED]** **Back Button No Longer Wipes A Finished Scan**
  Every option you toggled on the scan form added its own entry to the browser's back history, and finishing a scan added another. Pressing Back after a scan threw the results away, and Forward reloaded the whole page. Configuring and running a scan is now a single history entry, so Back leaves the page instead of dismantling your result.
- [Eye] **[FIXED]** **A Failed Load No Longer Looks Like An Empty Result**
  On a security tool, a blank list reads as "you have nothing to worry about", which is the wrong answer when the truth is "we could not load it". The host risk-score chart and the repositories page now tell you when data failed to load, keep that message on screen instead of hiding it after eight seconds, and give you a way to retry.
- [Smartphone] **[FIXED]** **Bigger Tap Targets Across The App**
  A lot of small icon buttons were 28 to 32 pixels across, well under the size a finger can reliably hit. Page navigation arrows, the webhook and domain row actions, the docs and legal contents links, and the findings filters are all 44 pixels on a phone now and unchanged on a desktop. The severity filter on a scan result also stops starting off scrolled sideways on a narrow screen.
- [Eye] **[FIXED]** **Screen Reader And Keyboard Improvements**
  The current page in the navigation was marked with colour alone, the AI assistant never announced its replies, code-example switchers claimed to be tabs without behaving like them, and the host risk chart had no readable alternative for its data. All of those now carry the right roles, labels and text alternatives, and the docs code tabs can be moved through with the arrow keys.
- [Palette] **[FIXED]** **Input Outlines You Can Actually See**
  Text fields, dropdowns and switches drew their outline in almost exactly the shade of the surface behind them, which left the edge of a field hard to make out in both light and dark mode. Those outlines are now dark enough (or light enough) to clear the accessibility minimum, while section dividers stay as subtle as before.
- [FileText] **[FIXED]** **CSV Exports Open Correctly In Excel**
  Exporting findings as CSV and opening the file in Excel on Windows turned every accented character, arrow and quote mark into garbled text, because the file carried no encoding marker. It does now, and every other spreadsheet tool ignores it. The compliance export also says in the menu that it downloads as Markdown, rather than implying a formatted report.
- [Gauge] **[PERFORMANCE]** **Lighter Pages**
  Two fonts were being downloaded on every page and applied to nothing, and the charting library was loaded up front on public host reports for a chart that often does not render. Both are gone from the initial page load, which trims a stylesheet, several font files and roughly a quarter of that page's JavaScript. The terms-of-service check also stopped making its own duplicate account request on every page.
- [List] **[FIXED]** **Changelog Loads Without Infinite Scroll**
  The changelog only ever loaded older releases when a marker scrolled into view, so in a browser where that did not fire it sat on "Loading more releases..." forever with no way past it. There is now a Load more button and a count of how many releases you are seeing.
- [ShieldAlert] **[FIXED]** **More Pages Fail Gracefully**
  Repositories, attack surface, public scans, contact, checkout and the badge builder had no error handling of their own, so an unexpected failure in one panel replaced the entire site with a full-page error. Each now shows a contained message with a reference code and a retry, and checkout shows its layout while it loads.
- [Users] **[FIXED]** **Disconnecting An Account Confirms Itself**
  Disconnecting Google, GitHub or Discord from your profile reloaded the whole page the instant it succeeded, which destroyed the confirmation message it had just shown. The card now updates in place and the confirmation stays put, and a failed Discord disconnect explains the actual reason instead of a generic "try again".
- [Search] **[FIXED]** **Documentation Sidebar Highlights Sub-Pages**
  A documentation page nested under another one, such as the API playground, lit up no entry in the sidebar at all, which read as having navigated out of the docs. The parent entry stays highlighted now.
- [Smartphone] **[FIXED]** **Installed App Opens On The Right Page**
  Installing VulnRadar as an app started it on the dashboard, so launching it while signed out bounced straight to a login screen. It starts at the home page now, which sends you to the dashboard when you are signed in and to the landing page when you are not. The app icon's declared size was also wrong and is now correct.
- [Palette] **[FIXED]** **Readable Code Blocks In The AI Assistant**
  Code the assistant sent back was drawn on a fixed dark panel regardless of theme, which on the light theme was a mid-grey slab with low-contrast text on it. Code blocks and inline code now follow the theme like everything else.
- [Network] **[FIXED]** **Navigation Reflects Where You Are**
  The Attack Surface page lit up no navigation item, so a top-level destination read as being outside the app. It now highlights History, the section it is reached from, the same way Public Scans and Assets already did.
- [Globe] **[CHANGED]** **Pricing Page Publishes Its Plans To Search Engines**
  The structured data behind the pricing page could carry plan prices and never did, so search results had nothing to show beyond a plain link. The prices it publishes now come from the same catalogue the page itself renders, so the two cannot disagree, and nothing is published at all when billing is turned off.
- [Bug] **[FIXED]** **A Server Error No Longer Reads As "Access Denied"**
  When the admin data request failed for any reason other than a real permissions check, the panel showed "Access Denied: you do not have administrator privileges". During an outage that sent operators off to check roles and 2FA instead of the actual fault. It now shows a distinct error screen with the status code and a Retry button.
- [Zap] **[PERFORMANCE]** **Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans**
  The dashboard was running seven separate whole-history queries on every load, one of which expanded the findings of every scan you had ever run. It now runs fewer, tighter queries, so the page loads faster and stops crowding out other requests. "Most common findings" also now ranks the latest scan of each site instead of every scan ever, so rescanning one site fifty times no longer pushes its issues to the top of the list.
- [Bell] **[FIXED]** **A Missing Stripe Webhook Secret Is Reported As A Misconfiguration**
  If the Stripe webhook secret was not configured, every incoming payment event was rejected as "Invalid signature" with no way to tell a setup mistake from an attack, and Stripe stopped retrying. It is now reported as a configuration problem with an admin alert, and Stripe keeps retrying so nothing is lost once the secret is set.
- [Zap] **[PERFORMANCE]** **AI Assistant Context Loads Without Re-Reading Megabytes Per Request**
  Every AI assistant slash command re-read its reference file from disk, up to about a megabyte each time, which briefly stalled the whole server. Those files only change when a new version is deployed, so they are now read once and kept in memory. The account-related commands also stopped looking up your session twice.
- [Activity] **[ADDED]** **Admin Panel Opens On A Health Check**
  The admin panel used to land on the user directory behind ten counters (total users, total scans, 2FA enabled) that can never indicate a fault, so answering "is anything wrong right now" meant clicking through six separate tabs. There is now an Overview section that opens first and lists the things that can actually go wrong: scanner backlog, failed scans in the last day, how old the newest backup is against your configured backup interval, errors logged in the last hour, failed emails, unresolved security alerts, tickets waiting on staff, and staff invites that expired unaccepted. Anything amber or red sorts to the top and links straight to the tab that owns it, and a coloured dot on the Overview nav item shows a fault from whichever tab you are on.
- [Lock] **[SECURITY]** **Moderators Can No Longer Change A User's Email**
  Changing an account's email address redirects every future password reset to the new address, which makes it an account takeover in one step. Moderators were never meant to have it (the admin panel already hid the control from them) but a direct API call still went through. Changing a user's email is now admin-only, matching what the permission model always said.
- [Mail] **[FIXED]** **No More Duplicate Broadcast Emails**
  Sending a broadcast checked who had already received it, then sent, then recorded the delivery, with the whole email round trip sitting between the check and the record. Two sends running at once, or a double-clicked send button, could both pass the check and mail the same person twice. Each recipient is now claimed atomically before the email goes out, and a send that fails is released so a resend still retries it.
- [Key] **[FIXED]** **Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions**
  Sensitive admin actions ask you to re-enter your password first. An account created through Google, GitHub or Discord has no password at all, so that prompt could never be satisfied and every gated action failed with "Password is incorrect". Those accounts now pass the confirmation on their signed-in session, the same rule the rest of the app already used for account deletion and 2FA changes.
- [Zap] **[PERFORMANCE]** **Documentation Pages Load A Lot Less JavaScript**
  Every page under /docs was shipping its full text to the browser twice, once as the page you read and again as JavaScript, purely so the table of contents could highlight the section you are on. The pages are now rendered on the server and only the highlighting itself runs in the browser. The configuration reference also stopped sending the entire settings registry to every reader.
- [Lock] **[SECURITY]** **Sign-In Sessions Hashed At Rest**
  Your sign-in session was stored in the database as the exact value held in your browser cookie, so anyone who could read the database (a leaked backup, a stray copy) had a ready-to-use key to every signed-in account. Sessions are now stored as a one-way fingerprint instead, matching how every other token in the product is already kept. You will be asked to sign in once after this update, and everything you were signed into before stays where it was.
- [Key] **[SECURITY]** **API Key Creation Is Rate Limited**
  Creating an API key was the one credential-issuing action with no limit at all, and an API key keeps working after you sign out everywhere or change your password. Key creation is now capped the same way sign-in attempts are, so a briefly stolen session cannot be turned into a pile of long-lived keys.
- [ShieldCheck] **[SECURITY]** **Stronger Reset And Verification Links**
  Password-reset and email-verification links are now stored using a server-keyed fingerprint rather than a plain one. Links already sitting in your inbox keep working, and nothing about how you use them changes.
- [Key] **[ADDED]** **Encryption Key Rotation Is Now Possible**
  Self-hosters could not change the encryption key that protects two-factor secrets, connected-account tokens and API keys without making every stored value unreadable. Setting the old key alongside the new one now keeps everything readable while new writes move to the new key, so a key can actually be rotated.
- [Users] **[SECURITY]** **Team Invite Accepts Are Rate Limited**
  Sending a team invite was capped but accepting one was not, which let someone probe for which invites existed. Accepting is now limited per account, and a legitimate invite is unaffected.
- [Lock] **[SECURITY]** **Staff SSO Trusts The Issuer You Configured**
  Staff single sign-on checked an identity provider's login token against whatever issuer that provider's own configuration document claimed, rather than against the issuer an administrator actually set. It now requires the two to match before any of the provider's endpoints are used.
- [Container] **[FIXED]** **In-App Updater Hidden In Docker**
  Running in a container, the admin panel offered an Update button that could never work: it half-copies files into a directory it cannot write, and anything it did manage to change is thrown away on the next image pull. The updater now recognises a container and points you at pulling a new image instead.
- [Gauge] **[PERFORMANCE]** **Faster Scan Authorization And Bulk Scans**
  The check that decides whether you own a domain scanned every verified domain in the database on every active-probe and port-scan request. It now looks the domain up directly. Bulk scans also stopped re-asking for your plan's daily limit and re-checking the blocklist once per URL, cutting hundreds of database round trips out of a large batch.
- [Gauge] **[PERFORMANCE]** **Lighter Public Host And Export Pages**
  The risk-score chart on a public host report was loading every full finding for thirty scans just to compute a number, and the data export pulled every scan you have ever run into memory at once. Both now read only what they actually need, so the pages respond faster and a very large account can no longer exhaust the server on export.
- [Network] **[ADDED]** **Rotate A Webhook Signing Secret**
  A webhook's signing secret was shown once at creation and could never be changed, so a leaked secret meant deleting the webhook and re-creating it with a new address. You can now issue a fresh secret in place, keeping the same webhook.
- [Activity] **[ADDED]** **See Why A Webhook Failed**
  Every webhook delivery attempt has been recorded all along, but nothing ever showed it to you. The delivery log for a webhook, including the status it returned and any error, is now available.
- [Key] **[FIXED]** **Reset An API Key's Pinned Network**
  With IP binding turned on, a key pinned itself to the first network it was used from and then quietly returned errors from anywhere else, with the pinned address never shown and no way to clear it. The address is now visible on the key and can be reset without issuing a new key.
- [Users] **[FIXED]** **Domains Can Be Shared With A Team**
  Team-shared domains were documented and read everywhere in the product, but nothing could ever actually assign a domain to a team, so the feature could not happen. A verified domain's owner can now assign it to a team they can write into, or move it back to personal.
- [List] **[FIXED]** **Truncated Lists Now Say So**
  Your support history, remediation state and a teammate's scan list each stopped at a fixed number of rows with no indication, and the teammate panel reported that cut-off count as the true total. These now report the real total and the cap that was applied.
- [FileText] **[CHANGED]** **Honest Plan Descriptions**
  The plan cards described tiers as "for power users" and "maximum power" without saying what changes when you pay, and told buyers at checkout they were getting 30 or 90 days of scan history when every plan, free included, keeps everything forever. The descriptions now say what each tier lets you do, and retention is stated in one place from the real setting.
- [Search] **[CHANGED]** **Cleaner Comparison Pages**
  One of the five competitor comparison pages had nothing real in it: three of its five rows said "varies by product" and its summary described the category rather than the product. It has been removed, leaving four pages that make an actual comparison.
- [Bell] **[FIXED]** **Admin Alert Delivery Is Reportable**
  The operator alert webhook silently did nothing when the URL was wrong, missing, or blocked, and the only trace was a log line. It now reports what happened to each delivery, including the status the endpoint returned, so a test send can tell you whether it actually worked.
- [Bug] **[FIXED]** **Rate Limit Messages Read Properly**
  If you hit the rate limit on a password reset or a signup, the message told you there had been "too many reset attempts attempts". The shared helper was tacking the word "attempts" onto a phrase that already ended with it. The wording is fixed, and the same helper now works for the limits that are not attempts at anything, like AI requests and tag changes.
- [ShieldCheck] **[SECURITY]** **Dependency Updates Wait For The Test Suite**
  Automatic dependency updates used to merge the moment they opened, before lint, typecheck, tests or the build had finished, because the merge waited on a branch protection rule that was never configured. They now wait for every check on the pull request to report green and refuse to merge if any of them failed. A bad or malicious patch release can no longer reach a build without the suite having run.
- [Timer] **[FIXED]** **Scans No Longer Falsely Reported As Interrupted**
  A safety net that cleans up scans abandoned by a crashed server was clearing every in-progress scan whenever the app started, not just the abandoned ones. On a deployment where a new server starts while the old one is still finishing work, your running scan could be marked 'interrupted by a server restart' even though it completed, and its results were then thrown away. The cleanup now only touches scans that have been sitting far longer than the configured time limit allows.
- [Search] **[FIXED]** **Scan Comparison Opens The Scans You Picked**
  Comparing two scans could quietly load the wrong one. The compare view was looking scans up by an internal database number while the rest of the app had moved to opaque scan IDs, so a link could resolve to a different scan of yours, or fail outright. Compare now accepts the same IDs everything else uses, including older bookmarked links.
- [Key] **[FIXED]** **Two-Factor Start Over Now Works**
  Cancelling a two-factor prompt that arrived from a Discord or Google sign-in used to leave you stuck on the code form. The page never went back to the sign-in step, so every code you entered was submitted with no account attached and failed, and the only way out was a full page reload. Start over now returns you to a clean sign-in screen.
- [Bug] **[FIXED]** **Bulk Scan No Longer Reports False Limit Errors**
  Starting a bulk scan queued the first URL and then usually reported the rest as skipped because you had hit your scan limit. What actually happened is that every plan caps how many scans run at once, so the remaining URLs were refused for a second or two while the first one finished. Bulk scanning now waits for a free slot and only mentions your daily limit when that is genuinely what was reached.
- [Share2] **[ADDED]** **Shared Scans And Check Pages Get Their Own Link Previews**
  Pasting a shared report, a host report or a check page into Slack, Discord or a ticket used to show the same generic marketing image for a made-up domain, whatever you had actually shared. Each of those now unfurls with its own card: the real hostname and severity breakdown for a scan or host report, and the check name, severity and category for a check page. The title and description match too.
- [Palette] **[CHANGED]** **Consistent Page Titles And A Tidier Checkout**
  Page titles came in seven different sizes depending on which page you were on, so nothing told you what a page title looked like. There are now two sizes, one for public pages and one for the pages you work in, applied everywhere. The checkout pages got the biggest cleanup: they were the only screens in the product using a narrower layout, tighter spacing and heavier headings, on the one screen where you hand over a card.
- [ShieldAlert] **[FIXED]** **The Crash Page Looks Like The Product Again**
  The page shown when the app fails at the deepest level was a different design from the other error pages: a different colour scheme, no logo, no error id to quote to support, and no light mode at all. It now matches the 404 and 500 pages, shows a copyable error id, and renders correctly in both light and dark.
- [Layout] **[FIXED]** **Sign In And Sign Up Paint Something On First Load**
  The sign-in, sign-up and password-reset screens rendered as an empty page for the moment before the form appeared, which on a slow phone connection looked like a broken site. They now paint the real page frame with a placeholder form straight away.
- [Users] **[FIXED]** **Team Pages Are Linkable And Back Works**
  Opening a team did not change the address bar, so you could not send a colleague a link to a specific team and pressing Back left the teams area entirely instead of returning to the team list. The open team is now part of the URL: it can be linked, bookmarked, and Back returns to the list.
- [Search] **[FIXED]** **Check Counts Now Agree Across Pages**
  The homepage advertised one number of checks and the checks index advertised a smaller one, with nothing explaining the difference. Both numbers were true: some detectors only fire across several pages at once and so have no standalone page. The checks index now states both numbers and says why they differ.
- [Globe] **[CHANGED]** **Homepage Redirect Made Permanent**
  Visiting the site root sent you on with a temporary redirect, which tells search engines to keep treating the root and the landing page as two separate competing URLs. It is now a permanent redirect, and the fallback canonical link that pointed at the redirecting URL points at the page that actually renders.
- [ScanSearch] **[FIXED]** **Scan This Host Now Scans That Host**
  On a host report for a site that had never been scanned, the button reading "Scan example.com now" opened the demo scanner, which ignored the host entirely and scanned this site instead. The button now hands the demo scanner the host you were looking at and starts that scan.
- [Mail] **[FIXED]** **Resend Verification Email Now Works**
  On the login screen, the "send the verification email again" button did nothing at all: no email confirmation, no error, no visible response. It was checking the server's reply for a field the server never sends, so neither the success nor the failure path ever ran. It now sends the email and tells you it did.
- [Smartphone] **[FIXED]** **Chat Button No Longer Covers Save Changes**
  The floating AI assistant button sat in the bottom-right corner of every page, which on a phone put it directly on top of the Save Changes button on your profile, and over the bottom-right of the pricing, checkout, contact and legal forms. It now measures what is under it and steps above any bar pinned to the bottom of the screen, including the cookie notice.
- [Filter] **[FIXED]** **Scan Filters Survive The Back Button**
  On a scan report, narrowing to Critical and High, opening a finding and pressing Back used to drop every filter while keeping your scroll position, so you landed at a random point in the full list. On a large crawl that happened on every finding you opened. Filters, search, sort and grouping now live in the URL: Back restores them, and a filtered view is a link you can share or bookmark.
- [Users] **[ADDED]** **Share A Scan With Your Team**
  Scans could be assigned to a team in the database and the API accepted it, but nothing in the app ever offered it, so the feature was unreachable. The scan actions menu now lists the teams you can hand a scan to, and lets you take it back again. Only the scan's owner sees it, and only teams where you can manage scans are offered.
- [List] **[CHANGED]** **Developer Tools Back In The Top Nav**
  Scheduled scans, webhooks and API keys were three navigations deep, behind a tab called Developer inside a page called Account Settings. A Developer entry is back in the main nav, so recurring monitoring is one click away. Badge moved out to make room: it is a snippet you generate once, and it is still in the footer and on its own page.
- [Search] **[CHANGED]** **The Landing Page Links To The Check Reference**
  The category table on the front page described roughly 750 individual check pages and linked to none of them. Every category row is now a link into that reference, with a "see all checks" link beside the count. The footer also gained entries for the public scan directory, the scanner comparisons, the free tools and the security page, which a logged-out visitor previously had no way to reach.
- [Smartphone] **[FIXED]** **Scanning Screen Readable On A Phone**
  While a scan ran, the per-family checklist showed sentences up to 55 characters wide in a single narrow column, so on a phone they were cut off and you could not read what was currently running. The checklist now uses short category names that always fit, and the full sentence gets a row of its own. The progress bar also respects the reduce-motion setting, which it previously ignored.
- [Gauge] **[PERFORMANCE]** **Half The Notification Requests, Gone**
  The notification bell and the site-notice banner each fetched the same list of active notifications with the same parameters on every page load, including for signed-out visitors on the marketing pages. They now share one request. The bell's periodic refresh still refreshes for real.
- [Palette] **[CHANGED]** **One Look Across The App**
  The scan report, history, assets, shares and teams screens drew their panels with a 6px corner radius while profile and billing used 12px, so moving between them crossed a visible seam. Panels now share one radius. Empty states, the stat strips at the top of list pages, and the coloured asides in the docs and legal pages were also four to six separate implementations each and are now one component apiece, so a copy or accessibility fix lands everywhere at once.
- [Palette] **[CHANGED]** **Status Colours Follow Your Theme**
  A handful of lookup tables painted status with fixed colours that did not change between light and dark mode, and one of them was a second, separate severity scale that could drift from the real one. The badge page, the team role badges and the stat icons now read from the same theme tokens as everything else, so they stay legible in both themes.
- [Layout] **[CHANGED]** **The Social Tab Looks Like The Rest Of The App**
  The Discord and GitHub cards on your profile opened with full-width vendor gradients and white text, and the connection confirmation pop-ups added floating decorative circles, making the least important part of the page the loudest. Both now use the same card header as everything else, with the vendor colour kept as a single accent.
- [FileText] **[CHANGED]** **Clearer API Reference Parameters**
  Endpoint parameters in the API reference were rendered as loose rows that left out each parameter's default value, while a proper parameter table existed in the code and was never used. The reference now shows parameter, type, whether it is required, its default and its description, in a real table.
- [Wrench] **[FIXED]** **Scan Tags No Longer Silently Shortened**
  The tag box accepted up to 50 characters and told you so, while the server quietly trimmed anything over 30, so a long tag came back as a different word than you typed. The box now stops at the length that will actually be saved and says so if you paste something longer.
- [Settings] **[CHANGED]** **One Home For Verified Domains**
  Verified domains moved to the Attack Surface page a while back, but a Domains tab was still listed under Profile that only showed a "this moved" message. That tab is gone. An old link or bookmark to it still lands on the pointer, so nobody ends up somewhere unexpected.
- [Palette] **[CHANGED]** **Honest Pricing Page**
  The highlighted plan floated above its neighbours with a coloured glow, the one lifted-and-shadowed card in the whole product and the most recognisable marketing-template gesture there is. It now stands out with its border and its badge alone. The generic "Get Started" buttons on the nav and pricing cards now say what actually happens when you press them.
- [Database] **[FIXED]** **Database Restores Now Tell You The Truth**
  The restore command used to report success even when every single statement in the backup failed, so rehearsing a recovery proved nothing and a real recovery could leave you with an empty database you believed was full. It now stops on the first error, rolls the whole restore back so you are never left half restored, refuses to run against a database that still has tables unless you pass --force, and finishes by printing the row counts of your core tables as proof.
- [Lock] **[SECURITY]** **Encrypted Backups Are Verified Before They Are Applied**
  Restoring an encrypted backup used to feed the decrypted dump into the database as it decrypted, and only checked that the file had not been tampered with or corrupted at the very end. A damaged backup was therefore partly applied before the error appeared. The restore now decrypts and verifies the entire file first, so a bad backup is refused outright and your database is left untouched.
- [Sparkles] **[FIXED]** **The AI Assistant No Longer Loses Half A Sentence**
  The assistant answers from a compiled copy of the documentation, and twenty of the most important warning notes in those docs were being cut off mid sentence before they reached it, so it either guessed the missing half or dropped the caveat. The full text now reaches it, stray formatting characters are cleaned out, and the API playground page is included for the first time.
- [Palette] **[CHANGED]** **Social Card Follows Your Own Branding**
  The image that appears when a link to your instance is shared on Slack, Discord, X or LinkedIn had the VulnRadar name and domain baked into the picture, so a self hosted or renamed instance advertised someone else's brand. The card is now generated from your configured app name and URL, so rebuilding it picks up your branding automatically.
- [Timer] **[PERFORMANCE]** **Scans No Longer Stall On Malformed Pages**
  A page with a lot of unclosed HTML tags, or one that repeated a SQL keyword over and over, could make individual checks take minutes instead of milliseconds. On a large page that meant a scan appeared to hang, and it tied up the scan worker for everyone else in the queue. Around forty checks were rewritten to read a tag once and then look at that tag's own attributes, so their cost now grows in step with the page size instead of exploding. The slowest measured case went from over three minutes to under a fifth of a second.
- [ShieldCheck] **[SECURITY]** **Hardened Against Slow-Scan Denial Of Service**
  Because the page being scanned is controlled by whoever owns it, the slow-page problem above was something a site could trigger on purpose to tie up scanning capacity, including through the signed-out demo scan. Every affected pattern has been fixed, and a new test now measures every check against the exact page shapes that caused it, so a future change cannot quietly reintroduce it.
- [Bug] **[FIXED]** **More Accurate Tag Matching In Page Checks**
  Several checks that look for an HTML tag carrying a particular attribute could, on pages with unclosed tags, pair one tag with an attribute belonging to a completely different element further down the page. That produced findings for things that were not actually on the page. Checks now read each tag on its own, so an attribute only counts when it really belongs to the tag being reported.
- [Users] **[FIXED]** **Scheduled And Crawl Scans Reach Your Team**
  A scheduled scan created for a team, and every page a crawl discovered, were being saved without their team assignment. The scan ran and the result was stored, but only the person who set it up could see it: teammates opened the history and the run was simply not there, and on a crawl the team could open the crawl itself but none of the pages it covered. Both now carry the team the scan belongs to, so scheduled runs and crawl pages show up in team history like every manual scan does.
- [Gauge] **[PERFORMANCE]** **Faster Scan Progress And Crawl Saves**
  Scan progress used to write to the database twice for every category, about forty writes on a normal scan and forty per page on a crawl, all against the largest table in the system. Progress is now batched into a single write at most twice a second, and a crawl saves all of its discovered pages in one operation instead of one at a time. Long crawls finish noticeably sooner at the end, and the rest of the app stays quicker while a scan is running.
- [Database] **[PERFORMANCE]** **Nightly Cleanup No Longer Locks The Database**
  The nightly retention pass ran about thirty deletions inside one long database transaction, which held a connection and locked every affected row for the whole run and could make unrelated requests wait. It also meant one failure at the end undid twenty-nine unrelated cleanups that had already worked. Each cleanup now commits on its own, so locks are held for seconds rather than the whole pass and a single failure no longer throws away the rest.
- [Activity] **[FIXED]** **Health Check Now Catches A Half-Built Database**
  The health endpoint only checked eight of the tables the app needs, and the login session table was not one of them. A deployment whose database came up incomplete could report itself healthy while nobody could sign in, rate limiting was off, or Stripe events were being processed twice. Seven more load-bearing tables are now checked, so a monitor watching the health endpoint sees the problem instead of staying green through it.
- [Users] **[FIXED]** **Staff Invite Links Now Open A Real Page**
  Inviting someone to a staff role sent them an email whose link went to a page that did not exist, so no invite could ever be accepted and roles had to be set by hand instead. The link now opens a proper acceptance screen that shows who was invited and which role, and either adds the role to an existing account or creates the account with a password there and then.
- [Palette] **[FIXED]** **Role Badges Missing Their Colour**
  Super Admin, Security Analyst and Content Manager badges were rendering with no background, no text colour and no border wherever a role is shown, because those three colours were being dropped from the stylesheet at build time. Every role badge now carries the colour it is supposed to, so roles are again distinguishable at a glance in the users list, the staff panel and team member lists.
- [Container] **[SECURITY]** **Leaner Published Container Image**
  The Docker image shipped its entire build toolchain into the running container: a TypeScript compiler, ESLint and its plugins, Prettier and a CSS bundler's native binaries, roughly 89 MB of software that the app never loads but that sits inside a service exposed to the internet. The build now drops all of it before the final image is assembled. Self-hosters get a smaller pull and a noticeably smaller attack surface, with no change to how the container runs.
- [Mail] **[FIXED]** **Contact Email Template Said The Wrong Thing**
  The example environment file described CONTACT_EMAIL as the address contact-form submissions are delivered to. It never was: the contact route sends to SMTP_FROM, then SMTP_USER, then the noreply address in the admin panel, and CONTACT_EMAIL was read by nothing. A self-hoster who set only that value had their contact mail quietly go somewhere they had not chosen. The template now says where the mail actually goes and which value to set instead, and the AUTH_SECRET section explains the length requirement and why sharing the fallback key means rotating one secret invalidates sign-ins signed with the other.
- [CheckCheck] **[FIXED]** **Bulk Triage No Longer Loses Your Selection**
  While picking findings to update in bulk, tapping a row opened that finding instead of ticking it, and opening a finding threw the whole selection away. Rows now toggle their tick while you are selecting, and Done takes you back to opening findings. A long triage session no longer starts over because of one mis-tap.
- [Filter] **[FIXED]** **Bulk Actions Only Touch Findings You Can See**
  Findings you had selected stayed selected after you narrowed the severity or category filter, so the toolbar counted rows that were no longer on screen and Apply changed them. The count now always matches what is in front of you, and applying a status only ever writes to those findings. Widening the filter again brings your earlier picks back.
- [List] **[CHANGED]** **History Header Stopped Repeating Itself**
  The history page opened by stating the number of scans in its heading and then again in the stat strip immediately below, and when the list was capped the two numbers disagreed with each other. That cell now shows how many distinct hosts you have scanned, which is a number the page did not tell you anywhere else.
- [Palette] **[FIXED]** **Consistent Stat Strips Across The App**
  The admin panel drew its count strips from its own copy of the colour table, which had drifted from the one the rest of the app uses, so the same colour name meant two different colours on two pages. There is one table now. The admin loading placeholder also matched an older layout, which made every panel visibly jump as its counts arrived.
- [Layout] **[FIXED]** **Checkout No Longer Jumps As It Loads**
  The checkout loading placeholder was still drawn at the old page width and top spacing, so the page shifted sideways and upward the moment it finished loading. It now matches the checkout layout exactly.
- [Database] **[PERFORMANCE]** **Removed 27 Duplicate Database Indexes**
  The database was maintaining 27 indexes that could never be used, because each one was an exact copy of a uniqueness rule the database already enforced, or a narrower version of a wider index that already covered it. Every save, update and delete on the busiest tables paid to keep those copies current for nothing, and rate limiting, API usage and scan history are written on almost every request. They are gone now, and both the fresh-install path and the upgrade path drop them, so self-hosted installs get the same cleanup on their next start or migration. A new test derives the check from the schema itself, so a duplicate added later fails the build instead of quietly costing writes.
- [Wrench] **[FIXED]** **Scans No Longer Fail At The Finish Line Under Load**
  When several scans finished at the same moment and the tag-rule cache had just expired, each one held a database connection open while asking for a second one that did not exist. All of them stalled and were eventually marked failed, even though the scan itself had already completed successfully and the results were ready. The rule lookup now happens before the connection is taken, so a burst of scans finishing together commits normally.
- [Smartphone] **[FIXED]** **The Cookie Notice No Longer Covers Save Buttons And The Docs Menu**
  On a phone the cookie bar painted over anything anchored to the bottom of the screen, including the Contents button that is the only way to reach the documentation menu on a small screen. The bar now publishes its own height, and the controls that sit at the bottom of the screen move up above it. Toasts moved to the bottom on mobile too, where they no longer cover the app header.
- [Smartphone] **[FIXED]** **The Documentation Drawer Traps Focus And Keeps Its Close Button**
  The documentation menu on phones announced itself as a modal but let the keyboard tab straight out into the page behind it, and its close button scrolled away on the first swipe because it lived inside the scrolling area. Tab now cycles inside the drawer, the page behind no longer scrolls, and the close button stays put.
- [FileText] **[CHANGED]** **The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports**
  The hero answered what the product does but never who it is for or why to pick it over the free header checkers, and both answers were already written further down the page. It now leads with both. The landing page also finally mentions two things that have shipped for a while and were advertised nowhere: SARIF export for the GitHub Security tab, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk, both included on the free tier.
- [Bug] **[FIXED]** **A Server Error No Longer Reads As "Access Denied"**
  When the admin data request failed for any reason other than a real permissions check, the panel showed "Access Denied: you do not have administrator privileges". During an outage that sent operators off to check roles and 2FA instead of the actual fault. It now shows a distinct error screen with the status code and a Retry button.
- [Zap] **[PERFORMANCE]** **Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans**
  The dashboard was running seven separate whole-history queries on every load, one of which expanded the findings of every scan you had ever run. It now runs fewer, tighter queries, so the page loads faster and stops crowding out other requests. "Most common findings" also now ranks the latest scan of each site instead of every scan ever, so rescanning one site fifty times no longer pushes its issues to the top of the list.
- [Bell] **[FIXED]** **A Missing Stripe Webhook Secret Is Reported As A Misconfiguration**
  If the Stripe webhook secret was not configured, every incoming payment event was rejected as "Invalid signature" with no way to tell a setup mistake from an attack, and Stripe stopped retrying. It is now reported as a configuration problem with an admin alert, and Stripe keeps retrying so nothing is lost once the secret is set.
- [Zap] **[PERFORMANCE]** **AI Assistant Context Loads Without Re-Reading Megabytes Per Request**
  Every AI assistant slash command re-read its reference file from disk, up to about a megabyte each time, which briefly stalled the whole server. Those files only change when a new version is deployed, so they are now read once and kept in memory. The account-related commands also stopped looking up your session twice.
- [Key] **[FIXED]** **Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions**
  Sensitive admin actions ask you to re-enter your password first. An account created through Google, GitHub or Discord has no password at all, so that prompt could never be satisfied and every gated action failed with "Password is incorrect". Those accounts now pass the confirmation on their signed-in session, the same rule the rest of the app already used for account deletion and 2FA changes.
- [Zap] **[CHANGED]** **Bulk Scans No Longer Block The Request**
  The bulk scan API used to run every URL one after another inside a single request, so a batch of ten could hold the connection open for minutes and a proxy would cut it off while the scans kept running and kept spending your daily quota, with no way to find them again. It now behaves like an ordinary scan: it accepts the batch, hands back a scan id per URL straight away, and runs them in the background. Every URL shows up in your history immediately and reports its own progress and result.
- [Gauge] **[PERFORMANCE]** **Scans No Longer Do Their Network Checks Twice**
  Working out how many check groups a scan would run accidentally started all of them and threw the results away, so every scan resolved DNS, shook hands with TLS and fetched the same files from the target twice over, and a crawl did it once more for every page. Scans now send roughly half the requests they used to, finish with less load on the site being scanned, and return the same results.
- [Shield] **[SECURITY]** **Request Size Limit Now Covers The Whole API**
  A 1 MB cap on request bodies was documented as an API-wide rule but was only actually applied by 19 of the 73 endpoints that read one, so the rest would buffer an arbitrarily large body in memory before checking anything about it. The limit is now enforced for every API request before it reaches any endpoint, and oversized requests are refused with a clear 413.
- [ShieldAlert] **[SECURITY]** **Scan Volume Is Now Limited Per Target, Not Just Per Account**
  Every rate limit measured how much you were scanning, and none measured how much was being scanned at one site, so signing up for more accounts multiplied the traffic a single website could be pointed at. Scans of one domain are now capped per hour across all accounts together. Verify the domain in Profile > Domains and the limit no longer applies to your scans of it.
- [ShieldCheck] **[ADDED]** **Badges Now Show An A+ To F Grade**
  The embeddable badge said Safe, Caution or Unsafe, which is a vocabulary nobody else uses and which no one wants to leave sitting in a README. It now leads with a whole-site letter grade from A+ down to F, derived from the same score the scan already reports, and keeps the green, amber and red colouring so the badge still reads at a glance. Scan results now record the grade too.
- [Timer] **[FIXED]** **Failed Scans Report Their Real Duration**
  A scan's clock started when its record was created rather than when it actually began running. That made no difference for a single scan, but a queued one that later failed reported the time it spent waiting as though it were scan time. The clock now starts when the scan starts.
- [Lock] **[SECURITY]** **Signup No Longer Reveals Who Has An Account**
  Creating an account with an address that was already registered used to fail with "an account with this email already exists". That one difference let anyone check a list of addresses to find out which people have a VulnRadar account, which is exactly what sign-in and password reset already work hard to hide. Signup now answers the same way whether the address is new or not, and if it is already yours, we email you instead with links to sign in or reset your password. Nothing is created and your account is untouched.
- [Gauge] **[CHANGED]** **Four More Rate Limits Moved Into Admin Settings**
  The per-email caps on signup and password reset, and the caps on adding and verifying a domain, were fixed numbers baked into the build. That meant an operator responding to a signup or reset flood could tighten every limiter in the admin panel and still leave the ones that actually stop the attack untouched. All four now appear under Settings and take effect without a redeploy.
- [Network] **[CHANGED]** **Port Sweep Speed And Timeouts Are Now Tunable**
  The curated port sweep always used 24 simultaneous connections and gave each port 1.5 seconds to answer. That is aggressive for a target on another continent, where a filtered port gets reported as closed, and it is the sort of traffic pattern an intrusion detection system flags as a port scan. Concurrency, connect timeout, banner window, banner size and the overall deadline are all editable in Settings now, so you can slow the sweep down to suit your own network.
- [Key] **[FIXED]** **Two-Factor Window Setting Now Applies To The Login Cookie**
  Changing the pending two-factor window in the admin panel took effect everywhere except the login page, which kept handing out a cookie with the shipped default lifetime. Lengthening the window left the cookie expiring before the challenge did. Login now reads the same live setting every other part of the two-factor flow does.
- [List] **[CHANGED]** **Pricing Table Now Shows Crawl Pages And Free GitHub Review**
  Two limits were enforced but never advertised. How many pages one crawl may scan was a per-plan cap you only discovered when a crawl was refused, and the Free plan showed a cross next to AI GitHub code review even though every free account gets one review a day. Both now appear in the plan comparison, and the crawl page cap is editable per plan in admin settings.
- [Zap] **[PERFORMANCE]** **The Changelog Page Stopped Downloading Every Release**
  Opening the changelog used to send your browser the entire release history, around 90 KB compressed and growing with every release, just to draw the first four entries. On a phone connection that was several seconds of waiting before anything appeared. The release history now stays on the server and only the entries you can actually see are sent, with later ones fetched as you scroll.
- [Gauge] **[PERFORMANCE]** **Host Reports Load Their Risk Chart In Parallel**
  The risk-score-over-time chart on a public host report could not start loading until the report itself had finished, because the chart only existed once the report was on screen. That made every host report two round trips deep instead of one. Both requests now go out together, so the chart appears with the rest of the page.
- [Timer] **[PERFORMANCE]** **Background Tabs Stop Polling**
  The notification bell kept checking for new notifications every five minutes in tabs nobody was looking at, forever, in every open tab. Polling now pauses while a tab is hidden and refreshes once as soon as you come back to it, so what you see is still current without the constant background traffic.
- [Network] **[ADDED]** **The App Tells You When You Are Offline**
  Nothing in the app knew when your connection had dropped, so every screen guessed at what a failed request meant and the guesses disagreed: History said you had no scans, the notification bell said you were all caught up. A band now appears at the bottom of the page when you go offline, and the notification panel says the connection is down rather than pretending the check succeeded.
- [Search] **[ADDED]** **Command Palette On Ctrl-K**
  Press Ctrl-K, or Cmd-K on a Mac, anywhere in the app to search every section and jump straight to it. Scheduled scans, webhooks, API keys and the account tabs are all listed as their own entries, so the things that used to be three navigations deep are now one keystroke and a few letters.
- [Filter] **[ADDED]** **History Can Be Filtered By Severity And Date, And Sorted**
  Scan history only had a URL search and a tag filter, and was locked to newest-first even though every row already showed its severity counts. You can now filter to scans that turned up a critical, to high and above, or to clean runs, narrow to the last 7 or 30 days, and sort by worst severity, most findings, oldest first or host name.
- [Trash2] **[CHANGED]** **Clear All History Moved Away From The Search Box**
  The button that deletes every scan on your account sat directly beside the search input you use constantly, two clicks from losing everything, with nothing to recover it. It now lives in its own clearly labelled section below the list, and the confirmation asks you to type DELETE rather than accepting a second click. The scan count on the page also updates correctly after a clear instead of still claiming your old total.
- [Activity] **[ADDED]** **Compare With The Previous Scan, From The Scan Itself**
  Getting a diff of the host you were looking at meant six steps: back out of the findings, back to History, Compare in the nav, find the host, pick two scans, press Compare. The scan actions menu now has Compare with previous scan, which opens the diff of that host's two most recent scans directly.
- [Palette] **[CHANGED]** **Error And Success Messages Look The Same Everywhere**
  The banner that appears when something fails was hand-built on 53 different screens, in 23 slightly different shapes, and two of them were shades nobody had chosen on purpose. Confirmation dialogs had the same problem, with eight separate rebuilds of the same dialog and half of them unable to show you why an action failed. Both are now one component, so feedback reads the same wherever you meet it and a failed delete always says what went wrong.
- [FileText] **[FIXED]** **Support Ticket Timestamps Read The Same For You And For Us**
  The last-activity time on a support ticket was formatted differently in your view of it than in the staff view of the same ticket, so an old ticket could read as a bare date to you and as a running day count to the person answering it. Both now use the same wording as every other timestamp in the product.
- [Lock] **[SECURITY]** **Webhook Signing Secrets Encrypted At Rest**
  The secret used to sign your outgoing webhook payloads was the only long-lived credential still stored as plain text in the database, so anyone who got a copy of the database could forge payloads that your receiver would accept as genuine. It is now encrypted with the same AES-256-GCM protection used for API keys and connected-account tokens, and existing secrets are converted automatically on the next start. Nothing changes for you: the secret you were shown when you created or rotated the webhook still verifies exactly as before.
- [Database] **[FIXED]** **Two Tables Missing From Fresh Installs**
  Staff invites and the admin audit-log archive were created on demand rather than by the schema, so a database built with the create or migrate commands was quietly missing both and the health check still reported everything as fine. Both are now part of the schema, the health check knows about them, and admin pages no longer re-issue table-creation statements on every request. Self-hosters get a complete database from the first run, and the nightly cleanup no longer runs schema changes inside its long transaction.
- [ShieldCheck] **[FIXED]** **Accurate Backup-Code Status In The Admin User View**
  The admin user detail panel decided whether an account had 2FA backup codes left by comparing stored text to two exact characters. Any harmless variation, an empty array written with a space in it or a stored null, flipped the flag the wrong way and told staff someone had recovery codes when they had none. The check now ignores spacing and empty values, so the status reflects reality.
- [FileText] **[ADDED]** **Docs For Billing, Troubleshooting, And Administration**
  Three things the product does had no documentation at all: what each plan includes and how to cancel it, what to do when a scan fails or comes back empty, and how to run the admin panel on your own instance. All three now have their own pages, and the plan limits on the billing page are read straight from the plan catalog so they cannot drift from what the app enforces. Bulk scanning also picked up a section of its own.
- [Smartphone] **[ADDED]** **Screenshots And Two Missing Features In The Extension Docs**
  The browser extension page now shows what it is describing: the on-page card, the auto-scan settings, the link context menu, and the desktop notification. Writing it up turned up two shipped features the page had never mentioned, so right-clicking a link to scan it without opening it, and the notification you get when a background scan finishes, are both documented now.
- [Search] **[CHANGED]** **Ten Check Pages No Longer Share Five Titles**
  Five pairs of checks shipped the same title as each other, so ten of the how-to-fix pages competed with themselves in search results and two findings in the same report could read identically. Each pair now says what actually separates it, for example document.write() found inside page scripts versus elsewhere in the response, and Django's debug page identified by its settings dump versus by its technical 500 template.
- [RefreshCw] **[FIXED]** **The Sitemap Now Reports Real Change Dates**
  Every URL in the sitemap carried the same timestamp, refreshed on each deploy, which told search engines the entire site changed at once several times a week. Search engines ignore that field entirely when it is not accurate. Each check page now carries the date its source data actually last changed, so a page that really was updated gets recrawled sooner than the seven hundred that were not.
- [Sparkles] **[ADDED]** **Where We Stand On AI Pentesting**
  Every commercial scanner launched an autonomous AI pentest product this year, and nothing on the site said why we have not. The comparison pages now answer it directly: the detection engine is deterministic, the same URL produces the same finding IDs every run, and a model is only used to triage and explain findings, never to decide whether one exists. That is what makes failing a build on a specific ID, and diffing one scan against another, mean anything.
- [Palette] **[CHANGED]** **Less To Rename When You Fork It**
  Running your own rebranded instance meant hand-editing the product name out of the comparison pages and a scattering of documentation, because those strings were typed out rather than read from your configured app name. They now follow the setting like the rest of the app does. The self-hosting guide has a new section spelling out exactly what one setting covers, what it does not, and the two things you must never rename.
- [Smartphone] **[FIXED]** **The Cookie Notice No Longer Covers Save Buttons And The Docs Menu**
  On a phone the cookie bar painted over anything anchored to the bottom of the screen, including the Contents button that is the only way to reach the documentation menu on a small screen. The bar now publishes its own height, and the controls that sit at the bottom of the screen move up above it. Toasts moved to the bottom on mobile too, where they no longer cover the app header.
- [Smartphone] **[FIXED]** **The Documentation Drawer Traps Focus And Keeps Its Close Button**
  The documentation menu on phones announced itself as a modal but let the keyboard tab straight out into the page behind it, and its close button scrolled away on the first swipe because it lived inside the scrolling area. Tab now cycles inside the drawer, the page behind no longer scrolls, and the close button stays put.
- [FileText] **[CHANGED]** **The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports**
  The hero answered what the product does but never who it is for or why to pick it over the free header checkers, and both answers were already written further down the page. It now leads with both. The landing page also finally mentions two things that have shipped for a while and were advertised nowhere: SARIF export for the GitHub Security tab, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk, both included on the free tier.
- [Bug] **[FIXED]** **A Server Error No Longer Reads As "Access Denied"**
  When the admin data request failed for any reason other than a real permissions check, the panel showed "Access Denied: you do not have administrator privileges". During an outage that sent operators off to check roles and 2FA instead of the actual fault. It now shows a distinct error screen with the status code and a Retry button.
- [Zap] **[PERFORMANCE]** **Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans**
  The dashboard was running seven separate whole-history queries on every load, one of which expanded the findings of every scan you had ever run. It now runs fewer, tighter queries, so the page loads faster and stops crowding out other requests. "Most common findings" also now ranks the latest scan of each site instead of every scan ever, so rescanning one site fifty times no longer pushes its issues to the top of the list.
- [Bell] **[FIXED]** **A Missing Stripe Webhook Secret Is Reported As A Misconfiguration**
  If the Stripe webhook secret was not configured, every incoming payment event was rejected as "Invalid signature" with no way to tell a setup mistake from an attack, and Stripe stopped retrying. It is now reported as a configuration problem with an admin alert, and Stripe keeps retrying so nothing is lost once the secret is set.
- [Zap] **[PERFORMANCE]** **AI Assistant Context Loads Without Re-Reading Megabytes Per Request**
  Every AI assistant slash command re-read its reference file from disk, up to about a megabyte each time, which briefly stalled the whole server. Those files only change when a new version is deployed, so they are now read once and kept in memory. The account-related commands also stopped looking up your session twice.
- [Key] **[FIXED]** **Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions**
  Sensitive admin actions ask you to re-enter your password first. An account created through Google, GitHub or Discord has no password at all, so that prompt could never be satisfied and every gated action failed with "Password is incorrect". Those accounts now pass the confirmation on their signed-in session, the same rule the rest of the app already used for account deletion and 2FA changes.
- [Bug] **[FIXED]** **Deep Scans With A Login Now Actually Crawl**
  If you picked a Deep scan and filled in the sign-in details, you got a single-page scan instead of a crawl, with no error and nothing to say the crawl had been dropped. Deep now crawls whether or not you supply a login: page discovery signs in first, so the picker lists the pages behind the login, and every page it scans is fetched as the signed-in user.
- [Users] **[ADDED]** **Change A Teammate's Role Without Removing Them**
  Changing someone's role used to mean removing them from the team and sending a fresh invite. The member menu now has a Change role option, showing only the roles you are allowed to hand out and leaving the team owner alone.
- [RefreshCw] **[ADDED]** **Reopen A Support Ticket You Resolved**
  Marking a ticket resolved used to be one-way unless you wrote another message. There is now a Reopen button on a ticket you resolved, which puts it back in the support queue and tells the team it is not fixed. Closed tickets are still final: start a new ticket for those.
- [FileText] **[ADDED]** **Import Scan Targets From An API Spec**
  The bulk tab can now read an OpenAPI 3, Swagger 2, or Postman collection file and fill the URL list from it. Pick the file with Import spec and the URLs it declares are added to whatever you already had, deduplicated. The file is read in your browser and only the parsed document is sent, never a link for us to fetch.
- [Timer] **[FIXED]** **Live Browser Sessions Honour The Configured Lifetime**
  Opening a live browser session always asked for a six-minute lifetime, so changing the default session length in settings did nothing. The request now leaves the length to the server, which applies the configured default and the hard cap.
- [Lock] **[CHANGED]** **We Say What Happens To A Login You Scan With**
  Authenticated scanning takes a username, token, or cookie in the scan request itself, holds it in memory for that one scan, and never writes it to a database, a log, or the saved result. That was true but documented only in the source code. It is now stated next to the credential fields, on the landing page, and in every competitor comparison, along with the honest trade-off: with nothing stored, an authenticated scan is run on demand rather than left on a schedule.
- [ShieldCheck] **[SECURITY]** **Staff Roles No Longer See Data They Were Never Granted**
  In the admin panel, a user's scan history, API keys and active sessions were shown to every staff role that could open an account record, even roles deliberately scoped away from that data. Each of those three now needs its own permission, checked on the server before the data is ever read and again in the panel before the card is drawn. A role without the permission sees no card at all rather than an empty one that looks like the user has nothing.
- [Key] **[CHANGED]** **Permissions That Did Nothing Are Gone**
  Eight staff permissions could be granted or withheld without changing anything, including two for a user-reports feature that was never built. They are removed, and the two that guarded real admin panel data are now actually enforced. If you assign staff roles, the permission list you see is the list that has an effect.
- [Code] **[CHANGED]** **Schedules And Webhooks API Return An Object, Not A Bare Array**
  GET /api/v3/schedules and GET /api/v3/webhooks used to return a plain JSON array while every other list endpoint returns a named object. They now return { "schedules": [...] } and { "webhooks": [...] }, which is what the rest of the API already does and what lets these endpoints carry a count or paging later. If you call either from your own script, read the named key instead of the array. The web app was already reading both shapes, so nothing in the product changes.
- [Network] **[ADDED]** **Every Request Now Has An Id**
  Until now there was no way to tie together the several errors one failed request produced: they arrived in the admin error log as separate lines of text with nothing connecting them. Every response now carries an x-request-id header, and every error logged while handling that request is stamped with the same id. If something goes wrong you can quote the id from the response and an operator can pull up exactly that request's errors instead of guessing from timestamps.
- [Database] **[CHANGED]** **Dropped Six Unused Database Columns**
  Six columns had sat in the schema for a long time with nothing reading or writing them, which made the data model misleading to anyone trying to understand it. They are gone from new installs, and self-hosters running the migration will see them listed as drop steps in the plan preview before anything happens. None of them ever held a value, so nothing is lost, and rolling the migration back restores all six. Another six that belong to features which are only half built are staying put, now labelled as such so nobody assumes they work.
- [ShieldCheck] **[SECURITY]** **Server Settings Kept Out Of The Browser**
  The configuration module holding server-side settings, including the mail server password and the browser-automation API key, was being compiled into the JavaScript that every page downloads. No credential was ever readable there, because only values explicitly marked public are filled in for the browser, but the code that reads them travelled with every page for no reason. Those settings now live in server-only modules, and pages load a smaller client-safe set of constants instead.
- [Smartphone] **[FIXED]** **The Cookie Notice No Longer Covers Save Buttons And The Docs Menu**
  On a phone the cookie bar painted over anything anchored to the bottom of the screen, including the Contents button that is the only way to reach the documentation menu on a small screen. The bar now publishes its own height, and the controls that sit at the bottom of the screen move up above it. Toasts moved to the bottom on mobile too, where they no longer cover the app header.
- [Smartphone] **[FIXED]** **The Documentation Drawer Traps Focus And Keeps Its Close Button**
  The documentation menu on phones announced itself as a modal but let the keyboard tab straight out into the page behind it, and its close button scrolled away on the first swipe because it lived inside the scrolling area. Tab now cycles inside the drawer, the page behind no longer scrolls, and the close button stays put.
- [FileText] **[CHANGED]** **The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports**
  The hero answered what the product does but never who it is for or why to pick it over the free header checkers, and both answers were already written further down the page. It now leads with both. The landing page also finally mentions two things that have shipped for a while and were advertised nowhere: SARIF export for the GitHub Security tab, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk, both included on the free tier.
- [Bug] **[FIXED]** **A Server Error No Longer Reads As "Access Denied"**
  When the admin data request failed for any reason other than a real permissions check, the panel showed "Access Denied: you do not have administrator privileges". During an outage that sent operators off to check roles and 2FA instead of the actual fault. It now shows a distinct error screen with the status code and a Retry button.
- [Zap] **[PERFORMANCE]** **Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans**
  The dashboard was running seven separate whole-history queries on every load, one of which expanded the findings of every scan you had ever run. It now runs fewer, tighter queries, so the page loads faster and stops crowding out other requests. "Most common findings" also now ranks the latest scan of each site instead of every scan ever, so rescanning one site fifty times no longer pushes its issues to the top of the list.
- [Bell] **[FIXED]** **A Missing Stripe Webhook Secret Is Reported As A Misconfiguration**
  If the Stripe webhook secret was not configured, every incoming payment event was rejected as "Invalid signature" with no way to tell a setup mistake from an attack, and Stripe stopped retrying. It is now reported as a configuration problem with an admin alert, and Stripe keeps retrying so nothing is lost once the secret is set.
- [Zap] **[PERFORMANCE]** **AI Assistant Context Loads Without Re-Reading Megabytes Per Request**
  Every AI assistant slash command re-read its reference file from disk, up to about a megabyte each time, which briefly stalled the whole server. Those files only change when a new version is deployed, so they are now read once and kept in memory. The account-related commands also stopped looking up your session twice.
- [Key] **[FIXED]** **Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions**
  Sensitive admin actions ask you to re-enter your password first. An account created through Google, GitHub or Discord has no password at all, so that prompt could never be satisfied and every gated action failed with "Password is incorrect". Those accounts now pass the confirmation on their signed-in session, the same rule the rest of the app already used for account deletion and 2FA changes.
- [Smartphone] **[FIXED]** **The Cookie Notice No Longer Covers Save Buttons And The Docs Menu**
  On a phone the cookie bar painted over anything anchored to the bottom of the screen, including the Contents button that is the only way to reach the documentation menu on a small screen. The bar now publishes its own height, and the controls that sit at the bottom of the screen move up above it. Toasts moved to the bottom on mobile too, where they no longer cover the app header.
- [Smartphone] **[FIXED]** **The Documentation Drawer Traps Focus And Keeps Its Close Button**
  The documentation menu on phones announced itself as a modal but let the keyboard tab straight out into the page behind it, and its close button scrolled away on the first swipe because it lived inside the scrolling area. Tab now cycles inside the drawer, the page behind no longer scrolls, and the close button stays put.
- [FileText] **[CHANGED]** **The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports**
  The hero answered what the product does but never who it is for or why to pick it over the free header checkers, and both answers were already written further down the page. It now leads with both. The landing page also finally mentions two things that have shipped for a while and were advertised nowhere: SARIF export for the GitHub Security tab, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk, both included on the free tier.
- [Layout] **[CHANGED]** **Host Details Now Sit Above The Findings**
  On a scan result, the "More about this host" section (screenshot, response headers, DNS, ports, threat intel, software inventory, subdomains, plus your tags and notes) was rendered underneath the findings list, so you had to scroll past the whole report to reach it. It now sits directly under the verdict summary, above the findings, on every result view: dashboard, history, a shared link, the public host page and the demo.
- [CheckCheck] **[CHANGED]** **Finding Triage Controls Moved Up**
  "Mark this result" and "Your remediation tracking" used to be parked at the very bottom of a finding, below the fix guide and the code example. They now appear straight after the evidence, so you can flag a false positive or set a status as soon as you have seen what the scanner found, without scrolling to the end of the page.
- [List] **[CHANGED]** **Cleaner Bulk Selection On The Findings List**
  Turning on Select used to put a bare checkbox in the margin beside each finding, detached from the row it belonged to. The checkbox is now drawn inside the row, a selected finding is clearly highlighted, and the arrow that suggested the row would open is hidden while you are selecting.
- [Layout] **[FIXED]** **The Admin Panel Loads Into The Shape It Actually Opens On**
  Opening the admin panel drew a row of counters over a table while it loaded, then replaced them with the System Health list the panel actually lands on. Three separate placeholders were involved and none of them was the right shape, so the screen visibly rearranged itself twice on every visit. The placeholder is now the health list itself, at the same width as the real page.
- [MessageSquare] **[CHANGED]** **Support Tickets Read Like A Conversation On Both Sides**
  The ticket views were rebuilt for the people using them. Your side now says what state a ticket is in AND what happens next, with the resolve, close and reopen buttons up beside it instead of buried under the message history, and a thread opens on the newest reply rather than the message you sent weeks ago. Staff get a proper inbox: every filter shows how many tickets are in it, each row previews the latest message, and the reply box stays on screen instead of sitting below a long conversation.
- [Trash2] **[CHANGED]** **Clear All History Is Back At The Top Of The Page**
  Clearing your scan history meant scrolling past every row and the pager to find the button at the very bottom of the page. It now sits in the History header, beside the title, where a page-level action belongs. The confirmation that asks you to type DELETE first is unchanged, so it is still impossible to wipe your history by accident.
- [Layout] **[FIXED]** **The Demo Report Now Says Which Site It Scanned**
  The demo's report opened with a headline and a row of numbers that repeated what the summary card directly underneath already showed, and it never named the site that had been scanned. Now that you can type your own URL into the demo, that mattered. The report is headed by the target itself, the duplicated headline and stat row are gone, and the summary card no longer sits flush against the header rule.
- [Sparkles] **[CHANGED]** **Toggles And Checkboxes Animate Instead Of Snapping**
  Checkboxes, switches, tabs, page-size pickers and the menu tick marks changed state in a single frame with no transition at all, which made them feel unresponsive rather than instant. They now share one short 150ms transition, kept deliberately quick so a fast filter change still feels immediate. If your system is set to reduce motion, nothing animates.
- [Layout] **[CHANGED]** **One Navbar Across Every Public Page**
  The changelog, comparison, contact, security, donate, public scans, host report and shared report pages swapped in the full signed-in app header once you logged in, while the docs, legal, pricing and check pages kept the public one. Reading the changelog, opening the docs and going back changed the top bar twice. Every page you can read without an account now keeps the public navbar, signed in or not, with a single Dashboard button as the way back into the app. The docs sidebar and table of contents are unchanged.
- [Palette] **[FIXED]** **Docs Top Bar Lines Up With The Rest Of The Site**
  The documentation pages stretched their top bar wider than every other page, so the logo and the nav links jumped sideways whenever you moved between the docs and the changelog, pricing or demo pages. The docs bar now sits on the same measure as everywhere else.
- [Palette] **[FIXED]** **Outlines Back Off Panels, Sharpen On Controls**
  A contrast fix had put a hard outline around every dialog, sheet and side panel, which made the app look boxed in without helping anyone. Panels are back to the quiet edge they had, and the stronger outline now belongs only to things you actually operate: text fields, dropdowns, checkboxes and outline buttons. Those edges were also measured properly this time and genuinely clear the contrast bar in both light and dark mode, which the previous values did not.
- [Eye] **[FIXED]** **Toggles, Sliders And Progress Bars Readable In Light Mode**
  On the light theme the brand blue used for a switched-on toggle, a slider's filled track and a progress bar was too pale to see against the page, and the white dot on a switched-on toggle vanished into it. Those now use the darker brand blue the app already uses for links, so you can tell at a glance whether a setting is on and how far a meter has filled. Dark mode is unchanged.
- [Shield] **[FIXED]** **Keyboard Focus Visible On Every Control**
  The focus outline was drawn in the same colour as the control it sat on for destructive buttons, toggles, checked checkboxes and the support chat button, so tabbing to them showed nothing at all. Each of those now draws its outline in a colour that reads against its own fill. The command palette's highlighted row also gets a real outline instead of a faint tint.
- [Layout] **[FIXED]** **Tabbing No Longer Hides The Thing You Focused**
  Moving through a page with the Tab key could scroll the focused control underneath the fixed header or the cookie bar, so it was selected but invisible. Pages now leave room for both, everywhere, not just in the docs.
- [Users] **[FIXED]** **Admin Tables Usable Without A Mouse**
  Opening a user, a staff member, an IP rule or an audit entry could only be done by clicking the row, so those screens were unreachable with a keyboard. Rows are now focusable and open with Enter or Space. Admin table headers are also properly linked to their columns, so a screen reader reads a row's values with the column names attached.
- [Bell] **[FIXED]** **Site Notification Popups Behave Like Real Dialogs**
  A site-wide notification shown as a popup did not announce itself, did not move focus into itself and could not be closed with the Escape key, so on a non-dismissible one there was no keyboard way past it. It now announces itself, traps focus while open, returns focus where it came from, and Escape always closes it.
- [Smartphone] **[FIXED]** **Narrow Screens And Zoomed Text Stop Overflowing**
  The profile-picture cropper was a fixed 280px square that pushed its dialog off the side of a 320px phone, and the landing page's sample finding squeezed three columns of monospace detail into that same width and cut them off. Both now adapt to the space available.
- [Settings] **[FIXED]** **Smaller Controls Meet The Minimum Tap Size**
  Several small controls were under the 24px minimum: the remove-item x on admin setting chips was 14px, the SSL grade help button 18px, the add-tag chip 18px, and the dismiss buttons on alerts and toasts 22px. All are 24px now, with the icons inside unchanged, so nothing looks bigger but everything is easier to hit.
- [Bug] **[FIXED]** **A Server Error No Longer Reads As "Access Denied"**
  When the admin data request failed for any reason other than a real permissions check, the panel showed "Access Denied: you do not have administrator privileges". During an outage that sent operators off to check roles and 2FA instead of the actual fault. It now shows a distinct error screen with the status code and a Retry button.
- [Zap] **[PERFORMANCE]** **Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans**
  The dashboard was running seven separate whole-history queries on every load, one of which expanded the findings of every scan you had ever run. It now runs fewer, tighter queries, so the page loads faster and stops crowding out other requests. "Most common findings" also now ranks the latest scan of each site instead of every scan ever, so rescanning one site fifty times no longer pushes its issues to the top of the list.
- [Bell] **[FIXED]** **A Missing Stripe Webhook Secret Is Reported As A Misconfiguration**
  If the Stripe webhook secret was not configured, every incoming payment event was rejected as "Invalid signature" with no way to tell a setup mistake from an attack, and Stripe stopped retrying. It is now reported as a configuration problem with an admin alert, and Stripe keeps retrying so nothing is lost once the secret is set.
- [Zap] **[PERFORMANCE]** **AI Assistant Context Loads Without Re-Reading Megabytes Per Request**
  Every AI assistant slash command re-read its reference file from disk, up to about a megabyte each time, which briefly stalled the whole server. Those files only change when a new version is deployed, so they are now read once and kept in memory. The account-related commands also stopped looking up your session twice.
- [Filter] **[FIXED]** **Sorting And Filtering A Report Is Instant Again**
  On a saved scan, using "Most severe first", "Least severe first", the severity or category filters, the group toggle or the search box made the whole report disappear behind a loading placeholder while it was fetched from the server all over again. The findings were already on your screen, so none of that was needed: the list now re-sorts and re-filters instantly, your place in it is kept, and the search box no longer loses focus while you type. Opening a finding no longer reloads the report either, and clicking a scan in your history now makes one request instead of three.
- [Smartphone] **[FIXED]** **Save Buttons And Modal Footers Reachable On A Phone**
  The cookie notice sits about 125px tall on a phone and was painting over the controls beneath it, so on your profile a phone user with unsaved changes could not reach Save or Discard at all. Nine modals also capped their height without allowing scrolling, which put their confirm and cancel buttons off screen. Every bottom-pinned bar and modal now accounts for the notice and scrolls properly.
- [Layout] **[FIXED]** **Scan Panels No Longer Clip On Narrow Screens**
  The threat intelligence, open ports and software panels had headers slightly wider than a phone screen, and a long hostname pushed the counts and refresh buttons off the edge. Because the page hides horizontal overflow, that content was simply cut off rather than scrollable. Long check titles and hostnames now wrap instead of running off the side.
- [Smartphone] **[CHANGED]** **Bigger Tap Targets On Mobile**
  Ten controls were smaller than the 44px minimum a touch screen needs, including the menu button, the back button out of a scan, and the export and share menu. The copy button on AI chat messages only appeared on hover, which meant it was permanently invisible on a touch device. All are now properly sized and reachable.
- [Users] **[ADDED]** **Share A Scan With Several Teams**
  A scan could only ever be handed to one team, so the share picker was a set of radio buttons: choosing a second team quietly took the scan away from the first, with nothing on screen saying so. The picker is now checkboxes, so you can tick every team that should see a scan and untick the ones that should not, and "Just me" clears the lot. Everything that shows a team its scans follows the whole list rather than one team, and you still need a role that can manage scans in a team both to add a scan to it and to take one out.
- [Key] **[FIXED]** **Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions**
  Sensitive admin actions ask you to re-enter your password first. An account created through Google, GitHub or Discord has no password at all, so that prompt could never be satisfied and every gated action failed with "Password is incorrect". Those accounts now pass the confirmation on their signed-in session, the same rule the rest of the app already used for account deletion and 2FA changes.
- [Smartphone] **[FIXED]** **The Cookie Notice No Longer Covers Save Buttons And The Docs Menu**
  On a phone the cookie bar painted over anything anchored to the bottom of the screen, including the Contents button that is the only way to reach the documentation menu on a small screen. The bar now publishes its own height, and the controls that sit at the bottom of the screen move up above it. Toasts moved to the bottom on mobile too, where they no longer cover the app header.
- [Smartphone] **[FIXED]** **The Documentation Drawer Traps Focus And Keeps Its Close Button**
  The documentation menu on phones announced itself as a modal but let the keyboard tab straight out into the page behind it, and its close button scrolled away on the first swipe because it lived inside the scrolling area. Tab now cycles inside the drawer, the page behind no longer scrolls, and the close button stays put.
- [FileText] **[CHANGED]** **The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports**
  The hero answered what the product does but never who it is for or why to pick it over the free header checkers, and both answers were already written further down the page. It now leads with both. The landing page also finally mentions two things that have shipped for a while and were advertised nowhere: SARIF export for the GitHub Security tab, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk, both included on the free tier.
- [Users] **[CHANGED]** **Clearer Team Sharing Picker**
  The Share with a team dialog now matches the rest of the app's modals and shows how many people are on each team and what your role there is. Picking a team is unmistakable, and the picker no longer briefly claims a scan is unshared while it is still checking, which could have led you to overwrite an existing team share by accident.
- [Bug] **[FIXED]** **A Server Error No Longer Reads As "Access Denied"**
  When the admin data request failed for any reason other than a real permissions check, the panel showed "Access Denied: you do not have administrator privileges". During an outage that sent operators off to check roles and 2FA instead of the actual fault. It now shows a distinct error screen with the status code and a Retry button.
- [Zap] **[PERFORMANCE]** **Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans**
  The dashboard was running seven separate whole-history queries on every load, one of which expanded the findings of every scan you had ever run. It now runs fewer, tighter queries, so the page loads faster and stops crowding out other requests. "Most common findings" also now ranks the latest scan of each site instead of every scan ever, so rescanning one site fifty times no longer pushes its issues to the top of the list.
- [Bell] **[FIXED]** **A Missing Stripe Webhook Secret Is Reported As A Misconfiguration**
  If the Stripe webhook secret was not configured, every incoming payment event was rejected as "Invalid signature" with no way to tell a setup mistake from an attack, and Stripe stopped retrying. It is now reported as a configuration problem with an admin alert, and Stripe keeps retrying so nothing is lost once the secret is set.
- [Zap] **[PERFORMANCE]** **AI Assistant Context Loads Without Re-Reading Megabytes Per Request**
  Every AI assistant slash command re-read its reference file from disk, up to about a megabyte each time, which briefly stalled the whole server. Those files only change when a new version is deployed, so they are now read once and kept in memory. The account-related commands also stopped looking up your session twice.
- [Key] **[FIXED]** **Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions**
  Sensitive admin actions ask you to re-enter your password first. An account created through Google, GitHub or Discord has no password at all, so that prompt could never be satisfied and every gated action failed with "Password is incorrect". Those accounts now pass the confirmation on their signed-in session, the same rule the rest of the app already used for account deletion and 2FA changes.
- [Database] **[FIXED]** **Fresh Databases Get The Whole Schema**
  A database created with the built-in "create fresh database" command was quietly missing pieces the running app creates for itself: four safety rules that let an account be deleted without the deletion failing, six rules that reject invalid plan and role values, and the triggers that keep each account's last-modified time accurate. The command rebuilt the schema by reading the app's startup file as text and could not read a handful of statements, so it skipped them and only logged a warning. The schema now lives in one place that both startup and the create command run directly, so the two cannot disagree, and a test compares them on every change.
- [Bell] **[FIXED]** **Weekly Digest Columns Reach Every Install**
  The three database columns behind the weekly security digest were only ever created by the app at startup, not by the create-database or migrate commands. A database built with either of those was missing them until the app booted against it. They are now part of the schema every path builds.
- [Wrench] **[FIXED]** **No More Startup Errors On A First Boot**
  The very first boot of a self-hosted install printed two full error stack traces about missing tables. A one-time cleanup of old unencrypted secrets ran before any table had been created, so it failed every time on an empty database and looked alarming despite being harmless. It now runs after the schema is in place.
- [Share2] **[FIXED]** **Consistent Badges On A Cloned Database**
  Cloning a database with the create command seeded a different set of profile badges than the app itself creates on startup: six instead of eight, with different icons, colours and ordering for the ones they shared. Both now use the same definitions.
- [Smartphone] **[FIXED]** **The Cookie Notice No Longer Covers Save Buttons And The Docs Menu**
  On a phone the cookie bar painted over anything anchored to the bottom of the screen, including the Contents button that is the only way to reach the documentation menu on a small screen. The bar now publishes its own height, and the controls that sit at the bottom of the screen move up above it. Toasts moved to the bottom on mobile too, where they no longer cover the app header.
- [Smartphone] **[FIXED]** **The Documentation Drawer Traps Focus And Keeps Its Close Button**
  The documentation menu on phones announced itself as a modal but let the keyboard tab straight out into the page behind it, and its close button scrolled away on the first swipe because it lived inside the scrolling area. Tab now cycles inside the drawer, the page behind no longer scrolls, and the close button stays put.
- [FileText] **[CHANGED]** **The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports**
  The hero answered what the product does but never who it is for or why to pick it over the free header checkers, and both answers were already written further down the page. It now leads with both. The landing page also finally mentions two things that have shipped for a while and were advertised nowhere: SARIF export for the GitHub Security tab, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk, both included on the free tier.
- [Bug] **[FIXED]** **A Server Error No Longer Reads As "Access Denied"**
  When the admin data request failed for any reason other than a real permissions check, the panel showed "Access Denied: you do not have administrator privileges". During an outage that sent operators off to check roles and 2FA instead of the actual fault. It now shows a distinct error screen with the status code and a Retry button.
- [Zap] **[PERFORMANCE]** **Faster Dashboard, And Most Common Findings Now Counts Sites Not Rescans**
  The dashboard was running seven separate whole-history queries on every load, one of which expanded the findings of every scan you had ever run. It now runs fewer, tighter queries, so the page loads faster and stops crowding out other requests. "Most common findings" also now ranks the latest scan of each site instead of every scan ever, so rescanning one site fifty times no longer pushes its issues to the top of the list.
- [Bell] **[FIXED]** **A Missing Stripe Webhook Secret Is Reported As A Misconfiguration**
  If the Stripe webhook secret was not configured, every incoming payment event was rejected as "Invalid signature" with no way to tell a setup mistake from an attack, and Stripe stopped retrying. It is now reported as a configuration problem with an admin alert, and Stripe keeps retrying so nothing is lost once the secret is set.
- [Zap] **[PERFORMANCE]** **AI Assistant Context Loads Without Re-Reading Megabytes Per Request**
  Every AI assistant slash command re-read its reference file from disk, up to about a megabyte each time, which briefly stalled the whole server. Those files only change when a new version is deployed, so they are now read once and kept in memory. The account-related commands also stopped looking up your session twice.
- [Palette] **[FIXED]** **Readable Light Mode In The Browser Extension**
  The extension's light theme was still painted with colours picked for its dark theme, so links, severity labels, warning text and the on-page site alert's verdict line were all far too faint to read against a pale background. Every colour pair the extension draws has been measured and corrected, and an off switch in Settings now has a visible outline instead of nearly vanishing. Dark mode looks the same as before.
- [Eye] **[FIXED]** **Screen Reader Support In Settings And The Popup**
  Every on/off switch on the extension's Settings page announced itself as an unnamed checkbox, and the API key, throttle, whitelist, blacklist and muted-pattern fields had no label at all, so a screen reader could not say what any of them controlled. All of them are named now, the settings sections have real headings and a navigation landmark you can jump between, and the popup announces when a scan starts, finishes or fails instead of changing silently.
- [Smartphone] **[FIXED]** **Bigger Hit Targets And Visible Keyboard Focus**
  Several controls in the popup were small enough to be awkward to hit, including the rescan arrow, the export buttons and the card-position picker. They now all have a comfortable target area without looking any different. Keyboard focus is also drawn in the extension's own accent colour everywhere, so tabbing through the popup no longer loses your place.
- [Shield] **[FIXED]** **The On-Page Site Alert Is Harder To Break And Easier To Dismiss**
  The site alert card is injected into whatever page you are visiting, and a site with unusual styling could hide it or knock it out of position. Its layout is now pinned so a page cannot override it. Pressing Escape while the card has focus closes it, and its auto-dismiss timer pauses while you are tabbing through it rather than disappearing mid-use.
- [Key] **[FIXED]** **Staff Signed In With Google, GitHub Or Discord Can Confirm Admin Actions**
  Sensitive admin actions ask you to re-enter your password first. An account created through Google, GitHub or Discord has no password at all, so that prompt could never be satisfied and every gated action failed with "Password is incorrect". Those accounts now pass the confirmation on their signed-in session, the same rule the rest of the app already used for account deletion and 2FA changes.
- [Smartphone] **[FIXED]** **The Cookie Notice No Longer Covers Save Buttons And The Docs Menu**
  On a phone the cookie bar painted over anything anchored to the bottom of the screen, including the Contents button that is the only way to reach the documentation menu on a small screen. The bar now publishes its own height, and the controls that sit at the bottom of the screen move up above it. Toasts moved to the bottom on mobile too, where they no longer cover the app header.
- [Smartphone] **[FIXED]** **The Documentation Drawer Traps Focus And Keeps Its Close Button**
  The documentation menu on phones announced itself as a modal but let the keyboard tab straight out into the page behind it, and its close button scrolled away on the first swipe because it lived inside the scrolling area. Tab now cycles inside the drawer, the page behind no longer scrolls, and the close button stays put.
- [FileText] **[CHANGED]** **The Landing Page Says Who It Is For And Mentions SARIF And Compliance Reports**
  The hero answered what the product does but never who it is for or why to pick it over the free header checkers, and both answers were already written further down the page. It now leads with both. The landing page also finally mentions two things that have shipped for a while and were advertised nowhere: SARIF export for the GitHub Security tab, and a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk, both included on the free tier.

---

## v3.7.2 - August 25, 2026
**The AI Assistant Stops Forgetting Loaded Context**

A fix for the in-app AI assistant. Loading a large context block with a slash command, most visibly /changelog, then asking a question left the assistant answering as if nothing had loaded. The request-size guard added in the previous release trimmed the whole conversation to a character budget that a big context block, the changelog is around 250k characters, blew past on its own, so the block was dropped before it ever reached the model. Context blocks now get their own separate, generous budget and are no longer discarded to make room for recent chat turns, so /changelog, /docs, /checks, and /legal actually stay loaded for the questions that follow.

### Changes
- [Bot] **[FIXED]** **The Assistant Keeps the Context You Load**
  Running a slash command like /changelog loads a block of reference text for the assistant to answer from, but a size guard meant to bound request cost was trimming that block back out whenever it was larger than the recent-conversation budget. The changelog on its own is far larger than that budget, so it was always dropped and the assistant answered as though it had never been loaded. Loaded context now has its own budget separate from the back-and-forth of the chat, so it stays available for your follow-up questions instead of being discarded. The cost guard on ordinary chat turns is unchanged.

---

## v3.7.1 - August 25, 2026
**History Overflow, Dashboard Layout, Discord Sign-In, Staff 2FA**

A maintenance release cleaning up four things reported right after 3.7.0. On the history page, a scan whose URL carried a long query string no longer runs across the columns beside it; the path trims with an ellipsis instead. The dashboard's Recent Scans panel fills its card rather than leaving a gap under the last row when the column next to it runs taller. In the admin user panel, an account created with Sign in with Discord now shows as linked the same way Google and GitHub sign-ins already did (the account was always linked, only the admin display read the wrong source). And three admin endpoints that checked a caller's role without also applying the staff two-factor lockout now route through the same permission gate as the rest of the admin area.

### Changes
- [List] **[FIXED]** **Long URLs No Longer Overflow the History List**
  A scan whose URL carried a long query string (a login redirect, a signed share link) pushed its path past the edge of its row on the history page and ran across the source and severity columns next to it. The path now stays inside its own space and trims with an ellipsis, so every row lines up no matter how long the URL is.
- [Layout] **[FIXED]** **Recent Scans Fills the Dashboard Card**
  The Recent Scans panel on the dashboard left a block of empty space under the last row whenever the column beside it ran taller. Its rows now stretch to fill the card, so the two columns line up instead of leaving a gap.
- [Link2] **[FIXED]** **Admin Panel Shows Discord Sign-In Links**
  An account created with Sign in with Discord was correctly linked (it can sign back in with Discord), but the admin user panel read only the separate server-connection record and showed it as No Discord linked. The panel now reads the sign-in link the same way it already does for Google and GitHub, so a Discord signup shows as connected.
- [Fingerprint] **[FIXED]** **Staff 2FA Enforcement Covers Every Admin Route**
  When staff two-factor is required, three admin endpoints (site notifications and the staff activity heartbeat) checked the caller's role without also applying the two-factor lockout, unlike the rest of the admin surface. They now route through the same permission gate as every other staff action, so the requirement holds everywhere.

---

## v3.7.0 - August 24, 2026 **(highlights)**
**Support Tickets, Report Exports, Attack Surface, GitHub Scanner**

A capability and openness release. Support moves in-app: anyone, including free accounts, can open a billing or scanning ticket and talk to staff directly, share a ticket with specific teammates, and get replies by both notification and email. Any finished scan can now be pulled straight from the API as a formatted report in SARIF, PDF, Markdown, a compliance summary, or raw JSON, and the compliance crosswalk adds HIPAA and GDPR alongside PCI, SOC 2, ISO 27001, and ASVS. A new Attack Surface page collects your verified domains into one portfolio, the public assets page can now browse every public host rather than only your own, and software inventory recognizes far more of a site's real stack (client frameworks, hosting, and cookies) and labels each with its actual brand icon. You can file a scan's findings straight to GitHub as an issue from the VulnRadar GitHub Scanner. Underneath, the extension and the AI knowledge base are now built and verified in CI on every change, and the project gains a Code of Conduct, Discussions, and a Wiki.

### Changes
- [MessageSquare] **[ADDED]** **In-App Support Tickets for Every Plan**
  Support now lives inside the app. Any account, free tiers included, can open a ticket for a billing or scanning question and hold a threaded conversation with staff, who work them from a dedicated inbox. A ticket owner can share a single ticket with specific teammates (not the whole team) so they can read and reply, and every staff reply arrives as both an in-app notification and an email. The AI assistant stays the first line; tickets are the human escalation behind it.
- [FileDown] **[ADDED]** **Pull Any Scan's Report Straight from the API**
  Every finished scan can now be fetched as a formatted report from the API at /api/v3/history/[id]/report, in SARIF for code-scanning tools, PDF for sharing, Markdown for a pull request, a compliance summary, or raw JSON. The endpoint enforces the same owner and team-read access as the scan itself, so nothing private leaks through the report route.
- [FileSpreadsheet] **[ADDED]** **Compliance Reports Add HIPAA and GDPR**
  The compliance crosswalk that maps findings to controls now covers HIPAA and GDPR in addition to PCI DSS, SOC 2, ISO 27001, and OWASP ASVS, so a single scan can speak to whichever framework an auditor is asking about.
- [Radar] **[ADDED]** **Attack Surface Portfolio**
  A new Attack Surface page gathers the domains you have verified into one portfolio view, so a team can see its whole footprint in a single place instead of one scan at a time. It sits alongside history and reuses the verified-domain records you already have, so there is nothing new to set up.
- [Globe] **[ADDED]** **Browse Every Public Host, Not Just Your Own**
  The assets page gains a scope filter. It still defaults to the hosts you have scanned, but you can now switch it to every public host on file, synced to a scope value in the URL so the view is shareable. The all-hosts view reads only from public host records, so a private scan never appears there.
- [Layers] **[CHANGED]** **Deeper Tech-Stack Detection with Real Brand Icons**
  Software inventory used to read mostly server headers and a few HTML markers. It now recognizes far more of a site's real stack, including client frameworks (React, Vue, Svelte, Nuxt, Angular, and more), the base library behind a meta-framework (React under Next.js, Vue under Nuxt), hosting and edge providers, framework-specific cookies, and page-embedded analytics, monitoring, and anti-bot widgets (Cloudflare Web Analytics, Plausible, PostHog, Segment, Hotjar, Mixpanel, Sentry, Vercel Analytics, Intercom, reCAPTCHA, hCaptcha, Turnstile), and it labels each detected technology with its actual brand icon instead of a generic box.
- [GitMerge] **[ADDED]** **File Findings to GitHub as an Issue**
  From a scan's actions menu you can open a GitHub issue with the findings for that host, filed by the VulnRadar GitHub Scanner with clear labels and a readable summary, using the GitHub token already connected to your account. Only the scan's owner can file it.
- [Shield] **[ADDED]** **Cookie Notice**
  A dismissible notice explains that the site uses only the cookies it needs to work, with a link to the privacy policy. It sits at the bottom of the screen instead of blocking the page, and once dismissed it stays dismissed.
- [Bell] **[FIXED]** **The Notification Bell Shows on Every Signed-In Page**
  The bell was hidden on public pages like Contact, the changelog, docs, and pricing, so a signed-in user reading them lost access to their notifications and pending team invites until they navigated back into the app. The bell now appears wherever the signed-in header does, on every page you can reach while logged in.
- [LifeBuoy] **[CHANGED]** **Support Tickets Are a Contact Option, Not a Separate Panel**
  Opening a tracked support ticket is now one of the choices on the Contact page's category picker, alongside bug reports and billing, instead of a panel bolted to the bottom of the page. Contact itself also left the crowded top navigation; it stays in the footer under Resources. A ?ticket= link from a reply email or the notification bell still jumps straight to the right conversation.
- [Shield] **[SECURITY]** **New Support Tickets Pass a Captcha**
  Opening a ticket now clears a Cloudflare Turnstile check, verified on the server the same way the contact form is, so the ticket queue is protected from automated abuse. It is a no-op for deployments that have not configured Turnstile.
- [Lock] **[SECURITY]** **Dropped a Retired Live-Chat Vendor From the Security Policy**
  The content security policy still allowlisted the third-party live-chat widget the app used before its own AI assistant replaced it. Those vendor hosts, and the dead embed snippet, are gone, so the browser no longer trusts scripts, frames, styles, or connections from a service the app does not use.
- [Users] **[ADDED]** **Code of Conduct, Discussions, and a Wiki**
  The project gains a Code of Conduct, a Discussions space for questions and ideas, and a Wiki that points back to the app's own docs rather than duplicating them. The GitHub issue templates were also cleaned up so filing a bug, a detector request, or a docs fix uses the right fields.
- [Wrench] **[PERFORMANCE]** **More of the Project Is Verified in CI**
  Continuous integration now type-checks and builds the browser extension on every change, checks its formatting, and guards the AI assistant's knowledge base against drift by regenerating it and failing if the committed copy is stale. A broken extension build or an out-of-date knowledge file is now caught before it ships.
- [Network] **[FIXED]** **Session and Device Rows Always Show a Real IP**
  The client-IP lookup could store whatever a proxy put in the forwarded-for header, including an address with a port, IPv6 in brackets, an IPv4-mapped IPv6 prefix, or plain junk, so a session or device row occasionally showed a value that did not read as an IP. Every candidate is now validated and normalized (ports and brackets stripped, IPv4-mapped IPv6 unwrapped) before it is stored, and a header carrying no valid IP falls back cleanly instead of saving the raw text.
- [Fingerprint] **[ADDED]** **See a Usable IPv4 for IPv6 Sign-Ins**
  Signing in over IPv6 left the sessions list showing only an IPv6 address, which is hard to act on. When an operator configures an IPv4-only echo host, the app now captures the matching IPv4 for a dual-stack sign-in and shows it alongside the IPv6 on the security page. It is opt-in and privacy-preserving: the value is proven by a short-lived signed token the server minted after actually observing the address (not trusted from the browser), it never affects the session's own IP-binding, and an IPv6-only network simply records nothing.
- [Layout] **[CHANGED]** **Redesigned the Sign-In and Account Screens**
  The account screens shared a split layout that left a wide empty band between the left-hand pitch and the form. They now sit on one canvas: the pitch and the form are pulled into a single centered, balanced band so the empty room becomes even margin instead of a gap down the middle. Sign-in, sign-up, forgot-password, and reset-password all pick this up; the forms themselves are unchanged.
- [Lock] **[FIXED]** **Admin Panel Denies Non-Staff Instantly**
  Opening the admin panel without access briefly showed the panel's loading skeleton before flipping to Access Denied once the server's rejection came back. It now decides from your own signed-in role first, so a non-staff visitor gets Access Denied immediately with no flash of admin chrome; the server's check still has the final say.
- [Users] **[ADDED]** **Create a Team With Invites, and Act on Invitations In-App**
  Creating a team is now a dialog where you name it and invite teammates up front, capped at what your plan's seats allow, instead of a bare name field. And an invitation sent to you now shows up right on the Teams page with Accept and Decline buttons, so joining a team or turning one down no longer means digging up the email or the notification.
- [Menu] **[FIXED]** **Open Popovers Close When You Scroll, Everywhere**
  The scan form's check-family panels already closed themselves when the page scrolled (a fixed panel re-anchoring to its button on every scroll frame hitches on iOS). That behavior now lives in the shared popover component, so every popover across the app closes on scroll the same way instead of only that one screen. Scrolling a popover's own inner list still works; only a page scroll closes it.
- [CalendarClock] **[ADDED]** **Remediation Gets Due Dates and a Teammate Assignee**
  Per-finding remediation tracking now takes a due date, with an Overdue badge on anything past its date that isn't already fixed, accepted, or won't-fix. The assignee field became a picker of the people you share a team with (still free-typeable), so you can hand a finding to a real teammate instead of typing a name. Both are remembered across rescans, the same way the status already was.
- [CheckCircle2] **[ADDED]** **Set Remediation on Many Findings at Once**
  The findings list on your own scans now has checkboxes: select several findings and a bulk bar sets their status, and optionally an assignee or due date, in one action instead of opening each one. Applying a status leaves per-finding notes and any fields you didn't set alone, and the row badges update right away.
- [Wrench] **[ADDED]** **GitLab CI Scan Gate**
  The merge-request scan gate that shipped for GitHub Actions now has a GitLab CI equivalent: include one remote template, set the URL and a masked token, and the pipeline fails when a scan turns up findings over your critical, high, or medium thresholds. It polls the background scan job the same way, so it reads real severity counts rather than an empty create response. Documented under CI/CD Gating in the API docs.
- [FileText] **[ADDED]** **Machine-Readable OpenAPI Spec**
  The public API (scan lifecycle, history, and report export) now has an OpenAPI 3.1 description served at /api/v3/openapi.json. Import it into Postman, Insomnia, or Bruno, or point an interactive explorer at it. It documents the Bearer API-key auth and scopes, the request and response shapes, and the report formats, and it's linked from the API docs.
- [Code] **[ADDED]** **Scan From the Command Line**
  A dependency-free command-line tool joins the GitHub Action and GitLab template for gating on scans. It runs a scan, waits for it, prints the severity counts, and exits non-zero when findings cross your critical, high, or medium thresholds, so it drops into any CI or a local shell. Point it at a self-hosted instance with --api-base.
- [Share2] **[ADDED]** **Social Preview Link on Scan Results**
  A scan's More about this host section now links out to a third-party inspector for the page's Open Graph and social-share tags. It is a link-out on purpose: the engine stays focused on security, and the social preview is left to a tool built for it. The target service is a single swappable setting.
- [FileSearch] **[ADDED]** **Import an API Spec to Find Scan Targets**
  Send an OpenAPI 3, Swagger 2, or Postman collection to /api/v3/scan/import-spec and VulnRadar pulls out the concrete URLs to scan (server and base URLs plus non-templated paths), so you can push a whole API surface through a bulk scan. The document is parsed exactly as sent and never fetched from a URL, which keeps it off the SSRF surface.
- [Keyboard] **[ADDED]** **API Playground: Try Calls and Copy Them as Code**
  A new API playground at /docs/api/playground lets you send real requests to the API right from the browser: pick an endpoint, fill in the parameters and a body, paste an API key, and read the JSON response. Every call also renders as ready-to-run code in the language you pick (cURL, JavaScript, Python, Go, PHP, Java, Ruby, or C#), updating as you edit the request. It is driven by the OpenAPI spec so it never drifts from the API, your key is used only in your browser and never stored, and it is linked from the API docs and the landing page.
- [BookOpen] **[ADDED]** **Documentation Now Covers the Whole Product**
  The docs gained pages for Teams, Scheduled Scans, Triage and Remediation, Sharing and Public Pages, Account Security, GitHub Scanning, AI Features, Reports and Compliance, and the command-line tool (installable from the repo until it lands on npm), plus the previously undocumented self-hosting environment variables (Google and GitHub sign-in, IPv4 session capture, database pool tuning). Every new page uses the same layout as the rest of the docs, and because the in-app AI assistant reads the docs, it now knows about all of these too. Page titles and descriptions across the whole site were also tuned to the lengths search engines display.
- [Gauge] **[FIXED]** **Unlimited Scan Tiers No Longer Lock Themselves Out**
  Setting a plan's daily scan cap to -1 (the documented 'unlimited' value) used to do the opposite: it denied every scan on that tier. The unlimited sentinel is now resolved the same way whether or not billing is enabled, so an unlimited tier is genuinely unlimited.
- [Keyboard] **[ADDED]** **Skip-to-Main-Content Link**
  A keyboard-accessible 'Skip to main content' link now sits at the top of every page and is revealed on focus, letting keyboard and screen-reader users jump past the navigation straight to the page content. Each page's main region carries the matching landmark.
- [Lock] **[CHANGED]** **Privacy Policy Accuracy Pass**
  The privacy policy now lists Google sign-in alongside Discord and GitHub, describes the actual set of functional cookies (OAuth CSRF and pending-login cookies, the last-seen-version cookie) instead of a cookie that was never set, and discloses the 30-day retention of redacted system error logs. No behavior changed; the policy now matches what the app does.
- [ShieldCheck] **[SECURITY]** **Two-Factor Codes Can No Longer Be Replayed Within Their Window**
  A time-based one-time code is valid for a short window around the current 30-second step. The single-use guard now records the exact step a code matched rather than the wall-clock step, so a captured code can be used once and only once, closing a window where the same code could be accepted more than once.
- [ShieldAlert] **[SECURITY]** **Per-Account Login Lockout Against Distributed Brute-Force**
  Repeated failed logins against a single account now temporarily lock that account across every source IP, not just per IP. The counter that already tracked failures now actually gates sign-in (with an auto-expiring backoff) before the expensive password check runs, throttling a password-spray spread across many addresses.
- [Radar] **[FIXED]** **Concurrent-Scan and Crawl-Quota Races Closed**
  Firing many scans at once could slip past the concurrent-scan cap, and two crawls started together could each spend the same remaining daily quota and overshoot it. Slot reservation now happens atomically inside a per-user locked transaction, and each crawl page is charged against the daily quota with a capped, atomic increment, so neither limit can be exceeded by racing requests.
- [Shield] **[SECURITY]** **Active Probes Pinned Against DNS Rebinding**
  The CORS, HTTP-methods, X-Forwarded-Host, and open-redirect active probes now connect to the exact IP that passed the safety check, with the real hostname carried in a Host header, so a domain that re-points to an internal address between validation and the request can no longer redirect a probe at a private or metadata endpoint. These probes only ever run against domains you have verified you own.
- [Mail] **[FIXED]** **Changing Your Email Sends a Verification Link Right Away**
  Changing your account email resets its verified state (so the new address must be confirmed before it can be used to recover the account). It now sends the verification link to the new address immediately, instead of leaving you to discover you had to request one manually.
- [CreditCard] **[SECURITY]** **Credit Grants Verify the Amount Paid**
  One-time AI, GitHub, and Browserbase credit purchases now confirm the amount actually settled matches the tier's catalog price before granting credits, an extra guard on top of Stripe's signed webhook so a mismatched or tampered charge is refused and logged rather than credited.
- [FileText] **[FIXED]** **PDF Reports Stay Valid With Non-ASCII Content**
  PDF report cross-reference offsets are now computed from real UTF-8 byte lengths, so a report containing non-ASCII characters (internationalized domains, response banners, accented text) no longer produces a slightly corrupt cross-reference table that strict PDF validators reject.
- [Bell] **[SECURITY]** **Staff-Only Notices Stay Staff-Only**
  The endpoint that decides which admin-authored banners and bell notices you see now derives whether you are a staff member from your server session, not from a value the browser sends. Previously a request could ask to be treated as staff and receive staff- and admin-audience notices; that audience gate is now enforced server-side.
- [ShieldCheck] **[SECURITY]** **Stronger Password and Session Hygiene on Profile Changes**
  Changing your password from your profile now runs the same weak/common-password check as signup and reset, and clears your trusted devices (so a planted device can no longer keep skipping two-factor after a password rotation). Wiping the admin error-log trail and running the on-demand database cleanup are now restricted to full admins rather than lower staff tiers.
- [Globe] **[SECURITY]** **Safer Links Throughout the App**
  Every place the app turns a stored URL into a clickable link (admin-authored notification buttons, scanned target and subdomain links) now passes it through a scheme check, so only real web links open and a javascript: or data: URL can never execute on click. Exported Markdown and compliance reports also neutralize HTML in scanned evidence, so opening one in another viewer can't run embedded markup.
- [Bot] **[FIXED]** **AI Chat Conversation Saves Are Rate-Limited**
  Saving an AI support-chat transcript is now rate-limited per user (or per address for guests) and rejects oversized payloads before parsing them, so the endpoint can't be used to write unbounded rows.
- [Activity] **[FIXED]** **Readiness Check No Longer Leaks a Database Connection on a Slow Probe**
  When the readiness endpoint's database probe timed out under load, the pending connection could be left checked out, and repeated probes could exhaust the pool at exactly the wrong moment. The probe now always returns its connection to the pool.
- [Mail] **[FIXED]** **Landing-Page Contact Form Works Without a Captcha Configured**
  The landing-page contact form now only enforces the Turnstile captcha when Turnstile is actually configured, matching the other contact forms, so a self-hosted deployment without a captcha key can still receive messages.
- [GitMerge] **[FIXED]** **GitHub-Review Credits Are Now Spendable on the Free Plan**
  Buying GitHub AI-review credits on a plan with no built-in review allowance used to leave the balance permanently unspendable once the daily free review was used. Purchased credits now pay for reviews the same way they already did on higher plans, and each covered review debits the balance it should.
- [Bot] **[FIXED]** **AI Chat No Longer Spends Your Purchased AI Credits**
  The AI support chat is free and was never meant to draw down the AI credits you buy for finding verification, but heavy chat usage could quietly spend them. Chat now records its usage for visibility without ever charging the credit balance.
- [CreditCard] **[FIXED]** **Credit Purchases Can No Longer Be Lost to a Mid-Write Crash**
  Applying or reversing a one-time AI or GitHub credit purchase now happens as a single atomic database statement, so a server restart at exactly the wrong moment can no longer record the purchase while failing to add the credits (which previously stranded the balance with no way to recover it).
- [GitMerge] **[FIXED]** **A Free GitHub Review That Produces Nothing Is Refunded**
  If a free trial GitHub AI review can't run (no AI provider configured, or the repository is too large for one pass), the trial slot is now returned instead of being consumed for an empty result.
- [Gauge] **[FIXED]** **Rejected Scans No Longer Count Against Your Daily Limit**
  A scan that was turned away, for hitting the concurrent-scan limit, an invalid or blocked URL, an unverified domain, or a failed authenticated login, used to still spend one of your daily scans with no way to get it back. The daily count is now charged only once a scan has passed every check and actually starts.
- [Users] **[SECURITY]** **Cross-Tenant Team Admin Tightened to Admins**
  Listing and renaming any team from the admin panel now requires the admin-level team permissions, rather than being reachable at the moderator tier through the coarse role hierarchy.
- [ScanSearch] **[CHANGED]** **Demo Page Rebuilt on the Real Result View**
  The live demo now renders through the same result view the dashboard and history use, so it shows the full modern report (verdict, panels, and findings) instead of a stale, drifted layout. Subdomain discovery works on the demo too: it runs once server-side (or reads the cache) and displays read-only, with no refresh control.
- [ShieldCheck] **[CHANGED]** **Regression Tests Around the Anti-SSRF Fetch Guard**
  The request guard that stops the scanner from being redirected into internal networks or the cloud-metadata endpoint now has direct regression tests covering DNS resolution to private addresses, redirects to metadata and private hosts, cross-host redirects, DNS-rebinding on a same-host redirect, and fail-closed behavior on DNS failure, so a future change can't silently weaken it.
- [ServerCog] **[FIXED]** **A Stuck Scan Can No Longer Crash the Server**
  The watchdog that fails a scan which has run too long now handles a database error while doing so instead of letting it bubble up as an unhandled rejection, which on the wrong Node setting could terminate the whole process (precisely when the database was already struggling). One-line safety guard on a path every scan and crawl arms.
- [Shield] **[SECURITY]** **Demo Subdomain Discovery Is Cache-Only**
  The demo now reads cached subdomains only and never triggers a fresh passive-source or DNS brute-force sweep, so the anonymous demo endpoint can't be used to run outbound enumeration against an arbitrary domain from the shared server or to hold a request open on a live sweep.
- [CreditCard] **[FIXED]** **Browserbase Credit Grants Made Crash-Safe Too**
  The one-time Browserbase-minute credit ledger now applies and reverses purchases in a single atomic statement, matching the AI and GitHub credit ledgers, so a mid-write crash can't record a purchase while failing to add (or claw back) the minutes.
- [Gauge] **[FIXED]** **API-Key Scans Count Against the Daily Scan Limit**
  Authenticated scans triggered with an API key now count against your plan's daily-scan cap like every other scan, instead of being bounded only by the broader API request limit (which is unlimited on the top tier).
- [UserCog] **[SECURITY]** **Admins Can No Longer Act on Peer Admins**
  The role hierarchy is now enforced within the admin tier: an administrator can only disable, delete, demote, or force-reset accounts ranked strictly below them. Acting on a fellow admin requires the super admin, so no single admin can unilaterally remove the others.
- [Users] **[SECURITY]** **Tighter Gates on Cross-Tenant Admin Reads**
  Viewing an individual team's detail (owner and member emails) now requires the same admin-only permission as the team list, closing a path to enumerate every team by id. The active-admins panel (which shows staff IPs and action history) now requires the audit-log permission, and profile re-authentication for an email or password change now uses the strict login rate limit instead of the broad API limit.
- [ShieldAlert] **[FIXED]** **Blocked-Domain Deletion Can't Over-Match**
  Deleting scans for a blocked domain from the admin panel now escapes wildcard characters in the value, so a value containing % or _ can no longer expand into a pattern that deletes far more scan rows than intended.
- [Fingerprint] **[FIXED]** **Disconnecting a Sign-In Method Is Now Race-Safe**
  Removing a linked Google or GitHub account re-checks that another way to sign in remains, in the same atomic step that clears it, so two disconnect requests fired at once can no longer leave an account with no way to sign back in.
- [Bot] **[FIXED]** **AI Chat Requests Are Size-Bounded**
  The AI support chat now limits how much conversation history it forwards to the provider on each request, so an oversized or deeply-nested message list can no longer be used to run up usage.
- [Timer] **[PERFORMANCE]** **Faster Email Two-Factor Verification**
  Verifying an emailed two-factor code now reads the candidate codes in a single query instead of one lookup per candidate.

---

## v3.6.1 - August 21, 2026 **(highlights)**
**Billing Correctness, Discoverability, Mobile Live Viewer**

A polish and correctness release. Billing gets safer: a staff account can no longer be charged through Stripe for a plan their role already grants, a refund or chargeback now reverses the one-time AI, GitHub, and Browserbase credits it paid for, the admin MRR estimate stops overstating yearly subscribers, and the Stripe webhook registers every event those paths depend on. Search results and AI answer engines now see the full capability set, including the active injection testing (SQL injection, XSS, template and command injection) they had been underreporting. The live browser session viewer finally works on a phone, the scanner warns before scanning a page it cannot actually reach, and the browser extension (now 0.1.8) gains a real onboarding page, keyboard-accessible history, and an instant first paint.

### Changes
- [Crown] **[FIXED]** **Staff Plan Changes No Longer Open a Stripe Checkout**
  A staff or super-admin account holds its plan floor for free with no Stripe subscription, but the pricing page still offered to 'downgrade' them to a lower paid tier, which would have created a real subscription and charged them. Changing to any plan at or below that comped floor now updates the account in the database directly, with no Stripe checkout; genuinely paying up past the floor (an admin buying Elite) still goes through Stripe as before.
- [RefreshCw] **[SECURITY]** **Refunds and Chargebacks Reverse One-Time Credits**
  A Stripe refund or dispute on a one-time AI, GitHub-review, or Browserbase credit purchase left the purchased credits on the account, so a buyer could refund and keep the balance. Those events now claw the credits back, at most once per charge and floored at zero, so a partial spend never drives the balance negative.
- [BarChart3] **[FIXED]** **Admin MRR No Longer Overstates Annual Plans**
  The admin billing overview counted every active subscriber at the full monthly price, so a yearly subscriber (billed the discounted annual amount up front) inflated monthly recurring revenue by the annual discount. Yearly subscriptions are now amortized over twelve months, tracked by a new per-account billing interval recorded on every subscription write.
- [Key] **[FIXED]** **Stripe Webhook Registers Every Event It Handles**
  The webhook auto-setup registered fewer events than the handler actually acts on, so the backup credit-grant path and the new refund and dispute reversals only fired if the matching event happened to be registered already. It now registers payment_intent.succeeded, charge.refunded, and charge.dispute.created, and backfills them onto an existing webhook on the next boot.
- [Search] **[ADDED]** **Search and AI Answer Engines See the Full Capability Set**
  The landing FAQ, the SoftwareApplication structured data, and llms.txt now explicitly name the active injection testing (SQL injection, reflected XSS, server-side template injection, OS command injection, and open redirects) alongside the passive checks, so search results and AI answer engines stop reporting that the scanner cannot do them. A new 'Does it test for SQL injection and XSS?' FAQ renders on the page and as structured data. Separately, the auth-gated compare page was dropped from the sitemap and marked noindex so it stops showing up as a crawl error.
- [Globe] **[FIXED]** **Canonical URLs Always Point at the Production Domain**
  The fallback canonical, sitemap, robots, and Open Graph origin defaulted to a non-production host, so any build that forgot to set the public URL would have told search and answer engines the real site lived somewhere else. The default is now the production domain; self-hosted deployments still override it with their own.
- [Smartphone] **[FIXED]** **Live Browser Viewer Works on Phones**
  On a phone the live session's network panel opened by default as a full-screen overlay, burying the browser you came to watch. It now starts closed on small screens and opens as a bottom sheet over the lower half of the screen, with a grab handle and larger tap targets, while desktop still opens it docked to the side by default.
- [AlertTriangle] **[ADDED]** **Scanner Warns Before Scanning a Page It Cannot Reach**
  Pointing the scanner at a search engine, or at a page that immediately redirects somewhere else (for example a dashboard that bounces you to a login), used to scan the wrong thing silently. It now recognizes these cases, explains why the exact page cannot be scanned, and asks whether to proceed, in both the app and the extension. When a supplied login actually works and the page returns normally, no warning is shown.
- [Package] **[FIXED]** **Extension: Onboarding, Keyboard Access, Instant First Paint (0.1.8)**
  First install now opens a proper step-by-step onboarding page instead of the raw settings screen. Scan-history rows are operable by keyboard and screen readers, not just the mouse. The popup paints its themed shell immediately with a 'Connecting...' state instead of a blank flash while it authenticates, and the footer version reads from the manifest so it can never drift from the shipped build.
- [ServerCog] **[FIXED]** **Background Worker Escalation Survives Restarts**
  The background worker tracked its consecutive-failure streak only in memory, so a restart reset the count and could re-send or drop a failure-escalation alert. The streak is now persisted, so escalation state is continuous across restarts.
- [Mail] **[FIXED]** **Admin Broadcasts Dedupe Recipients and Confirm Delivery**
  An admin broadcast marked itself sent before delivery and could email an account more than once when the same address appeared through multiple records. It now dedupes recipients and only records a broadcast as sent after the send actually completes.

---

## v3.6.0 - August 20, 2026 **(highlights)**
**Security and Detection Hardening, Live Browser Redesign**

A security and correctness release. Several ways to slip past the daily scan quota or get billed twice for API scans are closed, sign-in is now tied to the browser that started it, and team roles can no longer be pushed above your own. The scan engine is hardened against pages built to hang it, and a batch of detection fixes stop it from misreading cookie flags, SPF, DMARC, CSP, and TLS chains (Detection Engine bumped to 3.3.1). On the surface, the live browser session viewer is rebuilt to look like a real browser window with the network panel open and streaming, the extension can open in a full resizable tab, and a scan's reported duration finally matches how long you actually waited.

### Changes
- [ShieldAlert] **[SECURITY]** **Closed a Daily Scan Quota Bypass**
  Crawl scans recorded each page's usage in a row the single and bulk scan gate never read, so running a crawl plus a normal day of scans could add up to roughly double a plan's daily cap. Every scan type now counts against one shared daily counter, and a crawl no longer over-charges by a page.
- [Key] **[FIXED]** **API Scans No Longer Billed Twice**
  Each API-key scan counted against the key's daily rate limit twice: once to admit the request and once more to build the response headers. A 50-per-day key was effectively exhausted after 25 scans. The single admission check now supplies the headers too, and the bulk endpoint's early exhaustion check no longer burns a phantom slot.
- [Fingerprint] **[SECURITY]** **Sign-In Is Bound to the Browser That Started It**
  OAuth sign-in and sign-up state carried no per-browser binding, so a valid sign-in link captured by an attacker could be delivered to someone else and silently log them into the attacker's account (login CSRF / session fixation). Starting a sign-in now sets a short-lived, http-only nonce that the callback requires to match before creating a session.
- [UserCog] **[SECURITY]** **Team Roles Cannot Be Escalated Past Your Own**
  A member who could manage members but not manage scans was able to promote someone to admin (handing out a permission the promoter did not have) and to demote or remove higher-privileged admins. Inviting, changing, and removing roles is now capped to roles whose permissions are a subset of your own.
- [Gauge] **[SECURITY]** **Scanner Hardened Against Pages Built to Hang It**
  A response body crafted with thousands of unclosed tags could drive the directory-listing check and dozens of tag and attribute patterns into catastrophic regex backtracking, blocking the scan worker for tens of seconds on a single page. Those patterns are now bounded and run in linear time, so a scanned page can no longer stall the engine.
- [ScanSearch] **[FIXED]** **Detection Correctness: Cookies, SPF, DMARC, CSP, TLS, MTA-STS**
  Cookie flag checks matched the flag name anywhere in the header, so a cookie with Domain=secure.example.com read as having the Secure flag; they now match the actual attribute token. SPF stopped inflating its DNS-lookup count (which false-flagged healthy Microsoft 365 domains) and now follows underscore-prefixed includes. DMARC no longer reads sp=none as p=none, CSP no longer mistakes script-src-elem for script-src, the incomplete-certificate-chain check actually fires now, and MTA-STS reads its enforcement mode from the policy file where it actually lives. Detection Engine is now 3.3.1.
- [Layout] **[ADDED]** **Live Browser Session Viewer, Rebuilt**
  The remote browser viewer now frames the live page as a real browser window, complete with an address bar showing the site you are on, on a proper workspace backdrop. The network panel opens by default and streams new requests every few seconds instead of hiding behind a toggle, and reads like a real devtools Network tab.
- [Package] **[ADDED]** **Open the Extension in a Full Tab**
  The browser extension popup can now open as a full, resizable browser tab from its footer. A toolbar popup is size-locked by the browser, so this is the roomy view for reading a full report; it carries the current site across so the tab scans the same page you were looking at.
- [Timer] **[FIXED]** **Scan Duration Now Matches the Wait**
  A scan that captured a page screenshot reported only the time the security checks took (for example 1.8s) even though you waited for the screenshot to finish too (for example 11s), so the result and the loading screen disagreed. The reported duration now spans the whole job, matching what you actually waited.
- [Eye] **[SECURITY]** **Bulk API Scans Honor 'Private by Default'**
  A bulk scan submitted over the API from an account set to keep scans private published every URL's findings to the public host pages, because the bulk path defaulted to public regardless of the account setting. It now resolves privacy the same way every other scan path does, so the account default is respected.
- [Shield] **[FIXED]** **Account Deletion, Contact Form, Team Webhooks, Session Cleanup**
  Deleting an account now erases its AI-assistant conversation history immediately rather than leaving the content behind with only its owner removed. The contact form validates the email address before sending a confirmation to it. Webhooks assigned to a team now fire for a teammate's scans, not only the creator's. And a browser session whose ownership record failed to save is torn down instead of leaking a concurrency slot and unbilled minutes.
- [List] **[FIXED]** **History View Polish**
  Owner-only controls no longer appear for a signed-out viewer looking at a public scan, deleting the scan you have open now clears it from the address bar so Back does not bounce through a missing record, and the page counter no longer shows an impossible range after the list shrinks beneath the page you were on.

---

## v3.5.1 - August 20, 2026
**Updater Stale-File Cleanup, Build Warning Fix**

A patch release focused on the self-updater. It used to overlay a new release's files without ever removing ones an update had deleted, so a renamed-away module could linger and break the next build after updating. The updater now mirrors the release: files it no longer ships are removed, and dev-only files a running install has no reason to keep are stripped, while your environment file, database backups, uploaded data, dependencies, and build cache are always preserved. Separately, the Tailwind config was renamed so the build no longer prints a Node module-type warning.

### Changes
- [RefreshCw] **[FIXED]** **Updater Now Removes Stale and Unneeded Files**
  The in-app updater overlaid new files but never deleted ones a release had dropped, so a module renamed or removed upstream could linger and break the next build after an update. It now mirrors the release: files no longer shipped are removed, and dev-only files a running install does not need (test suites, CI config, the browser-extension source, and the license/contributing docs) are stripped. Your .env files, database backups, uploaded data, node_modules, and build cache are always preserved and never touched.
- [Wrench] **[FIXED]** **No More Tailwind Config Build Warning**
  The Tailwind theme config was renamed to a form Node reads unambiguously, so the build no longer prints a MODULE_TYPELESS_PACKAGE_JSON warning. Cosmetic only; the generated CSS and build output are unchanged.

---

## v3.5.0 - August 17, 2026 **(highlights)**
**Domain Verification, Live-Browser Metering, Quota Bypass Fixes**

Active-probes scanning (real exploit-attempt payloads, not just passive checks) now requires proving you own the target domain first, via a DNS TXT record, the same model Google Search Console and ACME certificate issuance use. Three of the existing active probes (CORS origin reflection, dangerous HTTP methods, X-Forwarded-Host injection) turned out to run unconditionally on every scan instead of being gated behind that opt-in, so they're fixed alongside two new ones: OS command injection and open redirect. Live-browser sessions are now a real metered plan limit with an account-wide concurrency queue instead of an unbounded feature, and dependency scanning gained a live OSV.dev lookup on top of the old static CVE table. The rest is a run of real quota and account-safety bugs found by auditing every per-plan limit end to end: the daily scan quota was fully bypassable via API key, never enforced on crawl scans at all, and a rejected scan could still permanently burn a quota slot; the bulk-scan URL limit ignored your actual plan; and account deletion was completely broken for every account, full stop. Results also grew a lot richer this release: multi-source threat reputation, a curated open-port sweep, opt-in page screenshots, a software inventory with CVE correlation, and remediation status that survives rescans, all shown consistently on your own, shared, and public result pages. Authenticated scanning and crawling now reach the pages behind a login, credentials never leaving memory for the request, and compliance-mapping reports line findings up against PCI DSS, SOC 2, ISO 27001, and OWASP ASVS as prioritization guidance, not certification.

### Changes
- [ShieldCheck] **[ADDED]** **SSL/TLS Letter Grade**
  Every scan of an HTTPS site now gets an SSL Labs style letter grade, A+ down to F, computed from the negotiated protocol, the certificate's validity and chain, key strength, and the negotiated cipher. It sits next to the risk score on the result and carries through to shared result pages.
- [Network] **[ADDED]** **Full DNS Records on Every Result**
  Scans now capture the domain's full DNS record set (A, AAAA, MX, NS, TXT, CAA, SOA) as a structured, copyable panel, instead of only reading those records internally to raise findings. It appears automatically on your results and on shared ones.
- [ScanSearch] **[CHANGED]** **Subdomains Are Discovered Automatically**
  Subdomain discovery used to be a button you had to press. Now every scan runs it automatically, so a finished result already lists the related subdomains it found, with the same certificate-transparency, passive-DNS, and brute-force sources as before.
- [Network] **[CHANGED]** **More Subdomain Discovery Sources**
  Subdomain discovery now aggregates nine free, no-key passive sources (crt.sh, AlienVault OTX, certspotter, urlscan, the Wayback Machine, and more) on top of the DNS brute-force, each self-bounding so one slow or rate-limited source can never stall or empty the results. That surfaces far more related hosts, including ones that do not currently resolve, which show up under the unreachable list.
- [Radar] **[CHANGED]** **Deeper Crawls With Sitemap Discovery and Higher Page Limits**
  Crawl page discovery now reads the site's sitemap (sitemap indexes and robots.txt references included) and follows links up to three levels deep instead of one, so nested pages are actually found. It surfaces up to 500 pages instead of stopping at 20, while how many you can scan at once follows your plan (25 on the free tier). Crawls stay on the one application's own pages, never subdomains or other hosts.
- [Crosshair] **[CHANGED]** **Active Probes Are Now Nine Separate Toggles**
  The single active-probing switch became nine independent, individually selectable probes (reflected XSS, SQL injection, template injection, command injection, open redirect, GraphQL introspection, CORS reflection, dangerous HTTP methods, X-Forwarded-Host), each with a plain description of what it sends. Each is off by default and still held to the same verified-domain requirement.
- [FileDown] **[ADDED]** **Markdown Report Export**
  Scan results now export as Markdown alongside JSON, CSV, SARIF, and PDF: a clean report grouped by severity with fix steps, ready to paste straight into a pull request, issue, or wiki.
- [Mail] **[CHANGED]** **Every Email Redesigned**
  All transactional emails were rebuilt on one consistent, brand-colored layout and rewritten in plain, specific language, replacing the old one-size template and its rhetorical-question boxes. Colors now come from a single brand source, so an email can no longer drift off-palette.
- [CreditCard] **[ADDED]** **Billing and Account Emails You Were Missing**
  Payments and subscription changes were completely silent before. You now get a receipt on every successful payment, a heads-up when one fails, and a note when your plan is upgraded, downgraded, canceled, or renewed, plus confirmations for account deletion, sign-out-everywhere, and team membership changes.
- [Fingerprint] **[SECURITY]** **Scan History Links Are No Longer Sequential**
  A scan's link used a plain counting number, so anyone could guess neighboring scans by changing it. Every scan, old and new, now carries a random, non-guessable id in its link. Existing bookmarks and the History tab keep working exactly as before.
- [ServerCog] **[FIXED]** **Service Probes Now Report on Every Scan**
  Service probes (SSH, SMTP, IMAP, POP3, FTP, MongoDB banner grabs) were silently dropped on deep and crawl scans, and showed nothing on a normal site whose ports are closed. They now run on every scan type, and each probe you select always reports back: the banner it found, or a plain note that no service was reachable on that port so you can see it ran.
- [List] **[CHANGED]** **Every Scan Option Explains Itself**
  Each check family and service probe in the scan options now shows a one-line description of what it does, and the selector shows an exact count of what is enabled instead of a vague "All" that hid whether the opt-in active probes were part of it.
- [Database] **[FIXED]** **Database Backups in the Admin Panel**
  The finished database-backup tool was fully built but had no way to open it. It now has its own admin tab: run a backup, watch its status, and review past backups and their logs.
- [FileSearch] **[ADDED]** **A Fix Guide for Every Check**
  Every one of the scanner's checks now has its own reference page explaining the issue, why it matters, and how to fix it with copyable examples, alongside per-category overviews and honest comparison pages. Useful on its own, and it helps people find VulnRadar when they search for the specific problem they are hitting.
- [Globe] **[ADDED]** **Domain Ownership Verification**
  Active-probes scanning (form-submission canaries, CORS/method/host-header probes, GraphQL introspection) now requires verifying you control the target domain first: publish a one-time token as a DNS TXT record, then confirm it. Verifying a domain covers its subdomains, matching how DNS-zone-control verification works everywhere else. Manage domains from Profile > Developer.
- [ShieldAlert] **[SECURITY]** **Three Active Probes Ran on Every Scan, Not Just When You Opted In**
  CORS origin reflection, dangerous HTTP method, and X-Forwarded-Host injection checks each submit a crafted request to the target instead of only reading a response already fetched for another check, the same category of action GraphQL introspection was already correctly gated behind. These three weren't: they ran unconditionally on every scan, including ones that never asked for active probing. Moved behind the same active-probes opt-in and domain-verification requirement as every other active check.
- [Target] **[ADDED]** **Two New Active Probes: Command Injection & Open Redirect**
  Command injection uses a shell-metacharacter canary tagged with an arithmetic expression, flagging a form only when the expression comes back genuinely evaluated by a shell, not just echoed back as text. Open redirect never guesses an endpoint blindly: it only probes a redirect-shaped parameter (redirect, next, return_to, and similar) that the page itself already discloses using, then checks whether swapping in a canary URL produces a live redirect to it.
- [Package] **[ADDED]** **Live Dependency Scanning via OSV.dev**
  Client-side library detection (jQuery, Bootstrap, Lodash, Vue, React, and others) now queries OSV.dev live for the exact detected version, instead of relying only on a small, hand-picked table of CVEs frozen at whatever was known when it was written. Findings carry real per-instance CVSS scores parsed from OSV's own advisory data when available.
- [Timer] **[ADDED]** **Live-Browser Sessions Now Have an Account-Wide Concurrency Queue**
  This account's own BrowserBase plan has a real ceiling on how many live-browser sessions can run at once, independent of any one user's monthly minute allowance, and nothing previously tracked it. A request that arrives once that ceiling is hit now queues automatically (paid plans admitted ahead of free) instead of failing outright.
- [CreditCard] **[ADDED]** **Live-Browser Minutes Are a Real, Metered Plan Limit**
  Monthly minute allowances (30/60/150/400 for free/core/pro/elite) replace what was effectively unbounded usage, sized conservatively against this account's actual BrowserBase plan so a handful of accounts can't burn a shared monthly budget on their own. Extra minutes can be purchased in Profile > Billing once the free allowance runs out.
- [Gauge] **[ADDED]** **Concurrent-Scan Capacity Limit**
  How many scans a single account can have running at once (1/2/3/5 for free/core/pro/elite) is now a real, enforced plan limit, separate from the daily scan quota. VulnRadar runs as one server process, not a fleet of workers, so every scan actually in progress shares that process's resources with everyone else's.
- [RefreshCw] **[SECURITY]** **Periodic Domain Re-Verification**
  A verified domain's active-probes permission never expired or got re-checked, so a domain that later changed hands (sold, expired, DNS repointed) kept the original account's scan permission for it indefinitely. Verified domains are now re-checked roughly every 30 days in the background, and permission is automatically revoked the moment the DNS record no longer verifies.
- [Search] **[ADDED]** **Adaptive Confidence Scoring**
  A check with a real, statistically meaningful false-positive rate from user feedback (the same signal the admin Engine Feedback panel already surfaced, previously reporting-only) now has its findings' confidence automatically discounted. A check most users confirm as accurate is untouched either way.
- [Bug] **[FIXED]** **Domain Verification Crashed on Every Failed Attempt**
  Checking a domain that hadn't actually had its DNS record set up yet failed with a database error instead of a normal "not verified yet" response, because the update query reused the same parameter as both a plain value and a comparison inside a CASE expression, which Postgres can't always resolve to one type. Reproduced and confirmed fixed against the real database.
- [AlertTriangle] **[FIXED]** **Bulk-Scan URL Limit Ignored Your Actual Plan**
  The dashboard's bulk-scan box capped entry at a flat 10 URLs for every plan, regardless of the pricing page's advertised 5/10/25/100 tiers: free accounts could enter more than promised, paid accounts less. The form now reads the caller's real, live plan limit instead of a hardcoded number.
- [Bug] **[FIXED]** **A Rejected Scan Could Still Burn a Daily Quota Slot**
  Hitting your daily scan limit and trying one more time bumped the stored count past the limit (25/25 becoming 26/25) even though that scan never actually ran, because the counter incremented unconditionally before checking whether the new total was over the cap. Every rejected attempt afterward kept inflating it further. Fixed at the query level so an already-exhausted quota is never touched at all.
- [ShieldAlert] **[SECURITY]** **Daily Scan Quota Was Bypassable via API Key, Unenforced on Crawls**
  Found by auditing every per-plan limit's real enforcement end to end. An API-key request to trigger a scan was bounded only by the key's own request-rate limit (unlimited on the top plan), never by the actual daily-scans cap every plan advertises, and crawl scans never checked the daily quota at all, for either auth method, despite one crawl being able to trigger many page scans. Both routes, and the bulk-scan endpoint's own separate copy of the same gap, now enforce the real quota atomically regardless of how the request is authenticated.
- [Trash2] **[FIXED]** **Account Deletion Was Completely Broken**
  The delete-account button sent the wrong HTTP method with no request body to an endpoint that required one, so every deletion attempt failed outright for every account, regardless of type. Fixed the request, and while in that code: an account with no password set (Google/GitHub/Discord sign-up) could never have deleted itself either way, since there was nothing to verify a password against. It no longer needs one.
- [GitMerge] **[CHANGED]** **Active Probing Reorganized Into Modules**
  The single 470-line file behind every active probe is now one module per probe under lib/scanner/active-probes/, sharing common request/cancellation/finding-building infrastructure, so a new probe no longer means editing one increasingly large file.
- [ShieldAlert] **[ADDED]** **Multi-Source Threat Reputation on Every Scan**
  Every scan now checks the target against several threat-intelligence sources at once (URLhaus, Google Web Risk, and Quad9's security DNS), shown as a reputation panel on the result. A source that cannot be reached reads as "unavailable" rather than a false all-clear, so an outage never looks like a clean bill of health.
- [Image] **[ADDED]** **Opt-In Page Screenshots**
  A scan can now capture a screenshot of the page it scanned, rendered in a real browser and shown as a collapsible preview that carries through to shared and history views. Off unless you ask for it, since it spins up a metered live-browser session, and re-capturable on demand.
- [Server] **[ADDED]** **Curated Open-Port Sweep**
  An opt-in sweep of common service ports reports which are open, with any banner it grabbed, and lists the checked-but-closed ports in a separate collapsed section instead of flooding the findings list. Held to the same verified-domain requirement as active probing, since it makes this server a scan source against the target.
- [Layers] **[ADDED]** **Software Inventory With CVE Correlation**
  Results now include a structured inventory of the software the scan fingerprinted on the host, each component with its category and, where a version is known, a CVE verdict from correlating that version against known advisories. Version-with-known-CVEs items also raise real findings in the list above.
- [CheckCircle2] **[ADDED]** **Remediation Status That Survives Rescans**
  Mark a finding fixed or accepted-risk and that status now persists across future scans of the same target, so a rescan shows what you have already triaged instead of resetting every finding to new. Previously the only per-finding signal was accuracy feedback.
- [FileText] **[ADDED]** **Compliance Mapping Reports**
  Export a report that maps your scan's findings to common frameworks (PCI DSS, SOC 2, ISO 27001, OWASP ASVS) to show where you stand at a glance. Clearly labeled as guidance to prioritize work, not a certification or an audit.
- [Lock] **[ADDED]** **Authenticated Scanning and Crawling**
  Scan the pages behind a login, not just the public ones: supply a session cookie, an auth header, or real form credentials, and the scanner authenticates once and scans, or crawls the whole site, as a logged-in user. Credentials live only in memory for that one request, never written to the database, a log, or any response, and an authenticated scan stays private unless you explicitly publish it.
- [RefreshCw] **[ADDED]** **Refresh DNS, Ports, Subdomains and Screenshots on Demand**
  The DNS, open-ports, subdomain, and screenshot panels each show how long ago they were captured and when a fresh pull is next available, with a one-click refresh that updates the result in place. On-demand refresh is a Pro feature, gated on the server so it cannot be bypassed from the page.
- [Columns3] **[CHANGED]** **Every Result Surface Shows the Same Panels**
  The DNS, ports, subdomains, screenshot, reputation, SSL grade, and software-inventory panels now render identically on your own result, its history entry, a shared link, and the public host page, so a shared or saved result is as complete as the one you first saw. Authenticated scans also show the risk score and engine confidence, not just a duration.
- [Smartphone] **[FIXED]** **Mobile Fixes for Notifications and Screenshots**
  Site notifications (banner, modal, and toast) and the page-screenshot preview were cramped or overflowed on phone-width screens. They now wrap, stack, and size to the viewport, and a notification modal with a corner close no longer also shows a redundant dismiss button.
- [Layout] **[FIXED]** **Dashboard Recent Scans and Result Links**
  The dashboard's recent-scans list now fits all six entries without scrolling, and finishing a scan lands on a clean, shareable ?scan= result link instead of leaving the long scan-option URL sitting in the address bar.
- [Fingerprint] **[SECURITY]** **Screenshot Links Use the Opaque Scan Id**
  The page-screenshot image link carried the internal sequential scan number; it now uses the same random, non-guessable id the result links already do, so a screenshot URL gives away nothing about how many scans exist or which ids are real.
- [Image] **[CHANGED]** **Uploaded Avatars Moved Into the Database**
  Uploaded profile pictures were stored as files on disk with a base64 fallback on serverless, a second image-storage mechanism alongside the database-backed screenshots. They now live in one place, the database, served through the same access-controlled route, and existing avatars convert over automatically on the next start. Sign-in pictures from Google, GitHub, and Discord stay as their own provider URLs.
- [Database] **[FIXED]** **Backups Encrypt by Default and Fail Loudly Without pg_dump**
  Database backups fell back to plaintext when only the base encryption key was set. They now encrypt with that base key automatically, and restores understand the same fallback, so a separate backup key is optional rather than the only thing standing between you and an unencrypted dump. A backup on a host that has no pg_dump (like a minimal Node container) now reports a clear "install postgresql-client" message instead of failing silently, and the self-hosting docs and .env.example spell out every backup setting.
- [ShieldAlert] **[CHANGED]** **Engine Version 3.3.0**
  The scanning engine's version number moved to 3.3.0: two new active probes, a new live dependency-vulnerability check, and confidence scores that now adapt to real user feedback instead of staying static forever.

---

## v3.4.0 - August 15, 2026 **(highlights)**
**Team-Scoped Resources, Admin Security Hardening**

A big one. Scans, webhooks, and scheduled scans can now be shared with a team instead of only living under one account, with real owner/admin/member/viewer permissions behind it. Alongside that: a proper audit of the admin panel's own security turned up and fixed a handful of real gaps, including a route that skipped 2FA enforcement entirely and a password re-entry prompt that was never actually checked server-side. A broader sweep for the same underlying bug, UI that claims success without checking whether the request behind it actually succeeded, found and fixed a dozen more instances across the admin panel, checkout, scan history, and every copy-to-clipboard button in the app. On top of that: roughly 1,200 real sites got bulk-scanned specifically to hunt down false positives at scale, the browser extension went live on both the Chrome Web Store and Firefox Add-ons, and self-hosted instances now get an automatic database backup before every migration plus an admin alert if a background worker starts failing silently.

### Changes
- [Users] **[ADDED]** **Team-Scoped Scans, Webhooks & Schedules**
  Assign a scan, webhook, or scheduled scan to a team instead of keeping it personal. Team members get access based on their role: owner, admin, and member can manage a shared resource, viewer can see it but not touch it. Re-assigning which team a resource belongs to always stays with the resource's own owner.
- [Crown] **[ADDED]** **Formal Super-Admin Protection (god_mode)**
  The account that can never be modified by anyone else (including a full admin) now runs on a single named permission instead of scattered role checks, and it's applied everywhere team sharing touches an account, not just the existing admin-panel guards.
- [Lock] **[FIXED]** **Admin Team Management Skipped 2FA Enforcement**
  The routes admins use to rename or delete any team on the platform had their own, separate permission check that verified role but never checked whether two-factor authentication was actually enabled, silently bypassing the "require 2FA for staff" setting other admin actions respect. Fixed to go through the same enforcement every other admin route uses.
- [Trash2] **[SECURITY]** **Removed Bulk User Actions**
  The admin Users tab let staff select many accounts at once and role-change, disable, or permanently delete up to 200 of them in a single confirmed request. That concentrates a lot of blast radius behind one compromised admin credential, with password re-entry as the only extra gate, which does nothing if an attacker actually has the password. Removed entirely: every action on a user account is single-target now, the same as any other admin route.
- [Key] **[FIXED]** **Admin Panel Showed a Generic Error When 2FA Was the Real Reason**
  A staff account locked out of /admin by the "require 2FA for staff" setting saw the exact same "Access Denied" screen as someone with no admin access at all, a dead end with no indication that turning on two-factor authentication would fix it. That specific case now shows its own screen explaining why and linking straight to Profile > Security to set it up.
- [UserCog] **[FIXED]** **Super Admin's Role Displayed as "User" on the Edit Screen**
  The role dropdown on a user's admin detail page listed 8 assignable roles but not super_admin, so viewing a super admin's own account showed the dropdown falling back to whatever the browser picks when a select's value matches none of its options: "User", the least-privileged one, the opposite of reality. The dropdown now displays "Super Admin" correctly and is disabled outright for that account, since the role was already non-assignable server-side.
- [Lock] **[ADDED]** **This App Now Redirects Plain HTTP to HTTPS Itself, Not Just the Proxy**
  HTTPS termination is expected to happen in front of this app (Cloudflare, nginx, Caddy), and that front door is expected to redirect HTTP to HTTPS on its own. Not every self-hosted setup gets that configured, though. The app now does it too, reading the reverse proxy's own X-Forwarded-Proto header, so a misconfigured front door no longer means plain-HTTP traffic reaches all the way to the app unredirected.
- [ScanSearch] **[FIXED]** **Scanner Options Panel Closed the Instant You Tried to Scroll It**
  A fix for an iOS Safari scroll hitch closed the Check Families / Active Probing popovers on any page scroll, but the listener couldn't tell the outer page scrolling from the popover's own internal list being scrolled, so scrolling that list closed it immediately, making a list longer than the visible area impossible to actually look through. Now only an actual page-level scroll closes it.
- [Eye] **[FIXED]** **Impersonate User, Finished**
  An admin can now actually start and stop an impersonation session for a support case, complete with a hard 1-hour session cap, a banner while it's active, and a one-click way back to your own account. The password re-entry prompt this action shows was previously cosmetic: the server never checked what was typed. It's enforced now.
- [Bug] **[FIXED]** **Confirm Dialogs and Action Buttons Could Show Success on a Rejected Action**
  Several confirmation dialogs and plain action buttons across the admin panel, account settings, and scan history flipped to their "success" state as soon as the underlying request finished, even when the server had just rejected it: a failed badge delete still closed its confirm dialog, a failed impersonation-stop still navigated away as if it had ended, a failed "clear all history" still emptied the list on screen. All of them now check the actual result first, and stay open with a real error shown instead of dismissing themselves.
- [Copy] **[FIXED]** **Copy Buttons Could Show "Copied" When Nothing Was Copied**
  Every copy-to-clipboard button in the app, share links, API keys, webhook secrets, badge embed code, scan URLs, called the clipboard API and immediately showed its checkmark regardless of whether the write actually succeeded, so a denied permission or an insecure context (plain HTTP, an embedded iframe) still read as "Copied." Consolidated into one shared helper that awaits the real result and only confirms on an actual success.
- [CreditCard] **[FIXED]** **Subscription Checkout Could Show Success Before the Plan Actually Changed**
  After paying, the checkout success page polled for up to ~17.5 seconds waiting for the new plan to show up, then displayed "You're on your new plan" regardless of whether it ever did. A slow webhook or a still-settling payment method could show that screen while the account was still on its old plan. It now shows a genuine "still confirming" state instead, with a link to Billing, until the plan is actually confirmed.
- [Mail] **[FIXED]** **Mass-Email Preview Showed Escaped HTML Instead of the Real Formatting**
  The broadcast-email composer's Content field is explicitly labeled "HTML supported," but its preview escaped every tag before rendering, so writing bold text showed the literal, escaped tag characters in preview while the actual sent email rendered correctly. The preview now renders the same way the real email does, and its iframe is sandboxed as a second layer of protection since it runs inside the admin's own authenticated session.
- [Settings] **[FIXED]** **A Few Displayed Values Had Drifted From Their Own Source of Truth**
  The team invite role dropdown listed its five roles by hand instead of reading them from the same list the backend validates against, so a new role would not have shown up here even though the API would have accepted it. Separately, a gifted-subscription plan name was built by string-replacing the plan id instead of reading its real display name, which was already visibly wrong for one plan ("gifted elite subscription" instead of "Elite Supporter"). Both now read from the actual plan/role catalog.
- [Link2] **[FIXED]** **Checkout Pages Could Redirect to a Dead Route on a Network Blip**
  All three checkout pages correctly sent a signed-out visitor to Login when the auth check came back unauthorized, but a network failure on that same check, as opposed to an auth failure, fell back to a hardcoded path that no longer exists, landing on a 404 instead of the login page.
- [Mail] **[ADDED]** **Admin Password Resets Now Go Out By Email**
  Resetting a user's password from the admin panel used to generate a temporary password the admin could see. It now emails the user a reset link instead, the same as a self-service reset, and includes a searchable delivery log (with any link, code, or token redacted) so staff can confirm an email actually went out without ever seeing its contents.
- [BarChart3] **[ADDED]** **CVSS 3.1 Scoring on Every Finding**
  Every finding now carries a real CVSS 3.1 base score and vector string computed from the actual FIRST.org formula, not a hand-picked number, so severity can be compared against other tools and fed into whatever process already consumes CVSS elsewhere.
- [ShieldAlert] **[ADDED]** **Active Probing: SQL Injection & Template Injection**
  The opt-in active-probing category (real requests submitted to the target, off by default) now checks for error-based SQL injection and server-side template injection alongside the existing reflected-XSS canary probe.
- [GitMerge] **[ADDED]** **GitHub Actions Scan Gate**
  A ready-to-use GitHub Action that scans a URL and fails the build if findings cross a severity threshold you set, so a scan can gate a pull request without writing your own polling loop against the API.
- [Globe] **[ADDED]** **Extension: Live on the Chrome Web Store**
  The browser extension is now installable straight from the Chrome Web Store instead of a manual unpacked-folder install.
- [Bell] **[ADDED]** **Site Notifications Support a Second Action Button**
  A site-wide notification (banner, modal, toast, or bell) can now carry up to two action buttons instead of one, e.g. "Add to Chrome" next to "Add to Firefox" on the same announcement.
- [Wrench] **[FIXED]** **Extension: Auto-Scan URL Filters Could Be Resized Away**
  The whitelist and blacklist text boxes in the extension's Auto-Scan settings had no minimum or maximum height, so dragging the resize handle could shrink one down to a sliver or blow it up past the rest of the page. Now clamped to a sensible range.
- [Code] **[ADDED]** **Try It Live on the API Reference**
  Every documented GET endpoint on the API Reference page now has a live request panel: paste an API key, fill in the parameters, and see the real response, status, and timing without leaving the docs.
- [BellRing] **[ADDED]** **AI Verification and Summaries Now Work With an API Key**
  POST /scan/verify and POST /history/{id}/summary previously only accepted a logged-in session, so a script using an API key could get an AI verdict on a finding but never persist it, and couldn't generate a scan summary at all. Both now accept a Bearer API key with the scan:write scope, the same as every other scan-management endpoint.
- [Bug] **[FIXED]** **Detection Engine v3.2.1: False-Positive Hunt at Scale**
  Bulk-scanned roughly 1,200 real sites (popular third-party hosts plus VulnRadar's own site, both public and behind login) and grouped findings by title and host to spot systemic false positives instead of one-offs. Fixed: exposed-panel checks (Jenkins, Consul, MinIO, phpMyAdmin, Adminer, RabbitMQ) matching any single-page app's generic shell instead of the real panel; Twilio, Mailgun, and Facebook secret patterns matching substrings buried inside unrelated longer tokens; an XSS detector whose pattern could span across unrelated later code in the page; a Connection String check that collided with Sentry's own unrelated dsn= convention (caught scanning roblox.com); a cookie check that contradicted its own advice, flagging the modern, correct syntax and telling you to revert to the deprecated one; a prototype-pollution check matching the standard defensive guard against pollution as if it were the vulnerability itself (flagged critical on google.com); and, from scanning our own site specifically: a login form's missing method attribute misread as a real credential-in-URL bug, an OAuth check matching our own privacy policy's plain-English description of an integration, a bearer-token check tripping on our own API docs example, a SQL-error check (and a differently-named duplicate of it) bridging two unrelated sections of a self-hosting guide into one false match, a DOM-clobbering check flagging an ordinary docs heading anchor, a hardcoded-IP check that didn't know about the reserved documentation IP ranges, an admin-path check whose wording claimed something it never actually verified, and a password-strength check that treated a login field the same as a signup field.
- [RefreshCw] **[FIXED]** **Any Hardcoded-Secret Finding Could Push a Scan to 10/10 Risk**
  The risk-score calculation treated every hardcoded-secret finding as "actively exploitable", including the deliberately low-risk tiers like a key that's already meant to be public client-side. A handful of harmless ones together could push a scan from safe straight to critical. Now only the two genuinely dangerous secret tiers count toward that.
- [Flag] **[FIXED]** **Marking a Finding False Positive Didn't Refresh the Risk Score On Screen**
  The score recalculation itself was already correct and saved right away, but the scan view you were looking at didn't know to refresh, so the risk score looked unchanged until you left and reopened the scan. It now updates in place as soon as you mark a finding.
- [Lock] **[FIXED]** **Five of Our Own Pages Were Wrongly Gated Behind Login**
  Found by scanning our own site with our own scanner: the legal index page, the badge page, the post-checkout confirmation page, team invite links, and public host reports were all silently redirecting a logged-out visitor to the login screen instead of showing the page. Team invite links were the worst of it, since an invite is supposed to work for someone who doesn't have an account yet. All five are public now, the same as they were always meant to be.
- [RefreshCw] **[CHANGED]** **Self-Updater No Longer Builds or Restarts For You**
  Applying an update from the admin panel used to run npm run build as its last step, tying up a live production process while it did. The updater job now stops once files are updated, dependencies are installed, and the database is migrated (backed up first): it tells you when that's done, and you run npm run build and restart the server yourself, on your own schedule.
- [Database] **[ADDED]** **Database Is Backed Up Automatically Before Every Migration**
  Every migration, whether run from the CLI or the in-app self-updater, now takes a full pg_dump backup first (skipped gracefully, never blocking the migration, if pg_dump isn't installed). Backups are written to databases/v{major}/{schema version}/vulnradar_backup_{timestamp}.sql, so backups from different schema versions can never collide or overwrite each other.
- [AlertTriangle] **[FIXED]** **Silent Background & Billing Failures Now Reach the Admin Panel**
  Scheduled scans, the cleanup job, and the posture-digest worker could fail on every tick, forever, with nothing but a log line nobody was watching. Each now sends a single admin alert after 3 consecutive failures, not one alert per failure, and resets as soon as it recovers. Separately, a failed billing_history insert after a successful Stripe webhook was logged in a way the admin Error Logs panel never picks up; it now surfaces there like any other real error.
- [Globe] **[ADDED]** **Extension: Live on Firefox Add-ons**
  The browser extension is now installable straight from Firefox Add-ons (AMO), the same one-click install the Chrome Web Store listing already had. Review took a few days; both browsers now update themselves from their store listing instead of a manual unpacked/packaged install.
- [Mail] **[CHANGED]** **Email Logs: Simpler List, Real Preview**
  Each row in the admin Email Logs table now shows just who it went to, the subject, and whether it sent, instead of crowding the list with truncated body text and error strings. A new View button renders the redacted body through the same branded template real emails use, so you can see roughly what the recipient actually saw.

---

## v3.3.2 - August 13, 2026
**Badge List Deduping, Stray Focus Ring on Menus**

A small patch release. The badge page listed every individual scan of a URL as its own row, so re-scanning the same site kept adding new entries instead of moving the existing one to the top. And a stray blue outline could appear around the first item of a dropdown menu (Export as JSON, etc.) on pages reached right after a scan auto-opened another modal, left over from a focus-visible quirk that only shows up in that specific sequence.

### Changes
- [Layers] **[FIXED]** **Badge Page Listed the Same URL as Multiple Entries**
  Every individual scan of a URL showed up as its own row, so scanning the same site again added a new entry below the old one instead of updating the badge you already had. The list now shows one row per URL, the most recent scan, moved to the top when you scan it again.
- [Keyboard] **[FIXED]** **Stray Focus Ring Around the First Menu Item**
  A dropdown menu (the "..." actions menu on a scan result, and any other Radix-based menu) could show a blue outline box around its first item on open, even when opened with the mouse, if a script had moved focus somewhere earlier on the page (e.g. a modal that auto-opened itself after a scan finished). Radix menu/select items already show which one is highlighted with a background tint, so the extra ring is removed for all of them.

---

## v3.3.1 - August 12, 2026
**Self-Updating Badges, False-Positive Risk Scoring**

A patch release focused on real gaps found while dogfooding: the embeddable badge only ever showed a snapshot of whichever scan you picked when you made it, marking a finding false positive didn't change the risk score it was dragging down, AI verification was timing out on real-world scans with 50+ findings, and two checks (credit card pattern, hardcoded credentials) were flagging ordinary, safe code as Critical.

### Changes
- [RefreshCw] **[ADDED]** **Self-Updating Embed Badge**
  The embeddable badge used to be tied to one specific scan: every time you scanned again, the old embed code kept showing the old result until you regenerated it and swapped the link. Generate a badge for a URL once now and it always shows that URL's latest completed scan by date, no new token or embed code needed.
- [Filter] **[FIXED]** **Marking a Finding False Positive Now Lowers the Risk Score**
  Marking a finding false positive kept the record visible (as intended, for the learning loop) but never changed what counted toward the scan's severity breakdown or numeric danger score, so a confirmed false positive kept dragging down a site's rating. The score and severity counts now recompute from the non-false-positive findings whenever a verdict changes.
- [Timer] **[FIXED]** **AI Verification Timing Out on Large Scans**
  The per-finding AI verify call timeout (40s) was too short for a slower or reasoning-model provider on a site with 50+ findings, silently dropping affected findings to no AI verdict instead of a real answer. Raised to 60s per call, with the overall batch budget raised proportionally so worst-case coverage didn't shrink.
- [Bug] **[FIXED]** **Credit Card Pattern Check Flagged Published Test Card Numbers**
  The check had no Luhn checksum validation at all, so any 16-digit number that merely started with a valid card-network prefix (an order ID, tracking parameter, or cache-busting hash) could trigger it, and its test-card exclusion list didn't include Stripe's own famous 4242 4242 4242 4242. A payment processor's own docs site could flag its own published test cards as a live leak. Now Luhn-validated, with a broader exclusion list covering the major processors' published test cards.
- [Bug] **[FIXED]** **Hardcoded Credentials Checks Flagged Ordinary Frontend Code**
  Three related checks matched any `password:`/`admin:`/`root:` assignment, a username-and-password pair near each other, or a sessionStorage key merely starting with "pwd"/"password", with zero filtering. A React form-state initializer (`useState({ password: "" })`), a role dropdown option (`{ role: "admin" }`), an i18n label blob, or a password-visibility UI toggle (`sessionStorage.setItem("pwdVisible", ...)`) all fired as Critical or High findings. Matched values now have to actually look like a real secret, and the sessionStorage key has to be an exact match, not a prefix.

---

## v3.3.0 - August 12, 2026 **(highlights)**
**Scanner Accuracy Overhaul, ~40 New Checks, One Trust Verdict Everywhere**

Every one of the pre-existing checks got re-verified against real vulnerable and real safe examples: 205 findings had a wrong CWE, a description mismatched to what the detector actually looked for, a context-blind keyword match firing on documentation or defensive code, or a miscalibrated severity, and all of it got fixed. 16 checks with no real backing detector got removed outright. On top of that, roughly 40 new checks shipped across auth/API, headers, information disclosure, supply chain, email/DNS, client-side, secrets, and host-validation, each one checked in both directions before shipping. Separately, a host could show clean on its own results page but yellow ("review before trusting") in History or the browser extension, because each surface had its own ad-hoc logic instead of sharing one scorer; the server now computes the verdict once and every surface reads that same value. Admin-initiated 2FA reset is gone for good, a real account-takeover path closed rather than just hidden. Admin can now see whether a user has linked Discord, Google, or GitHub. Scan history is kept forever on every plan by default. And 52 more previously-hardcoded settings are now adjustable from Admin.

### Changes
- [Bug] **[FIXED]** **Full Accuracy Audit Across Every Existing Check**
  205 findings fixed: metadata describing a different vulnerability than the detector actually looked for, context-blind keyword matches that fired on safe code or documentation, and miscalibrated severities. 16 checks got removed outright for having no real backing detector, including 5 TLS cipher-suite checks Node's own TLS stack can't actually inspect.
- [Radar] **[ADDED]** **~40 New Checks Across Auth, Headers, Supply Chain, and More**
  New detectors for JWT jku/x5u key-confusion headers, OAuth authorize flows missing PKCE, a GraphQL schema exposing a heavy mutation surface, SharedArrayBuffer used without cross-origin isolation, CORS-reflected-origin responses missing Vary: Origin, and more. Every one was verified in both directions before shipping: fires on a real vulnerable example, stays quiet on a safe/defensive counterexample and on documentation.
- [ShieldCheck] **[FIXED]** **One Trust Verdict, Computed Once, Shown Everywhere**
  A host could read as clean on its own results page but show yellow ("review before trusting") in History or the browser extension, because each surface derived its own safe/caution/unsafe judgment from raw severity counts instead of the same weighted scorer the rest of the app uses. The server now computes that verdict once and every surface, web app, API, Discord webhook, extension popup, and extension content-script card, reads the same value.
- [Smartphone] **[SECURITY]** **Admins Can No Longer Reset a User's 2FA**
  Admin-initiated 2FA reset let a compromised or malicious admin strip a user's second factor and take the account over with just the password, or by triggering a password reset next. That action is now permanently disabled server-side, not just hidden in the UI. The only way off 2FA is the account owner's own backup codes or their own recovery flow.
- [Link2] **[ADDED]** **Admin Can See a User's Connected Discord, Google, and GitHub**
  The admin user-detail view had no way to tell whether a user had linked Discord, signed in with Google or GitHub, or connected a GitHub repo for AI code review, useful context for support and abuse investigation. All four now show as plain status pills.
- [Sparkles] **[FIXED]** **Fixed Landing, Login, and Signup Page Animations Running Instantly**
  After an earlier pass moved some inline styles into Tailwind utility classes, the staggered slide-up entrance on these three pages started firing with zero delay, faster than the page could actually render, so nobody ever saw it play. The cause was a CSS shorthand collision (a separate animation-delay rule getting silently reset by another class's animation shorthand); the delay is now folded into the same shorthand declaration so it can't happen again.
- [Database] **[CHANGED]** **Scan History Now Kept Forever, On Every Plan**
  Age-based deletion of old scan history is gone entirely. A scan result is small enough, a few KB of JSON, that automatic deletion wasn't buying anything but data loss. Self-hosters can still configure a retention window per plan from Admin if they want one; the shipped default is unlimited.
- [Settings] **[ADDED]** **52 More Settings Moved Into Admin Config**
  A sweep for hardcoded values that should have been configurable turned up 52 more, spanning scanning, auth, rate limits, cleanup schedules, billing, and AI. All of them are now adjustable from Admin without touching code.

---

## v3.2.2 - August 12, 2026
**AI Chat and Verify Fixes, Focus Ring Cleanup, Self-Updater Port Fix**

Another patch release working through real bug reports. AI verify findings could get cut off mid-word on longer explanations; the hard 300-character limit is gone, replaced with a soft 300-500 character target the model can go past when the evidence actually needs it. Scan summaries were failing with a 502 more often than they should, traced to a timeout that never got raised when the model's token budget did; both AI timeouts are now 40 seconds and admin-configurable. When AI verify confirms a finding or flags it as a likely false positive, that now pre-fills "Mark this result" instead of requiring a separate click, without ever overriding a choice you already made yourself. The chat widget no longer silently eats a message that starts with "/" if it isn't a real command, and stopped reserving scrollbar space it didn't need. A leftover focus-ring bug (a two-tone blue-and-white halo, not the clean single ring the rest of the app uses) is fixed everywhere it was still showing up. The self-updater also no longer wipes a self-hoster's custom start-script port on every update.

### Changes
- [MessageSquare] **[FIXED]** **AI Verify Findings No Longer Cut Off Mid-Word**
  A hard 300-character limit on the AI's verify explanation sliced complete answers mid-word ("...no authentication or sensitive data exposur"). Removed entirely; the prompt now asks for roughly 300-500 characters as a target, not a wall, so a genuinely detailed answer citing a long URL or several signals is never cut short to hit a number.
- [ServerCrash] **[FIXED]** **Fixed AI Scan Summaries Failing With a 502**
  The summary call's own timeout stayed hardcoded at 12 seconds after its token budget was raised to 6000 for a separate fix, so a reasoning model given 15x more room to think routinely got aborted before finishing. Both AI timeouts (verify and summary) are now 40 seconds by default and adjustable from Admin without a code change.
- [CheckCircle2] **[ADDED]** **AI Verify Now Pre-Fills "Mark This Result"**
  When AI verify confirms a finding or flags it as a likely false positive, that verdict now pre-fills the "Mark this result" feedback on the finding automatically. It never overwrites a choice you already made yourself, whether that was by hand or from an earlier AI-verify run.
- [Bot] **[FIXED]** **AI Chat No Longer Swallows Unrecognized Commands**
  Typing "/" followed by anything that wasn't a real command (a typo, a file path, a sentence that happened to start with a slash) cleared the input and went silent, since the failed context lookup behind it returned nothing with no visible error. Unrecognized slash input now just sends as a normal message; a real command that genuinely fails now shows why instead of nothing.
- [Keyboard] **[FIXED]** **Fixed a Two-Tone Focus Ring Left Over on Buttons and Links**
  Modal close buttons and dozens of other interactive elements still had their own old ring-offset styling from before the app switched to a single clean focus ring, so tabbing to them showed a white gap between the element and the blue ring instead of one solid outline. Removed the leftover styling wherever it was still present.
- [Wrench] **[FIXED]** **Self-Updater No Longer Wipes a Custom Start Port**
  The updater overlay-copies the new release's package.json straight over the running app's own, which silently reverted a self-hoster's custom -p/--port flag (common on hosts like Pterodactyl that assign a fixed port) back to the default on every update. The updater now detects a custom port before the copy and reapplies it afterward, unless the new release specifies its own.

---

## v3.2.1 - August 12, 2026
**Auto-Tag Quality Fixes, Severity Badge Colors, Admin Self-Actions**

A patch release focused on cleanup from real user reports. The AI auto-tag suggester could produce garbled non-tag text like "One is" or a bare "The" instead of a real tag name, and once saved, an AI-suggested tag couldn't actually be dismissed from the UI; both fixed. A scan whose only findings are info-severity no longer gets tagged Needs Hardening, since there's nothing on it to actually fix. Every severity level, including info, now gets a colored badge in scan lists instead of falling back to plain text. The super admin account can now perform benign actions, like awarding itself a badge, on its own account through the admin panel, previously blocked outright by the same protection meant to stop other admins from touching it. The Firefox add-on also picks up a manifest field AMO now requires.

### Changes
- [Tag] **[FIXED]** **AI-Suggested Tags Could Read as Garbled Sentence Fragments**
  The AI auto-tag suggester validated tag length, character set, and word count, but never checked whether the output was actually a noun-phrase tag versus a sentence fragment, letting things like "One is" or a bare "The" reach scan chips. A fragment containing an auxiliary verb (is, are, has...) anywhere, or consisting of nothing but a single article, pronoun, or number word, is rejected now.
- [X] **[FIXED]** **AI-Suggested Tags Couldn't Be Dismissed**
  The dismiss action only matched tags with source = 'auto', so clicking the X on an AI-suggested tag (source = 'ai') returned success but silently removed nothing. Both sources are handled now.
- [CheckCircle2] **[FIXED]** **Info-Only Scans No Longer Tagged Needs Hardening**
  A scan whose only findings are all info-severity, which by definition aren't actionable, used to get the same Needs Hardening tag, and the same AI tag-suggestion call, as a scan with real low/medium findings. It's tagged Clean now, and no AI call fires for it.
- [Palette] **[FIXED]** **Every Severity Level Gets a Colored Badge Now**
  Public Scans and History rows drew a colored count box for critical/high/medium/low findings but fell back to plain gray text for info-only scans ("3 info"), the one severity that most needed a consistent look since it's the common case for an otherwise clean site.
- [UserCog] **[FIXED]** **Super Admin Can Modify Their Own Account**
  The account-level protection that blocks anyone from modifying the super_admin account applied even to the super_admin acting on themselves, so something as simple as awarding your own account a badge failed with "This account cannot be modified." Benign actions on your own account go through now; dangerous ones (disable, delete, reset password, role change) stay blocked either way.
- [Globe] **[FIXED]** **Firefox Add-on Fixed for AMO's New Data-Collection Disclosure**
  Firefox now requires every extension to declare what browsing data it collects directly in the manifest; ours didn't have the field yet, so the build was rejected before review. Declared as browsing activity (the current page's URL, sent to VulnRadar's API for the on-page check), matching what the extension already told you it does. Extension version unchanged.

---

## v3.2.0 - August 12, 2026
**Threat Reputation, Active Probing, Host & Share Management, Super Admin**

Admin gets a real way to manage what's public: browse and pull individual hosts or shared scans, not just search-by-blacklist. The extension's on-page card gets meaningfully less naggy for both the known-result and not-scanned-yet cases, and the very first account on a self-hosted instance now gets Super Admin (and Elite) automatically instead of needing a database edit. A mobile layout bug that could affect any grid-based section on iOS is fixed everywhere it appeared, not just where it was first spotted. The engine also picks up two new check categories: an optional threat-reputation lookup against Google Web Risk, and an opt-in active probe that submits a real canary value through page forms to catch confirmed reflected XSS.

### Changes
- [Search] **[ADDED]** **Admin: Browse and Manage Hosts & Shares**
  A new Admin > Content section lists every cached host reputation entry and every scan that's ever had a share link, paginated, with Purge/Unlist/Revoke actions per row. Previously the only way to remove something from the public host directory or the public scans listing was to already know its exact URL and search for it under Blocked Data.
- [UserCog] **[ADDED]** **Super Admin Now Auto-Detected**
  If no account has the super_admin role yet (needed to run the in-app self-updater), the lowest-id account on the instance is promoted automatically on boot, and granted the Elite Supporter plan the same real way staff promotion already grants Pro Supporter. No more hand-editing the database to test the updater on a fresh self-hosted instance.
- [Bell] **[CHANGED]** **Extension: A Quieter Reputation Card**
  The on-page card no longer re-shows an identical result every time you reload, switch tabs, or navigate to a different page on the same site. It now covers both the known-result card and the not-scanned-yet prompt (previously only the known case was covered), and the suppression window is 4 hours instead of a full day, so a card doesn't go stale for as long either.
- [Smartphone] **[FIXED]** **Fixed a Layout Bug That Could Hit Any Grid on Mobile**
  A responsive grid missing its base single-column layout sizes to its widest content instead of the screen on iOS, dragging the whole section wider than the viewport. Found it on the dashboard; swept the entire codebase for the same pattern and fixed every instance: scan results, docs, pricing, checkout, the landing page, legal pages, and several loading states.
- [Keyboard] **[CHANGED]** **Modals No Longer Auto-Focus Anything**
  Every dialog, confirmation modal, and the mobile nav drawer used to auto-focus their first focusable element on open, which for a destructive confirm button meant Enter could fire it before you'd read the prompt. Nothing is focused automatically now; Tab still works normally once you use it.
- [Key] **[FIXED]** **Fixed a Cloudflare False Positive Blocking Authenticated Scans**
  The "sign in first" scan option was refusing to log in on any page whose bundle merely referenced Cloudflare Turnstile, even a site's own legitimate signup widget, mistaking it for an active bot challenge. It's now only treated as a block when paired with an actual human-verification prompt. The error message also now names exactly which signal triggered it, if it ever fires again.
- [Link2] **[FIXED]** **Scan History Now Shows Where a Redirect Actually Landed**
  Scanning a URL that redirects (https://host/ to https://host/landing, for example) used to record the pre-redirect URL in history regardless of where the scan actually ended up. The final, same-host URL is now what gets saved.
- [BookOpen] **[ADDED]** **Docs: Browser Extension Page**
  Install steps, the popup, auto-scan modes, the on-page card, signed-in-page handling, and permissions, all in one place under Docs > Browser Extension.
- [Wrench] **[FIXED]** **Fixed the Self-Updater Failing on npm ci**
  The project's own .npmrc used an install-scripts syntax that a newer npm (v12+) rejects outright for a project-scoped install, failing every update attempt with an unrelated-looking error. Moved to the current, project-scoped-safe mechanism.
- [Database] **[FIXED]** **AI Tag Suggestions Were Silently Failing to Save**
  A database constraint never got updated to allow the 'ai' source value the AI tag suggestion feature writes, so every suggested tag insert failed quietly since the feature shipped. Fixed.
- [ServerCog] **[FIXED]** **Generic Cloudflare/Vercel Server Header No Longer Flagged**
  "Server: cloudflare" or "Server: Vercel" names the CDN in front of a site, not the origin's software or version, and was being flagged as a disclosure finding with nothing an attacker could actually use.
- [ShieldCheck] **[FIXED]** **A Few More Production Header Findings Fixed**
  /robots.txt no longer lists /admin. Expect-CT is now sent (monitor-only). The landing page's inline style attributes dropped from 11 to near zero by moving a staggered-animation effect to precomputed CSS classes instead of per-element inline styles.
- [Bot] **[ADDED]** **AI Chat Knows More About VulnRadar Itself**
  Vera can now answer who builds and owns VulnRadar and a short version of its history, on top of everything it already knew about docs, checks, and the API.
- [RefreshCw] **[FIXED]** **"Back to Scanner" Button Actually Works Now**
  On a failed-scan error page, the button linked to the page you were already on instead of resetting the view, so clicking it appeared to do nothing.
- [MessageSquare] **[FIXED]** **Fixed a False "Message Too Long" Error in AI Chat**
  The length check gating each message ran against the entire conversation, not just the one you'd just typed. The moment /docs or /changelog auto-loaded as context (routinely thousands of characters), every message after that failed with the same rejection, including ones nowhere near the real limit. Only the newest message is checked now.
- [Layout] **[CHANGED]** **Docs Section Headers No Longer Have Icons**
  Every doc page section heading (Permissions, Authentication, Deployment, and the rest) had a decorative icon next to it. Removed across all docs pages: the heading text and the permalink icon on hover are enough.
- [ShieldAlert] **[ADDED]** **New Check Category: Threat Reputation**
  Optionally checks the scanned URL against Google Web Risk for known malware, phishing, and unwanted-software listings. Invisible until a self-hosted instance sets WEB_RISK_API_KEY, the same on-by-configuration pattern the AI features already use.
- [Target] **[ADDED]** **New, Opt-In Check: Reflected XSS via Active Probing**
  The engine's first active check: submits a canary value through every form it finds on a page and flags one that reflects it back unescaped, proof of exploitable reflected XSS rather than a pattern guess. Unlike every other check, this one writes real requests to the target, so it never runs unless a scan explicitly turns it on.

---

## v3.1.1 - August 12, 2026
**GitHub Review Credits, Host Report Parity, a Duplicated Header Fixed**

A fast follow to 3.1.0. GitHub repo AI review can now be topped up with purchased credits the same way AI verification already could, the public host report page catches up to the shared-scan page's redesign and picks up auto-tags of its own, and a real production bug (a security header sent twice on every response) is fixed after we caught it scanning our own site.

### Changes
- [CreditCard] **[ADDED]** **Buy More GitHub Review Credits**
  GitHub repo AI review gets the same one-time credit top-up AI verification already has: pick a token amount on its own checkout page, and once your plan's free per-window allowance runs out, review keeps working by drawing from the purchased balance instead of just stopping. Credits never expire and are never touched by the window resetting, purchased or not-yet-spent, they carry forward exactly as-is.
- [Tag] **[ADDED]** **Public Host Reports Get Auto-Tags Too**
  The public /host/[hostname] page now shows the same rule-computed tags (XSS Risk, Secrets Exposed, Clean, and the rest of the taxonomy) a signed-in scan owner sees on their own results, computed from the same findings and shown right in the report header.
- [Layout] **[CHANGED]** **Host Report Header Matches the Shared Page**
  The host report header had the same problem the shared-scan page's did: a verdict badge and color rail that just repeated what the summary card right below it already said, in shorter form. Both are gone now, and the header's footer row shows tags instead of the Scanned/checks-run/findings stats that were already in the summary card.
- [ShieldCheck] **[FIXED]** **Cross-Origin-Embedder-Policy Was Being Sent Twice on Every Response**
  The header was declared in both next.config.mjs and middleware.ts with the same value, on the assumption that middleware's copy would simply take priority. A real scan of our own production site proved that assumption wrong: Next.js sent both, so the header actually reached browsers as "unsafe-none, unsafe-none". Removed the redundant declaration; middleware's is the only one left.
- [ScanSearch] **[FIXED]** **Robots.txt Sensitive-Path Check Could Double-Count the Same Path**
  A robots.txt with more than one User-agent block (one for "*", another scoped to specific AI crawlers, say) legitimately repeats the same Disallow line under each block, valid syntax, not two different paths. The check counted every regex match without deduping, so a site disallowing one sensitive path under two User-agent blocks got reported as "2 sensitive path(s)" listing the identical line twice. Deduped before counting.
- [Search] **[FIXED]** **DKIM Check Only Knew 7 Generic Selector Names**
  Checked a fixed list of 7 generic selector names (default, google, k1...) and reported "No DKIM Records Found" for any domain using a provider that publishes its own selector names instead, ProtonMail, Fastmail, Zoho, Mailchimp/Mandrill, SendGrid, Klaviyo, and Microsoft 365's second key-rotation selector among them. Caught on our own ProtonMail-hosted domain, which had working DKIM the whole time. The list is ~24 selectors now, covering every provider above.
- [Mail] **[FIXED]** **API Key Rotation Email Could Crash and Silently Fail to Send**
  The rotation notification email's template expected the new key's creation timestamp as a string, but the database always returns it as a real Date object, so building the email crashed before it ever got sent. The notification failing was already non-fatal to the rotation itself, so this only ever affected whether you got the heads-up email, never whether the rotation worked.
- [RefreshCw] **[FIXED]** **Admin Save Confirmation Snapped Back to the Form Right After Saving**
  Confirming a change (a plan change, say) in the admin Save Changes dialog showed the "Changes Saved" checkmark for an instant, then snapped straight back to the same dialog, now reading "0 changes" instead of closing. Saving cleared the pending changes as it should, but that same clear also flipped a value the dialog's own "show success" effect was watching, retriggering it and wiping the success state it had just set. The effect only resets on the dialog actually opening now, not on every recalculation while it's still open.
- [RefreshCw] **[FIXED]** **Admin System Refresh Button Had No Visible Feedback**
  Clicking Refresh on Admin > System's updater status actually worked every time, it just gave no sign of it: no spinner, nothing disabled, nothing to notice if the status happened to come back unchanged. The button now spins and disables itself for the moment the request is actually in flight.

---

## v3.1.0 - August 11, 2026 **(highlights)**
**In-App Self-Updater, Auto-Tagged Scans, and a Blue Rebrand**

A wide release. Admin can now update VulnRadar straight from the app instead of SSHing in, scans get tagged automatically as they finish, and AI finding verification finally has a real per-plan usage quota instead of an informal limit. There's also a new Public Scans directory, an Engine Feedback dashboard for spotting noisy checks, a full mobile pass, and the primary color changed from cyan to blue across the app and extension. It also closes a real privacy gap caught before any of this shipped: the new Public Scans directory, along with sitemap.xml and robots.txt, was unreachable to logged-out visitors and crawlers, and a database default meant fixing that reachability would have retroactively published existing private shares. Below that: a pile of real bug fixes, including one where a fully successful account deletion was reporting itself as failed.

### Changes
- [Download] **[ADDED]** **Admin > System Can Update VulnRadar From the App**
  A new System tab in Admin can check for, download, verify, and apply a new VulnRadar release without touching a terminal: it checksums the downloaded release, checks the cosign signature if one's configured, then runs npm ci, the production build, and the DB migration for you. It never restarts the process itself, you restart manually once it's done, so nothing pulls the rug out from under a scan that's mid-run when you click apply. This is an updater you trigger, not an auto-updater that decides for you. The published Docker image bundles cosign now too, so that signature check actually runs by default instead of silently skipping for anyone on the official image.
- [Gauge] **[CHANGED]** **AI Finding Verification Gets a Real Usage Quota**
  AI verify now has a token quota that resets on a 5-hour window, tracked per user and shown in Profile > Billing so you can actually see how much you have left, instead of running on an informal limit nobody could inspect. AI chat and AI-generated scan summaries stay free and unmetered on every plan; they were never the expensive part. GitHub repo AI code review keeps the separate monthly quota it already had, now listed on the pricing page next to everything else instead of being the one AI feature you had to guess at.
- [Tag] **[ADDED]** **Scans Get Tagged Automatically**
  Every finished scan now picks up tags based on what it actually found, like "XSS Risk," "Secrets Exposed," or "Clean," generated by a fixed set of rules against the findings, not a model guessing. Add your own free-form tags on top, and if an auto-tag looks wrong, dismiss it: that feeds the new Engine Feedback dashboard below instead of just disappearing.
- [FileSearch] **[ADDED]** **Admin > System > Error Logs**
  Real application errors now get captured and shown in a new admin viewer: actual exceptions, not the routine 4xx/5xx noise every app produces. If something's breaking in production, you can see it and its stack trace from inside the app instead of needing server or SSH access.
- [Globe] **[ADDED]** **Public Scans Directory**
  Scans people chose to share now have somewhere to live: a public, unauthenticated page listing them. Sharing a scan lists it there by default, with an account-level setting and a per-share toggle to opt out, and it's a new tab next to your own History rather than a separate destination.
- [BarChart3] **[ADDED]** **Admin: Engine Feedback Dashboard**
  Aggregates two signals we already collected but never surfaced: which checks get marked as false positives most often, and which auto-tags get dismissed most often. It's meant to point at which checks are worth tuning next instead of guessing from anecdote.
- [ShieldAlert] **[SECURITY]** **Public Scans, Sitemap, and robots.txt Were Silently Unreachable**
  The middleware that gates unauthenticated pages had no entries for /sitemap.xml, /robots.txt, or the new Public Scans directory (page or API), so anyone not logged in, including every search crawler, got redirected straight to /login instead of the actual page. All three are listed now. Public Scans had a second issue stacked on top: the share_publicly_listed column defaulted to true, so a share created before the opt-out setting existed would have gone instantly public the moment the directory became reachable. Fixed together with a per-IP rate limit on the listing endpoint, since making it reachable also made it a target.
- [Palette] **[CHANGED]** **Primary Color: Cyan to Blue**
  Swapped the brand color from the original cyan (hsl(190 90% 42%)) to a blue (#60a5fa, hsl(213 94% 68%)) across the main app and the browser extension. Buttons, links, the extension's on-page badge, all moved together so nothing's left on the old color.
- [Smartphone] **[CHANGED]** **Mobile Pass Across the App**
  Went through the app on real small screens and fixed what didn't fit: cramped layouts, overflow, touch targets too small to hit reliably. Not one page, the whole thing.
- [Sun] **[CHANGED]** **Light Mode, Less Stark**
  Light mode's background was a flat, bright white that got hard to stare at for long scan sessions. Softened it in the main app and the extension so it's easier on the eyes without changing how anything reads.
- [Layout] **[CHANGED]** **Changelog Redesigned**
  This page moved from one long scrolling wall of text to a centered column of release cards, and loads releases in batches as you scroll instead of shipping the entire history in one payload.
- [MessageSquare] **[CHANGED]** **AI Chat: 500 to 2,000 Characters**
  The character limit on a single AI chat message went from 500 to 2,000, enough room to paste a stack trace or a chunk of scan output instead of chopping your question in half.
- [UserCog] **[CHANGED]** **Staff Accounts Get a Real Plan, Not Blanket Access**
  Admin, moderator, and support accounts no longer bypass every plan limit by virtue of their role. They're granted an actual Pro Supporter plan instead, the same limits a paying Pro Supporter gets, applied through billing rather than special-cased throughout the app. Losing staff access restores whatever plan you had before; if you'd separately paid for something better while on staff, you keep it. Manually changing a staff member's plan through the ordinary Update Plan admin action now keeps that restore record in sync too, instead of a later demotion silently reverting past the manual change.
- [X] **[CHANGED]** **Modal Close Buttons Are Actually Visible Now**
  The X in the corner of every dialog and sheet used to be a bare, low-contrast icon that could disappear against a busy background. It's a proper button now, background chip and all, and the redundant "Close" buttons that used to sit next to it are gone app-wide since the X already does that job.
- [Share2] **[CHANGED]** **Share Modal Discloses the Public Directory**
  Sharing a scan now tells you upfront, in the same modal, that it'll also be listed in the new Public Scans directory unless you opt out right there. No separate settings page required to find out.
- [FileText] **[CHANGED]** **Terms Modal, Onboarding Tour, and Legal Pages Redesigned**
  The mandatory terms acceptance modal, the new-user product tour, and all seven /legal pages got a real visual pass instead of the generic icon-in-a-box treatment they had before. The terms modal shows per-checkbox progress instead of a bare N/5 counter, the onboarding tour is a sidebar-plus-detail layout instead of a centered dot-pager, and every legal page shares one redesigned header.
- [ScanSearch] **[FIXED]** **Scanner: Fewer False Positives From Framework Noise**
  Three detection patterns were catching things that weren't there. The inline-script checks were matching Next.js's own RSC streaming payloads (self.__next_f.push(...)) and Cloudflare's injected bot-challenge bootstrap script as if a site had authored them itself, neither one is something a site owner wrote or can sanitize. The dangerous-function-usage pattern was matching the plain function( keyword, present in nearly every script on the web, instead of the actual new Function(...) constructor it meant to catch. And hardcoded-ip-addresses was reading SVG icon path coordinates, dense decimal number strings, as dotted-quad IP addresses; it now strips SVG path/points data before scanning and rejects any octet over 255 outright.
- [Image] **[FIXED]** **Social Previews No Longer Show Stale Metadata**
  A leftover app/head.tsx was quietly overriding the real per-page metadata (title, description, OG image) with an old, hardcoded set, the same kind of shadowing bug that broke security.txt in 3.0.1. Removed it, so sharing a VulnRadar link now shows the actual page's title and image instead of whatever was hardcoded months ago.
- [Globe] **[FIXED]** **Extension: No Longer Renders Broken on a Raw File**
  Viewing a raw image, PDF, or other non-HTML resource directly (GitHub's private-user-images host among them) serves a browser-generated document with a CSP tight enough to block even the extension's shadow-DOM-scoped styles, so its on-page card rendered completely unstyled. There's nothing to scan on a raw file URL anyway, so the extension now just skips those pages instead of rendering broken.
- [Link2] **[FIXED]** **Extension: Scan This Link Shows Something's Happening**
  Right-clicking a link and choosing Scan with VulnRadar ran with zero visible feedback: no on-page indicator, no notification, nothing in history until it finished up to 5 minutes later, which read as broken. It goes through the same notify pipeline every other scan trigger uses now. Also dropped two permissions (scripting, activeTab) the extension declared but never actually used.
- [Lock] **[FIXED]** **Admin Password Re-Auth Actually Prompts Now**
  Password-gated admin actions (disable, delete, reset password) require re-entering your password on the backend, but nothing in the UI ever asked for it, so those actions just silently 403'd. A new confirm dialog actually collects the password now, so the gate works the way it was supposed to. That gate now also covers every other Danger Zone action, revoking sessions, revoking API keys, resetting 2FA, force logout, the AI ban toggle, bulk deletes, not just delete and disable, and a timing bug that could pop the wrong confirmation dialog on a fast double-click is fixed too.
- [Eye] **[FIXED]** **Fixed a Contrast Issue From the Color Rebrand**
  White text on the new lighter blue landed around 2.5:1 contrast in a few spots, below what's readable. Adjusted the on-primary color so it holds roughly 8:1 instead, without touching the primary color itself.
- [ShieldCheck] **[FIXED]** **Admin Delete Account Actually Reports Success Now**
  Deleting a user, or any other action audit-logged against a target user, could throw a foreign-key error and return a 500 even though the action had already fully committed: the account was gone, but the audit-log insert that ran right after it tried to reference a user id that no longer existed. The delete itself was never actually broken, only the response was. Fixed, so a completed action now reports as completed.
- [Bug] **[FIXED]** **Auto-Tags: Two Bugs That Could Leave a Scan Untagged**
  A scan's status could flip to completed while its auto-tags were still a beat behind, so a client polling right at that instant could see a finished scan with no tags yet. The status update and the tag save now commit in the same transaction, so they're never out of sync. Separately, a scan whose findings matched the same auto-tag rule twice in one save could trip a Postgres error on the insert and fail to tag the scan at all; duplicates are deduped before the insert now, and a custom tag name can no longer collide with a reserved name like Clean or Critical Exposure.
- [Timer] **[FIXED]** **Admin Updater: No More Stuck "Running," No More Double-Runs**
  If a step in the updater failed partway through (a bad checksum, a failed npm ci), the job could get stuck reporting "running" forever instead of surfacing the failure. And nothing stopped two apply requests from racing each other if you clicked twice. Both fixed: every failure path now marks the job failed with a reason, and only one update job can run at a time. Two more ways it could get stuck: the underlying migration script prompts interactively for confirmation on some steps, which just hung forever with no terminal attached, and a failure logging a job's start event could leave it created but never actually begun. Both handled now: migrations detect they're running unattended and fall back to safe defaults instead of waiting on a prompt nobody can answer, and that log call can no longer block the update it's supposed to be describing.
- [GitMerge] **[FIXED]** **Free GitHub Review Trial Couldn't Be Used Twice by Racing the Request**
  The daily free GitHub AI review trial was marked used only after the review finished successfully, so two requests fired close together could both pass the not-used-yet check and both run for free. It's claimed atomically before the review starts now, and released back if the review fails, so a failed review still doesn't burn your trial.
- [FileSearch] **[SECURITY]** **Error Logs Redact Secrets Before They Reach the Admin Viewer**
  The new Error Logs viewer captures the actual text of console.error calls, and a handful of existing call sites could include something like an Authorization header, an API key, or a connection string password in that text. Common secret shapes are stripped before anything is written to the table now, and a related bug where two distinct long errors sharing the same first 2,000 characters could silently collapse into one is also fixed.
- [RefreshCw] **[FIXED]** **Rotating an API Key No Longer Resets Its Usage Count**
  Rotating a key used to delete the old row and create a brand new one, and since usage history is tied to that row, the replacement started back at zero for the day even though you'd already used part of your daily limit under the old secret. Rotation now swaps the secret on the same row instead, so today's usage (and the daily limit built on it) carries straight through a rotation like it should.
- [Globe] **[FIXED]** **Extension: A Host You Just Scanned No Longer Shows as Unscanned on Refresh**
  Scanning a site never updated the extension's local "have I seen this host before" cache, only a fresh check against the server did, and that check is throttled per host to avoid spamming the endpoint. Reload the page you just scanned within that throttle window and it fell back to whatever was cached before the scan, reporting it unscanned right after scanning it. A scan now writes its own result into that cache immediately, and the throttle itself dropped from 10 minutes to 45 seconds, so a scan by anyone (this browser, another device, another user, a schedule) shows up on your very next real page load instead of sitting stale.
- [Eye] **[FIXED]** **Focus Ring No Longer Bleeds Past Rounded Menus and Dropdowns**
  The site-wide keyboard-focus ring drew a few pixels outside the focused element's own edges, which looked fine on a normal button but visibly poked past the rounded corner of a tightly-packed panel, a dropdown menu item keyboard-focused near the top of its menu, most noticeably. The ring now draws inside the element instead, so it can't bleed past any container's edge regardless of how little padding surrounds it.
- [Users] **[CHANGED]** **Shared Scan Page: Tags Moved Into the Header, Less Duplication**
  The shared-report header used to repeat the same safe/caution/unsafe verdict the summary card directly below it already shows, just in shorter form, and tags sat in their own separate card further down the page. Tags now live in the header itself, on the same row as the actions menu, and the header dropped the redundant verdict badge, so it's about who shared this and what you can do with it, not a rerun of the summary underneath.

---

## v3.0.1 - August 10, 2026 **(highlights)**
**SSRF Fix, Admin App URL Finally Works, AI and Extension Fixes**

A fast follow to 3.0.0. A real SSRF gap in four scanner checks is closed, the app finally listens to the site URL you set in Admin instead of a hardcoded default, and a batch of AI summary/chat and browser extension bugs are fixed.

### Changes
- [ShieldAlert] **[SECURITY]** **SSRF Gap Closed in Four Scanner Checks**
  Four checks (exposed files, GraphQL introspection, robots.txt, security.txt) validated a target's hostname once, before the scan started, but never re-checked it right before actually fetching. A site whose DNS changed mid-scan could redirect those specific checks at an internal address on your network. They now re-resolve and pin the address immediately before every request, the same protection every other live-fetch check already had.
- [Wrench] **[FIXED]** **The App Now Actually Uses the URL You Set in Admin**
  Changing the public app URL in Admin Settings and restarting used to do nothing: signing in with GitHub, Google, or Discord, emails, and every generated link kept using the URL baked in at build time. Sign-in now picks up an Admin-set URL immediately, no restart needed. Everything else (emails, sitemaps, report links) now correctly reads your NEXT_PUBLIC_APP_URL environment variable on your next deploy, instead of ignoring it.
- [Bug] **[FIXED]** **A Finding Could Silently Disappear From an Alert**
  A page with two or more outdated libraries (an old jQuery and an old Lodash, say) produced findings that looked identical internally. Marking one a false alarm could silently mark the other reviewed too, and a real, unrelated high-severity finding could vanish from the critical/high alert email. Each finding now gets its own identity.
- [Bug] **[FIXED]** **Bulk Scans Could Miscount Results on a Duplicate URL**
  If a batch scan hit your daily API key limit partway through, and the batch happened to contain the same URL twice, the response's success/failure counts could come out wrong. Fixed.
- [ScanSearch] **[FIXED]** **AI Summary No Longer Gets Cut Off**
  Generate AI Summary could stop mid-sentence on a longer scan. The reply budget is bigger now, and the summary shows up consistently on every page that displays scan results, not just the shared-link page.
- [MessageSquare] **[ADDED]** **Ask the AI Chat About a Summary**
  A new "Ask about this" button next to any AI summary opens the chat assistant with that summary already loaded, so you can ask follow-up questions without retyping context.
- [Timer] **[FIXED]** **Closing an AI Check Now Actually Cancels It**
  The X on the AI verify, AI summary, and GitHub repo scan windows used to do nothing while a check was running, or in one case not even close the window. Closing now stops the request instead of leaving it running in the background.
- [Image] **[FIXED]** **Fixed a Broken Social Preview Image**
  Sharing a VulnRadar link on Discord showed a broken image and the wrong accent color. The image loads now, matches VulnRadar's actual brand color, and the check-count badge on it is current.
- [Volume2] **[FIXED]** **Extension: Notification Sound Actually Plays**
  The "play a sound" notification setting saved but never did anything. It plays a short tone now, on both Chrome and Firefox.
- [ServerCog] **[ADDED]** **Extension: Service Probes Settings Are Reachable**
  The extension could already scan for exposed SSH, SMTP, IMAP, POP3, FTP, and MongoDB services, and it already sent that data with every scan, but there was no place in Settings to turn any of them on. There is now.
- [Tag] **[ADDED]** **Extension: Shows Its Own Version and VulnRadar's**
  Settings now shows the extension's version alongside the version of whatever VulnRadar instance it's connected to, so you can tell at a glance if either one is out of date.
- [Globe] **[FIXED]** **Extension: Pointed at the Right Server**
  The shipped extension was still configured to talk to our internal sandbox instead of the real vulnradar.dev, so installing it fresh wouldn't have worked. Fixed.
- [Container] **[CHANGED]** **Docker Healthcheck Actually Checks the Database Now**
  The Docker healthcheck only confirmed the app process was up, not that it could reach the database. A database outage could leave a container reporting healthy indefinitely instead of restarting. It now checks the database directly.

---

## v3.0.0 - August 10, 2026 **(highlights)**
**Ephemeral Authenticated Scanning, Background Scan Jobs, Deep-Parse Detection**

The full 3.0.0 release, covering everything shipped since 2.3.1. The headline change: scanning a site behind a login now uses your username and password once, then throws them away immediately, nothing is ever saved. Scans also run in the background with real progress instead of one long-loading page, and the engine gained 43 new checks (695 total) that actually parse a page's forms, scripts, and cookies instead of skimming the text. Everything else, security fixes first, is below.

### Changes
- [ShieldCheck] **[SECURITY]** **Webhooks Are Now Signed and Logged**
  Every webhook delivery now carries a signature your receiving endpoint can check to confirm it really came from VulnRadar, not somewhere else pretending to be us. If a delivery fails, we retry it once and email you if it still doesn't go through. You can also edit or pause a webhook without deleting and recreating it.
- [Key] **[SECURITY]** **API Keys Can Be Scoped to Exactly What They're Allowed to Do**
  New API keys can be limited to just running scans, just reading results, or just deleting scans, instead of always getting full access. Older keys keep working exactly as before.
- [BellRing] **[CHANGED]** **Critical/High Alerts Now Only Fire on Genuinely New Findings**
  The email alert for critical and high severity findings now compares against the site's previous scan and only fires when something new actually shows up, instead of re-sending the same alert every time a scheduled scan reruns and finds the same issue it found last time.
- [Settings] **[FIXED]** **Every Admin Setting Is Now Actually Wired Up**
  A large batch of admin panel settings, from session timeouts to password requirements to rate limits, were previously editable but silently ignored by the app. They're all connected now, so changing a setting in the panel actually changes how VulnRadar behaves.
- [Globe] **[ADDED]** **Extension: Snooze Site Alerts, Move the Popup**
  You can now snooze the on-page site alert for 24 hours instead of only permanently muting a site, and choose which corner of the screen it appears in.
- [Lock] **[SECURITY]** **Authenticated Scanning Is Now Fully Ephemeral**
  You can now scan a website that sits behind a login screen without worrying about where your password ends up. Give VulnRadar your username and password (or a login cookie from your browser) and it's used once, to get past the login screen, then forgotten immediately: it's never saved to disk and never shows up anywhere in your scan history, only the fact that the scan happened while logged in. We even stopped keeping a leftover storage spot for these details that an earlier version had added, since there's nothing left that needs saving. This is turned on by default; an admin can switch it off in the settings.
- [Fingerprint] **[ADDED]** **Real Browser Login, Honest About Bot Protection**
  When you ask VulnRadar to log in to a site for you, it now opens a real, temporary browser window behind the scenes, waits for the login page to fully load, then fills in and submits the login form exactly like a person would. If that page turns out to be one of those 'prove you're not a robot' checks or a security wall, the scan now stops and tells you plainly that it got blocked, instead of guessing wrong and telling you your password was incorrect. To confirm the login actually worked, it compares what the page looks like logged in versus logged out, rather than just assuming success because the page loaded.
- [Code] **[CHANGED]** **authReport on Every Authenticated Scan Response**
  Every time you run a login-based scan, VulnRadar now tells you plainly whether the login actually worked, failed, or worked at first and then dropped partway through. Before, if the login stopped working midway through a scan, you'd just get a normal-looking result back with no warning that it had quietly stopped checking the logged-in parts of the site. Now you'll see a clear message explaining exactly what went wrong: a blocked login, a rejected password, a login page VulnRadar couldn't find, or a site that could be reached before but not after logging in.
- [Activity] **[CHANGED]** **Scans Are Background Jobs With Real Per-Category Progress**
  Starting a scan no longer means holding a request open and hoping it doesn't time out. VulnRadar now hands you back a scan right away and works on it in the background, showing you which step it's on (what it's checking right now, and how many steps are left) as it goes, until it's done or it fails. If something goes badly wrong and a scan gets stuck, it now automatically gives up and marks itself as failed after a set amount of time (5 minutes for a normal scan, up to 30 minutes for a big bulk scan) instead of hanging there forever. Email alerts and other automatic notifications now go out only once the scan is truly finished, not the moment you clicked the button.
- [Timer] **[ADDED]** **Cancel a Running Scan**
  Started a scan by mistake, or one that's taking forever and you just want to stop? You can now cancel it while it's still running instead of waiting it out. It immediately gets marked as cancelled. If the scan already finished (or already failed) by the time you try to cancel it, you'll just be told there's nothing left to stop.
- [ScanSearch] **[ADDED]** **Scanner Engine: 43 New Checks That Actually Parse the Page**
  43 new checks, running on a smarter engine that actually reads and understands a page instead of just skimming the text for suspicious words. It looks at your forms (does the login form leak a password, is it missing the hidden field that stops forged submissions), your scripts (are they loaded from somewhere they shouldn't be), your site's security settings, and every outside site your pages quietly talk to. Every result now comes with a more honest confidence rating (some checks are much more certain than others, and the score now reflects that) and shows you the exact piece of text or setting that triggered it, and duplicate warnings about the same underlying problem get merged into one instead of cluttering your report. New things it looks for include login tokens stored somewhere insecure, sites that could be embedded and tricked into looking like something else, link redirects that could be abused, and outdated versions of common website software. Total checks: 695, up from 652.
- [ShieldCheck] **[SECURITY]** **Sessions and API Keys Can Be Bound to Their Subnet**
  Two new optional security settings for admins: you can now require that your login session and your saved API keys only work from roughly the same internet connection they started on. If someone steals your login session and tries to use it from a completely different network, VulnRadar can automatically log them out, warn you by email, and let you simply log back in as normal. Saved keys used by other programs to talk to VulnRadar get the same protection, locked down even tighter by default. Both of these are switched off unless an admin turns them on.
- [BellRing] **[ADDED]** **Team Invites Land in the Notification Bell**
  Invite a teammate who already has a VulnRadar account and they'll now see the invite pop up right in the app, with an Accept button, not just buried in their email inbox where it might get missed. If they don't have an account yet, they'll still just get the invite by email, since there's nowhere else to show it until they sign up. And invites that have already been accepted, expired, or cancelled clean themselves up automatically so you never see an Accept button for an invite that no longer works.
- [Settings] **[CHANGED]** **Admin Settings Is a Real Registry-Driven UI Now**
  Admin settings moved out of one long, confusing list into clear tabs (General, Branding, SEO, Features, Billing, Rate Limits, Scanning, Authentication, AI, Demo, Advanced), each one telling you what a setting actually does and what values it accepts, and whether a change takes effect right away or needs a restart first. Typing in a bad value now gets caught and rejected instead of silently breaking something, and any setting can be reset back to how it shipped with a single click if an admin isn't sure what it used to be.
- [Globe] **[CHANGED]** **Browser Extension Rewrite: Chrome and Firefox**
  The browser add-on for Chrome and Firefox got rebuilt from the ground up and actually works properly now on both browsers. You can turn on automatic scanning of whatever site you're browsing, choosing whether it triggers when a page loads, when you switch to that tab, or when the address changes, and it won't ever scan VulnRadar's own pages. The little popup window is more reliable about showing you what's actually happening (connecting, scanning, showing results, or an error), and its colors now match the main site exactly.
- [Database] **[CHANGED]** **Database Schema: 5.0.0 Through 5.6.0**
  For anyone running their own copy of VulnRadar on their own server: the way information is stored behind the scenes got updated several times to support everything else in this release, like the feedback button on findings, the notification bell, and the network-lock security options above. If you're self-hosting, run the update command (npm run db:migrate) to bring your installation up to date. If you use the hosted version at vulnradar.dev, this already happened for you automatically and there's nothing to do.
- [Crown] **[SECURITY]** **Super Admin: the First Account Can Never Be Modified From the Admin Panel**
  If you're the first person who ever signed up on a self-hosted VulnRadar (usually the person who set the whole thing up), your account is now permanently protected from every other admin, even a compromised or rogue one. Nobody, not even you clicking around the admin panel by accident, can demote, disable, or delete that account, and that protection can't be handed off to anyone else. Everything you'd normally do yourself, like changing your own password or turning on two-step login, still works exactly the same. This exists so the one account everything else depends on can never get locked out.
- [Layout] **[CHANGED]** **Simpler /dashboard: URL + Right-Side Service Probes**
  The main scan screen is simpler now. Instead of picking from a long dropdown of connection types and clicking through a separate popup to choose what to check, you just type in a website and, if you want, pick a few extra things to check on the side with one click. You can always see and switch between Quick, Deep, and Bulk scanning without losing your place. The main security checks always run, no extra clicking needed.
- [Server] **[ADDED]** **Service Probes by Hostname, Not URL Scheme**
  You can now check whether a website also has other services running on it, like a remote-access tool or an email server, just by picking the service from a list, without needing to know any special web address format to ask for it. Leave the connection number blank and VulnRadar just uses the normal one for that service. Only a safe, approved list of services can be checked this way, so this can't be turned into a tool for poking around at random.
- [Link2] **[ADDED]** **URL State for /dashboard (mode + probes + ports)**
  The dashboard address bar now shows exactly what scan settings you've picked, so you can copy the link and send it to someone else and they'll see the same setup, and your browser's back and forward buttons work properly when you're changing scan options instead of doing nothing.
- [Shield] **[CHANGED]** **Detection Engine v3.0.0**
  The number we use to track the scanning engine's version moved up alongside the dashboard redesign above. Nothing about what gets checked or how it's rated actually changed here: same checks, same categories, same severity ratings. It's just a label update to reflect that the scan screen itself changed.
- [Code] **[ADDED]** **API: `probes` Field on /api/v3/scan**
  If you connect other tools to VulnRadar to trigger scans automatically, you can now also ask it to check for extra services like remote access or email on the same request, not just the website itself. And if you just type a plain address without 'https://' in front, VulnRadar now adds that for you automatically instead of failing.
- [Settings] **[ADDED]** **Per-Family Check Toggle (12 Categories, Auto-Disable for HTTP)**
  A new panel on the scan screen lets you turn any group of checks on or off before you scan, in case you only care about certain things, like cookie security or email settings, and want to skip the rest. If you scan a site that isn't using a secure (locked padlock) connection, the checks that only make sense for secure sites turn themselves off automatically, though you can switch them back on yourself if you want.
- [Code] **[CHANGED]** **API Moved to v3: v1 and v2 Removed**
  If you connect your own tools or scripts to VulnRadar, the older way of doing that has been fully retired, and everything now goes through the newest version. If you were still using an old integration, you'll need to switch it over. The documentation only shows the current way of doing things now.
- [Server] **[ADDED]** **Raw IPv4 Targets + Probe-Only Mode**
  You can now scan a bare numeric internet address directly, not just a normal web address like example.com. Since checks that need a proper website name (like checking security headers or cookies) can't run against a plain number, VulnRadar just skips those automatically and tells you so on screen, while still checking anything else that applies, like other services running on that address. You still can't scan private or internal network addresses, same as always.
- [Eye] **[ADDED]** **BrowserBase Live Browser Sessions (View Page)**
  Self-hosted admins can turn on an optional feature that adds a 'View Page' button to your scan results. Clicking it opens a live, temporary browser window showing the actual website, right there in a popup, with a countdown timer and a button to end the session early. Nothing about what you view is saved anywhere, and the session automatically closes itself after 5 minutes at most.
- [Settings] **[CHANGED]** **Dashboard: Scanners + Probes Split + Compact Controls**
  The one big 'All Scanners' button on the dashboard split into two smaller, clearer dropdowns, one for choosing which security checks to run and one for choosing extra services to check, both sitting neatly next to the Scan button. Everything on the scan bar is a bit more compact now to match the rest of the dashboard.
- [ServerCrash] **[FIXED]** **Dashboard No Longer Crashes on an In-Progress Scan**
  If you were watching a scan while it was still running, the dashboard could sometimes mistake it for a finished scan and crash with a 'Couldn't load VulnRadar dashboard' error, even though the scan was working fine. It now correctly waits until a scan is actually done before trying to show you the results.
- [Link2] **[ADDED]** **Deep-Linkable Findings: ?finding=<id> Selects a Specific Result**
  You can now send someone a link that opens a scan result and jumps straight to one specific issue, already selected, instead of making them scroll through the whole list to find what you're talking about. Clicking a different issue updates the link to match, so you can always copy the address bar and share exactly what you're looking at.
- [Bug] **[FIXED]** **AI Chat Could No Longer Send at Exactly the Character Limit**
  If you typed a message to the AI chat that used every last one of the 500 allowed characters, the send button would just stop working instead of letting you send it, even though your message was perfectly valid. Fixed: filling the box all the way up no longer blocks you from sending it.
- [Lock] **[SECURITY]** **Two IDOR Hardenings Moved Into the SQL Itself**
  Deleting a scan or replacing an old saved key with a new one already made sure you could only do it to your own account's data. That safety check now happens in two places instead of one, so a future coding mistake somewhere else in the app can't accidentally let someone touch another person's scans or keys.
- [ShieldCheck] **[FIXED]** **Admin Account-Delete Could Throw on Its Own FK Constraints**
  Deleting a staff account (for example, when someone honors a data-deletion request or removes an ex-employee) used to fail with an error if that staff member had ever resolved a security alert or changed a system setting, leaving the deletion stuck halfway done. Fixed, so removing a staff account now always completes cleanly.
- [Bug] **[FIXED]** **ApiResponse.forbidden Was Dropping Its meta Argument**
  Some 'access denied' error messages from the app were missing extra helpful details that other error messages normally include, due to a small inconsistency in how those messages got built. Fixed. Separately, changing your password from your profile page used to accept any password of 8 characters or more with no other requirements, unlike signing up or resetting a forgotten password, which are stricter. Now all three follow the same password rules.
- [AlertTriangle] **[SECURITY]** **CodeQL Sweep: SSRF Probes, Duplicate HTML-Stripping, a Host-Substring Bug**
  An automated code-scanning tool caught a handful of quiet bugs and we cleaned them all up. One check could be fooled by a fake website address that just happened to contain a real, trusted address as part of a longer, lookalike name. A few duplicated pieces of internal cleanup code got consolidated into one shared version so they can't drift apart and behave inconsistently. And a handful of checks that make their own test connections to your website now each have their own timer, so one slow response can no longer silently cancel every other check that was running alongside it.
- [Package] **[ADDED]** **Signed Releases: Cosign, SBOM, SHA256SUMS**
  For anyone who downloads and runs VulnRadar themselves: every release now comes cryptographically signed, along with a full list of exactly what software went into building it. This lets you actually verify that what you downloaded is the real thing and hasn't been tampered with, rather than just trusting that it is.
- [FileText] **[FIXED]** **A Stale security.txt Was Silently Shadowing the Real One**
  The page where security researchers find out how to report a vulnerability to us was stuck showing old, outdated contact information no matter how many times we updated it, because a leftover copy of the page was quietly taking priority over the real one. Removed the leftover copy, so it now always shows the current, correct information.
- [CheckCircle2] **[ADDED]** **Test Suite: 168 Files, 5,696 Tests**
  Behind the scenes, we now automatically check our own work far more thoroughly before anything ships: 5,696 automated checks across the whole product, covering things like logging in, billing, scanning, teams, and saved keys, up from a much thinner safety net before. This doesn't change anything you see, but it means real bugs are far more likely to get caught before they ever reach you.
- [GitMerge] **[FIXED]** **Scanner Registry: Check-ID Collisions Now Resolve by Category, Not Load Order**
  78 of our security checks had accidentally ended up duplicated in more than one place over time, and in every case we found, the older, less accurate copy was quietly the one actually running instead of the improved version we thought was live. That's fixed now, so the checks you're seeing results from are the properly tuned, up-to-date ones.
- [FileSearch] **[CHANGED]** **Scanner Engine Rework: Real Evidence, Fix Code, and References on Every Check**
  Every one of the 652 checks in the scanner now shows you the real, specific piece of evidence it found instead of a vague placeholder, plus ready-to-use fix instructions for common website setups and links to trustworthy sources you can read for more detail. Four new categories of checks were added, including ones specifically aimed at problems common in AI-generated code. You can now also mark any individual result as a false alarm, confirmed, or not applicable, which helps make future scans more accurate.
- [ShieldAlert] **[SECURITY]** **Seven Internal Security Audits, 83 Findings Closed**
  Before this release shipped, we ran ourselves through seven rounds of internal security testing and fixed 83 problems we found along the way. Highlights: a trick that could have redirected the scanner to visit places it shouldn't; a gap that could let a lower-level staff member sneak extra permissions by changing an email address; your two-factor login codes and connected Discord account are now encrypted while stored instead of sitting in plain text; a website can no longer trick your browser into taking an action on VulnRadar without you meaning to; a timing bug that could let someone bypass usage limits by sending requests at exactly the same moment got closed; two-factor codes and backup codes can no longer be reused or replayed; and a few checks that look for exposed files (like backup.sql or docker-compose.yml) now confirm the file is exposed without echoing its actual contents back to you.
- [Bot] **[ADDED]** **Site-Wide AI Chat Widget**
  There's now a chat button in the corner of every page. Click it and you can ask questions about your scan results, how the product works, or what a particular warning means, and get an answer written out for you in real time (on your phone, it opens as a panel from the bottom). Self-hosted admins can connect it to a range of different AI services. If the AI shows its own step-by-step thinking before answering, that gets tucked behind a 'View reasoning' toggle instead of cluttering the conversation. Its knowledge of VulnRadar's own features stays up to date automatically as the product changes, and you can turn it off entirely in your account settings if you'd rather not use it.
- [Sparkles] **[ADDED]** **AI-Assisted Finding Verification**
  Not sure whether a specific result is a real problem or a false alarm? You can now ask the AI assistant to double-check any finding for you: it looks at the evidence, checks the site again itself, and gives you a plain verdict (confirmed, likely a false alarm, or unclear) along with a short reason why. You need to be signed in to use this.
- [Gauge] **[FIXED]** **Scan Results: Danger Score and Engine Confidence on the Verdict Card**
  Your scan results now show an overall danger score out of 10 and how confident the scanner is in its own findings, right up top where you'll actually see it. We also stopped a handful of odd false alarms: VulnRadar no longer flags its own website's code as suspicious when you scan vulnradar.dev, example code shown on our documentation pages no longer gets mistaken for a real vulnerability, and a missing, purely optional network header is no longer reported as if it were leaking information.
- [CheckCircle] **[CHANGED]** **Landing Page: Real Counts, Real Sample Finding**
  The numbers shown on our homepage (how many checks we run, how many categories, how fast a scan is) now always reflect what the scanner actually does, instead of being separately written copy that could quietly go stale. The example result shown there is a real one too, not a made-up sample.
- [Key] **[SECURITY]** **2FA: Inline QR Code, Password Gate on Setup, Fails Closed Without Encryption**
  Setting up two-step login (the kind where you scan a code with an authenticator app) now generates that scannable code directly in your own browser instead of sending your secret code out to an outside service just to draw the picture. Turning on two-step login also now requires typing your password again first, so someone who hijacked your browser session can't quietly set up their own authenticator app on your account behind your back.
- [Layout] **[CHANGED]** **Auth Pages: Split-Panel Layout**
  The login, sign-up, and password-reset pages got a visual refresh: your form now sits on one side of the screen with a scan-themed graphic on the other, instead of a plain centered box.
- [CreditCard] **[CHANGED]** **Billing: Stripe Elements Instead of Embedded Checkout**
  The checkout screen for subscribing to a paid plan got switched to a more reliable payment form, and a leftover bug from that switch that could have broken checkout for some people got cleaned up.
- [Bug] **[FIXED]** **Webhook Plan-Change Fallback Could Never Resolve a Real Plan**
  If you changed your subscription plan through the billing portal (rather than directly on our pricing page), your account could get silently downgraded to the free plan instead of correctly recognizing your new paid plan. Fixed, so plan changes made through the billing portal now apply correctly.
- [BarChart3] **[ADDED]** **Admin: Bigger Stats Dashboard, On-Demand Cleanup Trigger**
  For admins: the stats overview doubled from 5 numbers to 10, and there's now a button that lets you clean up old data right away instead of waiting for it to happen automatically on its own schedule.
- [Globe] **[FIXED]** **Extension Follow-Ups: Bearer-Token Auth, CSRF Exemption, Firefox Fixes**
  A batch of fixes for the browser extension: it can now properly recognize you as logged in without needing to share cookies with the main website, it works correctly on more versions of Firefox, and we caught and fixed a real data-loss bug where saving your extension settings was silently erasing your last scan result every single time.
- [AlertTriangle] **[FIXED]** **Signup Was Broken in Production (2.3.1/2.3.2): scrypt Memory Limit**
  For a stretch of time on versions 2.3.1 and 2.3.2, new sign-ups were completely broken due to a tiny miscalculation in the password-scrambling settings, off by a fraction of a percent, though existing accounts could still log in fine the whole time. Fully fixed now, with some extra headroom built in so the same kind of rounding error can't cause this again.
- [Zap] **[PERFORMANCE]** **Password Hashing Moved Off the Event Loop**
  Every time someone signed up, logged in, changed their password, or used a backup two-factor code, the whole server used to briefly freeze for everyone else, including anyone whose scan was actively running at that exact moment. That freeze is gone: password checks now run in a way that doesn't block anything else on the server while they happen.
- [Search] **[ADDED]** **SEO: Sitemap, Robots.txt, and Per-Page Metadata**
  25 of our public pages now have their own proper title and description that show up correctly in search results and when shared on social media, instead of all 43 pages sharing one generic title like before. This mostly helps people find VulnRadar through search engines and see the right preview when a link gets shared.
- [RefreshCw] **[FIXED]** **Periodic Cleanup Moved In-Process, Actually Runs Every 5 Minutes**
  The automatic housekeeping that clears out old data was supposed to run every 5 minutes, but a bug meant it was actually only running once every 24 hours the whole time, despite saying otherwise in the startup logs. Fixed, so cleanup now genuinely runs every 5 minutes like it always should have.
- [ServerCog] **[PERFORMANCE]** **Health Check Now Actually Checks the Database**
  For self-hosters: the automatic 'is this server healthy' check used by Docker was never actually testing whether the database was reachable, so a dead database connection could report everything as fine while every real request was failing. It now genuinely checks the database, and a few common lookups (like usage history and audit logs) got sped up too.
- [Package] **[CHANGED]** **Dependency Maintenance: ~30 Dependabot Bumps, 8 Security Alerts Cleared**
  Routine behind-the-scenes maintenance: about 30 small software updates and 8 known security weaknesses in the underlying tools we build with got patched, none of which change anything you'll notice while using VulnRadar.

---

## v2.3.1 - June 20, 2026
**Tooling Hardening, Node 22 LTS, Schema Version Gate**

A behind-the-scenes stability release with no changes to what you see or use day to day. We rebuilt our internal database update tooling to be more reliable, added a safety check so the app refuses to start with a clear error instead of behaving unpredictably if its database ever falls out of sync, and updated 75 of the software packages we depend on to their latest safe versions.

### Changes
- [GitMerge] **[CHANGED]** **Scripts Restructured Into Version-Aware Framework**
  For anyone self-hosting VulnRadar: the tools used to set up and update your own database got reorganized into something much easier to maintain going forward, which mostly means fewer surprises when you update your installation.
- [Shield] **[SECURITY]** **Schema Version Gate at App Startup**
  For self-hosters: if your installation's database is out of date, the app now refuses to start at all and shows you a clear, obvious error telling you exactly which command to run to fix it, instead of appearing to work but then crashing later with a confusing error the first time something actually needed the missing update.
- [Database] **[FIXED]** **Migration DDL Now Matches instrumentation.ts Exactly**
  For self-hosters: we went through every table our setup and update scripts create and made sure each one actually matches what the live app expects. 11 out of 15 had small mismatches (one was building an entirely different kind of table than the app needed), all now fixed, and 9 tables that were never actually used by anything got removed to simplify things.
- [Settings] **[CHANGED]** **Migration Always Runs, Even On Same Version**
  For self-hosters: running the update tool again on a database that's already current is now completely safe and actually useful, since it double-checks and quietly fixes anything that might have been missed or manually changed, instead of assuming there's nothing left to do.
- [ServerCog] **[CHANGED]** **Node 22 LTS Is the New Minimum**
  For self-hosters: running your own copy of VulnRadar now requires a newer, more current version of Node (the software that actually runs the app) to be installed on your server. If you're on an older Node version, you'll need to upgrade before this update will run.
- [Package] **[CHANGED]** **75 npm Packages Bumped to Latest Within Major**
  Routine behind-the-scenes maintenance: 75 dependencies bumped to their latest within-major versions. Nothing you'll notice directly, just keeping things current and secure.
- [Wrench] **[CHANGED]** **.npmrc Auto-Approves Native Postinstalls**
  For self-hosters and contributors: installing the project's dependencies now completes correctly on the first try instead of silently skipping a couple of setup steps that would have caused the app to break the moment it actually ran.
- [Bug] **[FIXED]** **Detection Engine v2.4.0: False-Positive Overhaul**
  A big cleanup pass to cut down on false alarms in your scan results. Dozens of checks were flagging completely normal, harmless things as problems, like the word 'description' getting mistaken for a security risk because it contains the letters 'des', or every single modern website getting flagged for something that's actually standard and safe. A phone-number detector was even mistaking Cloudflare's internal tracking codes for real phone numbers. All of these got fixed or removed, and a handful of checks that were quietly reporting the exact same issue twice under different names got merged into one. The result: scanning our own website used to turn up 177 warnings, most of them noise; now it turns up about 70, and every one of them is a real, correctly labeled finding.
- [ScanSearch] **[ADDED]** **Scanner Detection Engine: 311 → 709 Checks, 12 Categories**
  Nearly doubled our security checks, from 311 to 709, and organized them into 12 clear categories: things like security headers, cookies, email setup, connection security, and website configuration. New categories include checks for email authentication (helps stop someone from spoofing your email address), and for the actual programming APIs your website exposes to other software. Every one of the 709 checks is now unique, with no duplicates counted twice.
- [Network] **[ADDED]** **9 New Protocols: SSH, SFTP, SMTP, SMTPS, IMAP, IMAPS, POP3, POP3S, MongoDB**
  VulnRadar can now check for 9 more types of services beyond just websites: things like remote-access tools, file transfer, email servers, and database software. Before this, scanning was limited to plain web traffic.
- [Layers] **[CHANGED]** **Scanner Categories UX: New Icons + Total Count Bumped**
  The scan setup screen now shows all 12 check categories with their own icons, and the total check count shown across the site is now accurately '700+' instead of the older, out-of-date '310+'.
- [ShieldAlert] **[SECURITY]** **stripe/setup-products: Now Requires Admin Session**
  A behind-the-scenes tool for setting up our payment plans had no protection at all, meaning anyone who found it could have rewritten our live pricing and billing setup. It now requires admin sign-in, closing a serious security hole before it could ever be exploited.
- [Globe] **[SECURITY]** **scan/discover SSRF Closed (batchHttpCheck)**
  The subdomain-finder feature was checking addresses without first confirming they were safe to visit, which could have been abused to make VulnRadar's own server quietly poke at private, internal computers it should never be able to reach. Fixed, with the same safety checks used everywhere else in the scanner.
- [Eye] **[SECURITY]** **Discord OAuth Callback: No More PII in URL**
  Linking your Discord account used to briefly expose your email address in the web address itself while you were being redirected back to VulnRadar, which could end up saved in your browser history or in server logs elsewhere. That's no longer included. We also fixed how your IP address gets recorded during that process so it can't be faked.
- [Database] **[SECURITY]** **lib/database/db-utils: SQLi in getUserById/updateUser/batchDelete/batchUpdate Closed**
  Closed several internal weaknesses in how VulnRadar looks up and updates account information, the kind of flaw that could theoretically have let someone slip unauthorized commands into the database through a backend bug. Sensitive fields like your account role, password, and two-factor secret can no longer be changed through any path except the ones specifically meant to change them.
- [Globe] **[SECURITY]** **safeFetch: Non-Canonical IPv6 Bypass Closed**
  Found and closed three sneaky ways someone could have disguised a private, internal network address well enough to trick the scanner into treating it as a normal, safe website to scan, each one a differently formatted version of the same private address. All formats are now recognized and blocked equally.
- [Timer] **[SECURITY]** **Discord OAuth State: Bound to userId, TTL 5min → 60s**
  If a Discord-login link ever leaked or got forwarded to someone else, it used to work for up to 5 minutes for whoever clicked it, even a different logged-in person. That window is now 60 seconds, and the link is now tied specifically to the account that started it, so someone else's copy of the link simply won't work on your account.
- [Timer] **[SECURITY]** **Email 2FA Code Consumption: TOCTOU Closed**
  There was a narrow timing gap where sending the same email two-factor code twice, at nearly the same instant, could let both attempts succeed instead of only the first. Closed, so an email code can only ever be used once, exactly as intended.
- [Globe] **[SECURITY]** **Login: Open-Redirect via ?redirect= Closed**
  A specially crafted VulnRadar login link could have sent you to a completely different, malicious website right after you logged in, which is exactly how a convincing phishing scam works. Login links can no longer redirect anywhere outside VulnRadar itself.
- [RefreshCw] **[FIXED]** **Stripe Webhook: Idempotent on Retries**
  If our payment processor tried sending the same billing update twice, which can happen normally as a safety measure on their end, your account could have been upgraded or credited twice for the same payment. Fixed, so a repeated notification is now recognized and safely ignored the second time.
- [Bell] **[SECURITY]** **Admin Notifications: action_url Scheme-Validated**
  An admin creating a site-wide announcement could set its button to run hidden code instead of just linking somewhere, which would then run in the browser of any other admin who clicked it. Announcement links are now restricted to only pointing at real web addresses.
- [Mail] **[SECURITY]** **Mass Email Preview: HTML Injection Closed**
  The preview screen for composing a mass email to users would actually run any code typed into the subject or body instead of just showing it as plain text, meaning a staff member typing certain special text could accidentally trigger it running right in their own browser while drafting. Fixed so the preview always shows plain text safely.
- [Settings] **[SECURITY]** **env.ts: Stricter Validation at Startup**
  For self-hosters: the app is now much stricter about checking your setup settings when it starts, catching things like a weak security key or a mistyped support email address right away, with a clear error message, instead of quietly running in a less secure or broken state without telling you.
- [Database] **[PERFORMANCE]** **DB Pool: statement_timeout + query_timeout + application_name**
  For self-hosters: one unusually slow database request used to be able to tie up the whole database connection pool and slow the entire app down for everyone. Slow requests now automatically get cancelled after 30 seconds instead of hanging indefinitely.
- [Container] **[CHANGED]** **Dockerfile: Node 20 → Node 22**
  For self-hosters running VulnRadar in Docker: it now runs on a newer, still-supported version of Node, since the old one stopped receiving security fixes. Also, if you forget to set a real encryption key when setting things up, the app now refuses to start instead of quietly running with a fake placeholder key that would leave your data poorly protected.
- [Package] **[CHANGED]** **Removed Unused bcrypt, Pinned Caret Deps**
  Routine housekeeping: removed an unused piece of software that was sitting in the project for no reason, and locked a few others to exact versions so unrelated updates can't unexpectedly change behavior.
- [Database] **[SECURITY]** **Database Cleanup: Single Transaction, Always-Released Client**
  The automatic job that clears out old, expired data now either finishes completely or changes nothing at all if it hits an error partway through, instead of potentially leaving things in a half-cleaned, inconsistent state.
- [FileText] **[ADDED]** **Test Count: 39 → 65**
  For contributors: we now automatically double-check our own work more thoroughly before anything ships, including verifying that the private-address-disguise fixes above actually hold up against every variation we know about. Test count went from 39 to 65, all passing.

---

## v2.3.0 - June 20, 2026 **(highlights)**
**Comprehensive Security Patch & Quality Update**

A dedicated security release. We reviewed the entire codebase and fixed every serious issue we found, covering logins, sessions, file uploads, webhooks, and who's allowed to access what. We also added safety nets so future updates are far less likely to reintroduce problems like these, and wrote a large set of automated tests specifically for the most security-sensitive parts of the app.

### Changes
- [Shield] **[SECURITY]** **Database SSL Now Enforces Certificate Validation**
  For self-hosters who turned on secure database connections thinking it protected them: it didn't actually check that the connection was genuinely secure, which meant someone positioned on the network in between could have secretly intercepted it anyway. This was the single biggest issue found in our full security review. It's now properly verified.
- [Lock] **[FIXED]** **Fixed: Resend-Verification Token Hashing Regression**
  If you asked us to resend your account verification email, the link inside it never actually worked. Fixed, so a resent verification link now works exactly like the original one.
- [ShieldAlert] **[FIXED]** **Fixed: 'Log Out All Sessions' Cleared the Wrong Cookie**
  Clicking 'Log Out All Sessions' correctly logged you out everywhere on our end, but your own browser kept sending along a leftover login cookie afterward, due to the wrong cookie being cleared. Fixed, so the actual login cookie now gets cleared properly.
- [Lock] **[SECURITY]** **Removed All Hardcoded Fallback Secrets**
  For self-hosters: a couple of important security keys used to have a hidden built-in backup value if you forgot to set your own, which is exactly the kind of thing that should never happen with a security key. If you forget to set them now, the app simply won't start, with a clear message telling you what's missing.
- [ShieldCheck] **[SECURITY]** **Zod-Validated Environment at Startup**
  For self-hosters: the app now checks that your setup is fully and correctly configured the moment it starts, refusing to run at all if something important is missing, instead of starting up fine and then failing every single request once real visitors show up.
- [Globe] **[SECURITY]** **IP Spoofing Fix (TRUSTED_PROXY_CIDR)**
  The way VulnRadar figured out your actual internet address for things like rate limiting could previously be tricked pretty easily by faking a header in the request, letting someone pretend to be a different visitor than they really were. For self-hosters running behind a proxy, a new setting lets you tell the app exactly which network hops to trust, closing that trick.
- [Image] **[SECURITY]** **Avatar Upload Hardening (XSS Prevention)**
  Uploading a profile picture used to accept a specially crafted image file that could actually run hidden code in the browser of anyone who viewed it, like a booby-trapped picture. Uploads are now restricted to normal, safe image formats only, capped at 5 MB.
- [Key] **[SECURITY]** **Backup Codes Bumped to 80 Bits (NIST 800-63B)**
  Your two-factor login backup codes (the ones you use if you lose access to your authenticator app) are now much harder to guess, following official government security guidance on how random they need to be. They're still formatted in easy-to-read groups, just longer.
- [Eye] **[SECURITY]** **Stripe Webhook No Longer Logs Customer Email**
  Your email address was being written into internal system logs every time a billing event happened, and those logs can stick around indefinitely. That's been removed, so your email no longer ends up sitting in a log file it doesn't need to be in.
- [Eye] **[CHANGED]** **Icon-Only Buttons Get aria-label**
  If you use a screen reader, about 15 buttons across the app that only showed an icon (no text label) now properly announce what they actually do, on profile, admin, sharing, pricing, and the login/sign-up pages.
- [Eye] **[CHANGED]** **Form Labels Now Bound to Inputs**
  About 15 forms across the app (profile, security, admin, billing, search boxes) now have their field labels properly connected to the field itself, so if you use a screen reader, clicking or tabbing to a field correctly announces what it's asking for.
- [Layers] **[CHANGED]** **ConfirmDialog Migrated to Radix AlertDialog**
  The confirmation popup you see before deleting or canceling something used to trap keyboard and screen-reader users, since it didn't support closing with the Escape key or properly holding your focus inside it. Fixed, and six other popups across the app (canceling a subscription, managing team members, staff tools, and more) got the same treatment.
- [Layers] **[ADDED]** **Per-Route Error Boundaries + Loading States**
  If something went wrong on one page, like your Profile, it used to take down the whole app with a blank generic error screen. Now a problem on any major page (Dashboard, Profile, History, Admin, Shares, Teams, Pricing, or Compare) shows a friendly error with a Try Again button while the rest of the app, including navigation, stays working normally. Those pages also now show a proper loading spinner while fetching data instead of a blank flash.
- [Shield] **[SECURITY]** **Typecheck and npm audit Now Block Merges**
  For contributors: code with real programming errors or known serious security weaknesses in its building blocks can no longer get merged into the project by accident. Both now get caught and blocked automatically before anything ships.
- [Settings] **[CHANGED]** **SECURITY.md Updated to v2.4.x**
  Our security policy page, which tells researchers how to report a vulnerability to us, was still listing old, unsupported versions as the ones we'd accept reports for. Updated to correctly point at the current version.
- [Code] **[ADDED]** **Test Infrastructure: vitest + 39 Tests**
  For contributors: there were no automated tests checking our own work before this release. Now there are 39, covering the most security-sensitive parts of the app like encryption, Discord login, password handling, rate limiting, and the avatar upload fix above, so those areas get double-checked automatically going forward.
- [Shield] **[SECURITY]** **API Key Validation is Now O(1)**
  Checking whether one of your saved keys (used by other programs to connect to VulnRadar) is valid used to get slower the more keys existed in our system overall. It's now instant no matter how many keys exist, which matters most as VulnRadar grows.
- [Lock] **[SECURITY]** **Stronger Password Hashing**
  The way your password is scrambled and stored got strengthened to current best-practice standards, making it harder to crack even if our database were ever stolen. You won't notice any difference: your existing password still works exactly the same.
- [ShieldCheck] **[SECURITY]** **Signed Discord OAuth State**
  Logging in with Discord is now cryptographically signed on our end, closing off a theoretical way someone could have forged the login process and signed in as a different linked Discord account.
- [Fingerprint] **[SECURITY]** **Strong Device Trust Cookies**
  The 'remember this device' feature used to identify your device with a code weak enough to potentially be guessed. It now uses a much stronger, effectively unguessable code instead.
- [ShieldAlert] **[SECURITY]** **Re-authentication for Sensitive Changes**
  Changing your name, email, or profile picture now requires you to type your current password first. Before this, if someone stole your logged-in browser session, they could quietly take over your account just by changing the email on file, without ever needing your actual password.
- [Timer] **[SECURITY]** **2FA Rate Limit + Timing-Safe Compare**
  Entering your two-factor login code is now limited to 5 tries every 5 minutes per account, closing off a way someone could have tried to guess your 6-digit code by brute force.
- [Network] **[SECURITY]** **SSRF Re-Validation**
  Testing a webhook (a way to automatically send scan results to another app) or setting up a scheduled scan now double-checks that the target address is actually safe right before contacting it, closing off a rare path where an unsafe address could have slipped through.
- [Eye] **[SECURITY]** **Minimal Staff Endpoint**
  The public page listing our staff used to show more personal detail than it needed to, like profile pictures and seniority order, information that could help someone target a specific staff member with a scam. Now it only shows a name and role.
- [Lock] **[SECURITY]** **Email & Reset Tokens Hashed at Rest**
  Email verification links and password-reset links are now stored in a scrambled form rather than as-is, so if our database were ever stolen, those old links couldn't be used directly to break into accounts.
- [Mail] **[SECURITY]** **No Email Bodies in Logs**
  If an email we tried to send you failed to go out, we used to log the entire email, which can include your password-reset link or two-factor code. Now only basic details like the recipient and subject get logged, never the sensitive content itself.
- [Shield] **[SECURITY]** **Tightened Content Security Policy**
  Tightened one of the security settings our own website uses to control what outside content is allowed to run on it, closing it down to only the specific trusted services we actually use instead of trusting anything broadly.
- [ServerCrash] **[SECURITY]** **1 MiB Request Body Cap**
  Any request sent to our servers is now capped at a reasonable size, which stops someone from trying to overload our servers by sending an enormous, multi-gigabyte request.
- [Timer] **[SECURITY]** **Per-Email Forgot-Password Rate Limit**
  On top of already limiting how often password-reset requests can come from one internet connection, we now also limit how often they can be requested for the same email address specifically, stopping someone from spamming reset emails to a lot of different accounts at once.
- [FileDown] **[SECURITY]** **Data Exports Never Cached**
  When you download a copy of your personal data from us, your browser and any network in between is now told never to save a cached copy of that file.
- [Gauge] **[FIXED]** **Correct Rate-Limit Headers**
  If you connect other tools to VulnRadar, the usage-limit information they receive now correctly shows your actual plan's daily limit instead of always showing a flat 50, no matter your plan.
- [Settings] **[CHANGED]** **Stripe Lazy Accessor**
  For self-hosters who don't use billing at all: pages that touch payment features used to crash outright if billing wasn't set up. They now fail gracefully with a clear message instead.
- [Settings] **[CHANGED]** **Single Source of Truth for Constants**
  Internal cleanup: things like staff role names, page addresses, and severity levels are now defined in exactly one place in our code instead of copied in several spots, which reduces the chance of them accidentally disagreeing with each other down the line.
- [Database] **[CHANGED]** **Plans & Products Consolidated**
  Internal cleanup: our subscription plans are now defined in one place instead of several, so adding or changing a plan in the future is less likely to cause the pricing page and the actual billing system to fall out of sync.
- [Shield] **[CHANGED]** **Admin Role Helpers Consolidated**
  Internal cleanup: the permission checks that decide who's allowed to do what in the admin panel used to be copy-pasted in five different places, and are now shared from one place, reducing the chance of one of those copies quietly falling out of date.
- [Zap] **[CHANGED]** **Notifications Source of Truth**
  Internal cleanup: your notification preference settings are now defined in one consistent place behind the scenes instead of scattered across the code.
- [Code] **[CHANGED]** **SSRF Helpers Consolidated**
  Internal cleanup: all the different safety checks that stop the scanner from being tricked into visiting private, internal addresses now share one single, consistent implementation instead of several slightly different copies.
- [Globe] **[CHANGED]** **SCAN_PROTOCOLS Moved to Protocols Module**
  Internal cleanup: the list of connection types the scanner supports is now defined in one shared place instead of being duplicated, so the options you see on screen can't drift out of sync with what the scanner actually supports.
- [Code] **[CHANGED]** **Client API Helpers Promoted**
  Internal cleanup: the shared code responsible for talking to our servers got tidied up and made more consistent across the app.

---

## v2.2.3 - April 9, 2026 **(highlights)**
**HTTPS Scanning Fix & Security Stabilization**

Fixed a bug from our last security update that broke scanning of secure (HTTPS) websites: VulnRadar was checking the wrong address's certificate, which made valid, safe websites look like they had broken security. That's fixed now, along with some behind-the-scenes stability and configuration improvements.

### Changes
- [Shield] **[FIXED]** **HTTPS Scanning Fix**
  Scanning any secure (https) website was broken after the previous release's security tightening, since it stopped the scanner from properly checking the site's security certificate. Fixed, so scanning secure websites works correctly again while keeping the security protections from the last update.
- [Lock] **[SECURITY]** **Protocol-Specific IP Handling**
  Building on the fix above: the scanner now handles secure and non-secure websites a bit differently under the hood so both work correctly, closing the gap that broke secure scanning in the previous update without giving up any of the security protections that update added.
- [Zap] **[CHANGED]** **Billing Verification & Configuration**
  Cleaner handling of subscription and billing status changes, and clearer error messages if something in the site's setup isn't configured correctly.
- [Network] **[CHANGED]** **Middleware Stability**
  General reliability improvements to how the app handles incoming requests and web addresses, catching more unusual situations so pages load and respond consistently.
- [Bug] **[CHANGED]** **Code Quality Improvements**
  For contributors: over 40 small internal code-quality issues got cleaned up. Nothing you'll notice directly, but it means fewer hidden bugs waiting to cause problems later.

---

## v2.2.2 - April 7, 2026
**Security Hardening & Code Quality Improvements**

Closed several ways a malicious website could have tricked VulnRadar's scanner into reaching internal or private network addresses it should never touch. Updated the software VulnRadar depends on to its latest, safest versions, and improved the error messages you see when a webhook or email notification fails to send.

### Changes
- [Shield] **[SECURITY]** **SSRF Vulnerability Fixes**
  Closed a security gap across every kind of scan (bulk, crawl, discovery, and the free demo) that could have let a specially crafted target trick our scanner into visiting internal, private computers it should never be able to reach.
- [Lock] **[SECURITY]** **Enhanced DNS Validation**
  Improved detection of private, internal network addresses so scanning can't be pointed at internal infrastructure, whether it's an older-style or a newer-style internet address, while still allowing scans of legitimate public websites either way.
- [Network] **[ADDED]** **Fetch Timeout & Abort Control**
  Every check the scanner runs against your website now automatically gives up after 30 seconds if it gets no response, instead of potentially hanging forever on a slow or unresponsive site.
- [AlertTriangle] **[SECURITY]** **Incomplete String Escaping Fix**
  Fixed a small bug in the check that looks for exposed private IP addresses on a page, where certain unusual text patterns could confuse the check and cause it to behave unpredictably.
- [Database] **[FIXED]** **API Key Rate Limiting Fix**
  Fixed a spot in the API usage-limit checking code that could crash under certain unusual conditions instead of failing gracefully.
- [Bug] **[CHANGED]** **Code Quality Improvements**
  Fixed a handful of smaller scanner bugs, including a cookie-security check that wasn't actually reporting what it found, a few checks that were quietly duplicated and reporting the same issue twice, and a pattern-matching bug in the check for exposed personal ID numbers.
- [Zap] **[CHANGED]** **Error Logging Enhancement**
  If an email notification or an automatic scan-result delivery to another app fails to send, that failure now actually gets recorded, so problems with notifications not arriving can be tracked down instead of vanishing without a trace.
- [Package] **[CHANGED]** **Dependency Updates**
  Routine maintenance: the core software tools VulnRadar is built on all got updated to their latest, tested versions.

---

## v2.2.1 - April 5, 2026
**Broadcast Messaging Hotfix**

Fixed a bug that was silently preventing admins from sending announcement messages to users.

### Changes
- [Bell] **[FIXED]** **Broadcast Query Fix**
  Admin broadcast messages had stopped sending entirely due to an internal storage mismatch. Fixed, so admins can send site-wide broadcast messages again, with their status tracked correctly.

---

## v2.2.0 - March 31, 2026 **(highlights)**
**Backend Optimization, API Enhancements & Security Hardening**

Made the app faster and more responsive across the board, and cleaned up the look and feel to be more consistent from page to page. Also patched several important security issues, including a way the scanner could have been tricked into reaching addresses it shouldn't, and tightened up how passwords are stored and how the app checks the information you type in.

### Changes
- [Zap] **[PERFORMANCE]** **Backend Performance Optimization**
  General speed improvements across the site: pages and scan requests respond faster thanks to a range of behind-the-scenes efficiency improvements.
- [Network] **[CHANGED]** **API Enhancements**
  For anyone connecting their own tools to VulnRadar: error messages and responses are now clearer and more consistent, making it easier to build a reliable integration.
- [Palette] **[CHANGED]** **UI/UX Improvements**
  General visual polish across the app: cleaner spacing, more consistent styling, and improvements for people using screen readers or other assistive tools.
- [Shield] **[SECURITY]** **SSRF Vulnerability Patches**
  Closed several security gaps across the scanning system that could have let a cleverly crafted target trick VulnRadar into making requests it shouldn't, by checking web addresses much more strictly before ever visiting them.
- [Lock] **[SECURITY]** **Enhanced Password Hashing**
  Passwords and saved keys are now scrambled and stored using a much stronger method, meaningfully harder to crack if our database were ever stolen. You won't notice anything different when logging in.
- [Bug] **[SECURITY]** **Input Validation & Sanitization**
  Tightened checks on what you can type into various forms across the site, fixed a few spots where specially crafted text could have made a page hang, and improved how the app strips out potentially harmful code from user-entered text.
- [AlertTriangle] **[SECURITY]** **Additional Security Fixes**
  A handful of smaller security fixes: stricter checking of web addresses and email domains, better verification of security certificates, and stronger randomness used anywhere it matters for security.

---

## v2.1.2 - March 27, 2026
**Admin Panel UX Improvements, Gift Subscriptions & Support Role Fixes**

Admins can now gift a subscription plan to a user directly, choosing the plan and how long it lasts. Fixed a visual bug where a popup window could cover the page header, corrected the color used for the "support" staff badge, and cleaned up the actions available on the user list.

### Changes
- [Crown] **[ADDED]** **Gift Subscription System**
  Admins can now gift someone a temporary paid plan, choosing the tier and how long it lasts, anywhere from a week to a year. The recipient automatically gets a Premium badge on their profile while the gift is active.
- [Tag] **[FIXED]** **Plan Name Formatting**
  Plan names in the admin panel were displaying in a raw, computer-friendly format like 'elite_supporter' instead of 'Elite Supporter'. Fixed, so plan names now read normally everywhere they show up.
- [Shield] **[FIXED]** **Support Role Badge Color**
  The badge for the Support staff role had no color at all due to a styling bug. It now shows the correct blue color, matching every other role badge.
- [Layout] **[FIXED]** **Modal Z-Index Fixes**
  Opening the Role or Plan dropdown in the admin panel used to make the page header vanish behind it, which looked broken. Fixed, so every popup on that screen now properly appears on top of the page instead of behind it.
- [Bell] **[FIXED]** **Notifications Manager Modal Fix**
  The admin tool for managing site notifications had the same dropdown-hiding-the-header bug described above. Fixed the same way, so choosing a notification's type, style, or audience no longer breaks the page layout.
- [Key] **[ADDED]** **Premium Badge Auto-Award**
  Gifting someone a subscription or upgrading their plan now automatically gives them the Premium badge on their profile, and moving someone back to the free plan automatically removes it. No manual step needed either way.
- [UserCog] **[ADDED]** **Update Plan/Name/Email API**
  Admins can now update a user's plan, name, or email directly, with the affected user notified by email and the change recorded for accountability. Plan changes are blocked while a gift subscription is active, so you can't accidentally overwrite it.
- [Eye] **[CHANGED]** **Removed Disable Button from User List**
  The Disable/Enable button on the main user list is gone. Disabling an account is now only available from inside that specific user's own detail page, which helps prevent an admin from accidentally clicking it on the wrong row.
- [CheckCircle] **[CHANGED]** **All Actions Use Confirmation Modal**
  Every support action a staff member can take on your account now requires a confirmation step and always emails you about it, instead of happening instantly and silently.

---

## v2.1.1 - March 23, 2026 **(highlights)**
**Profile UI Redesign, Email Notifications for Scans & API Key Security Enhancement**

Redesigned the Settings page with a cleaner sidebar and a more consistent look throughout. You can now get an email when a scan finishes or when it finds something critical. Also made API keys safer: when you generate a new key to replace an old one, the old key is now deleted for good instead of just being set aside.

### Changes
- [Palette] **[CHANGED]** **Complete Profile/Settings Redesign**
  Your Settings page got a full visual redesign: a cleaner sidebar for navigating between sections on a computer, easy-to-use tabs on mobile, and consistent spacing and styling throughout instead of a mix of different looks.
- [Layout] **[CHANGED]** **Sidebar Navigation Overhaul**
  Settings now shows all 7 sections (General, Billing, Security, Developer, Notifications, Privacy, Connected Accounts) in a sidebar that stays visible as you scroll on a computer, or a swipeable row of tabs on a phone.
- [Bell] **[CHANGED]** **Standardized Icon Styling**
  Every section header icon across all of Settings now looks the same, in the same color and style, instead of a mismatched mix of grays and blues from before.
- [Wrench] **[FIXED]** **Notification Card Spacing Fix**
  The notification preference toggles in Settings were cramped and hard to read. Given more breathing room so the list is easier to scan.
- [Zap] **[CHANGED]** **Removed Unnecessary Product Section**
  Removed the 'Product Updates' and 'Tips & Guides' notification toggles, since they weren't tied to anything you actually needed to act on. The Notifications tab now focuses on alerts that matter, like security and scan activity.
- [Mail] **[ADDED]** **Email Notifications for Scan Completion**
  You'll now get an email as soon as a scan finishes, with a breakdown of what was found by severity, how long it took, and a direct link to see the full report. You can turn this off in Settings if you'd rather not get these emails.
- [AlertTriangle] **[ADDED]** **Critical Findings Alert Emails**
  If a scan turns up something serious, a critical or high-severity problem, you'll now get a separate, more urgent-looking email calling it out specifically, on top of the regular completion email. You can turn this off separately in Settings.
- [CalendarClock] **[ADDED]** **Scheduled Scan Email Templates**
  Laid the groundwork for scheduled scans (ones that run automatically on a recurring basis) to send you the same kind of summary email as a manual scan, once that automatic scheduling is fully wired up.
- [Key] **[SECURITY]** **API Key Rotation Security Enhancement**
  Replacing an old saved key with a new one now permanently deletes the old one instead of just marking it inactive and keeping it around. There's no leftover copy of an old key that could ever accidentally still work.
- [RefreshCw] **[FIXED]** **Scan Notification Key Mapping Fix**
  The scan-related notification toggles in Settings were showing the wrong on/off state due to an internal mismatch, even though the actual setting behind them was correct. Fixed, and they now correctly show as on by default.
- [UserCog] **[CHANGED]** **Profile Header Simplification**
  Removed a redundant profile card from the top of the Settings page, leaving just the page title for a cleaner, less cluttered look.
- [CheckCircle2] **[FIXED]** **Import Fix for CheckCircle2**
  Fixed an error that could crash the Notifications tab caused by a missing icon reference. It now loads and displays correctly every time.

---

## v2.1.0 - March 21, 2026 **(highlights)**
**Complete UI/UX Redesign, Support Actions System & Admin Dashboard Overhaul**

Redesigned every page you actually use, not just the admin side. Support staff actions (like adjusting someone's account) now send a confirmation email, so there's always a record of what happened. Fixed a bug where staff weren't correctly getting their unlimited scan access, modernized the whole admin panel, and fixed sorting on lists that had stopped working.

### Changes
- [Palette] **[CHANGED]** **Complete UI/UX Redesign**
  Every major page got a visual refresh toward a cleaner, more professional look: bigger, clearer summary cards, better charts, and a more consistent design throughout the whole app.
- [Layout] **[CHANGED]** **Dashboard Component Revamp**
  The dashboard's summary cards now clearly show your total scans, how many different sites you've scanned, and a breakdown by how the scan was run. Your activity chart is easier to read, and your recent scans list shows friendlier timestamps like '2 hours ago' instead of a raw date.
- [List] **[CHANGED]** **History Page Modernization**
  Your scan History page is now a proper table with clear columns, so you can see at a glance what was scanned, where it came from, how many issues it found, and when. A summary row up top shows your totals, and each row has a menu for quick actions.
- [FileSearch] **[CHANGED]** **Scan Results Pages Update**
  Scan results, the summary, the list of findings, and each individual issue you click into, all got a cleaner, easier-to-read layout, with clearer severity indicators and better-organized supporting details.
- [GitMerge] **[CHANGED]** **Compare Page Redesign**
  Comparing two scans to see what changed is clearer now: a simple side-by-side layout, green for issues that got fixed and red for new ones, and a plain 'No Changes' message when nothing's different between the two.
- [Share2] **[CHANGED]** **Shared & Shares Pages Revamp**
  Pages you share with others now open with a clearer header showing the overall risk level at a glance, and your own list of shared links shows a summary of how many are active, plus a proper table with quick actions for managing each one.
- [Users] **[CHANGED]** **Teams Page Complete Redesign**
  The Teams page got a search box and a cleaner table layout showing members and their roles. Clicking into a team now shows clearly organized sections for members, pending invites, and their scan history, and the page for joining a team is simpler too.
- [Palette] **[CHANGED]** **Badge Page Modernization**
  The page for grabbing a security badge to embed on your own website is now split into two clear halves: pick which scan to show a badge for on the left, then preview and copy the embed code on the right.
- [Pencil] **[CHANGED]** **Profile Pages Restructure**
  Your profile page now has a sidebar on the left showing all 7 sections (General, Security, Connected Accounts, Billing, Developer, Notifications, Privacy), with clean, well-organized forms on the right.
- [ShieldAlert] **[CHANGED]** **Admin Panel Complete Overhaul**
  The admin panel got a big cleanup: clearer summary stats, easier navigation between sections, a searchable user list, and a much more organized view when you click into a specific user's details.
- [Bell] **[ADDED]** **Support Actions System**
  Every action a support staff member takes on your account (forcing a logout, revoking your saved keys, resetting your password, and similar) now goes through a review-and-confirm step first, and you're always notified by email about it, no exceptions.
- [Mail] **[ADDED]** **Support Action Email Notifications**
  If a staff member logs you out, revokes your saved keys, or resets your password on your behalf, you'll now get an email explaining exactly what was done, who did it, and when.
- [Shield] **[FIXED]** **Staff Role Unlimited Access Fix**
  Moderators and support staff were still being held to the normal daily scan limit, even though only admins were supposed to have unlimited scans among staff. Fixed, so every staff role now correctly gets unlimited scans.
- [RefreshCw] **[FIXED]** **Severity Sorting Fix**
  Sorting your scan findings from most to least severe (or the other way around) was completely broken and didn't actually reorder anything. Fixed, so sorting now works correctly in both directions.
- [Settings] **[CHANGED]** **Consistent Token Loading**
  Loading screens across the sharing pages now use one simple, consistent spinner instead of a mix of different loading animations.
- [ShieldCheck] **[CHANGED]** **Form & Modal Improvements**
  Forms and popups across the app got cleaner labels, more consistent toggle switches, and better-organized sections. The delete-confirmation popup now shows you exactly what you're about to delete before you confirm.
- [Shield] **[FIXED]** **Discord Device Trust Fix**
  Checking 'Trust this device for 30 days' during two-factor login after signing in through Discord didn't actually work, so you'd be asked to verify again next time anyway. Fixed for both regular login and Discord login.
- [Wrench] **[CHANGED]** **Request Body Parsing Enhancement**
  Behind-the-scenes improvements to how the app reads incoming requests, giving clearer error messages when something sent to the server is malformed instead of failing in a confusing way.

---

## v2.0.5 - March 16, 2026 **(highlights)**
**API Rate Limiting Complete & Enhanced Legal Documentation**

Every documented part of the API now correctly enforces your daily usage limit, not just some of it. Fixed how deep scans and bulk scans were being counted toward that limit, added a way to delete things through the API that was missing before, and improved our accessibility documentation.

### Changes
- [Key] **[ADDED]** **Complete API Rate Limiting**
  If you connect other tools to VulnRadar, every kind of scan and every way of managing your scan history now consistently enforces your daily usage limit, and tells the connecting tool clearly how much you have left.
- [Gauge] **[ADDED]** **API Usage Tracking**
  Every action you take through our developer tools now correctly counts toward your daily usage total, so your remaining quota shown always reflects what you've actually used. Subdomain discovery stays free and unlimited, as documented.
- [Settings] **[CHANGED]** **Dynamic Daily Limit per API Key**
  Your daily usage limit is now based on your specific saved key's configured limit instead of a flat 50 for everyone, so different keys can be set up with different quotas if needed.
- [Radar] **[FIXED]** **Source Tracking Fix for Crawl/Bulk**
  Crawl and bulk scans triggered through our developer tools were showing up in your history mislabeled as if you'd run them from the website directly. Fixed, so your history now correctly shows how each scan was actually started.
- [Trash2] **[ADDED]** **DELETE Handler for History**
  If you connect other tools to VulnRadar, you can now delete a specific scan from your history that way too, not just from the website itself.
- [Shield] **[SECURITY]** **Terms Acceptance Enforcement on API**
  If you haven't accepted our current terms of service, our developer tools now clearly tell you to log in and accept them before continuing to use them, instead of quietly letting requests through.
- [Link2] **[ADDED]** **Comprehensive History API Rate Limiting**
  Every way of managing your scan history through our developer tools (listing scans, deleting them, updating notes) now consistently checks your saved key and tracks your usage correctly.
- [AlertTriangle] **[CHANGED]** **Rate Limit Exemption for Discovery**
  Discovering subdomains through our developer tools stays completely free, not counted against your daily usage limit, matching what our documentation already promised.
- [FileText] **[CHANGED]** **Enhanced Accessibility Documentation**
  Our Accessibility page now explains how to get help if the 'prove you're not a robot' check gives you trouble, adds notes about our PDF reports, and sets clearer expectations for how quickly we can respond during busy periods.
- [Heart] **[CHANGED]** **Improved Donate Page**
  The donate page looks nicer now, with a glowing heart graphic, a backup donate button in case the automatic redirect doesn't work, and a thank-you message once you've donated.

---

## v2.0.4 - March 16, 2026 **(highlights)**
**Comprehensive Legal Overhaul & API Route Authentication Fix**

Rewrote our legal pages (Privacy Policy, Terms of Service, and related documents) to comply with US state and federal privacy laws, as well as international ones like GDPR. Fixed a bug where some API endpoints weren't properly checking API keys, and added a prompt asking returning users to re-accept our terms whenever they change.

### Changes
- [FileText] **[CHANGED]** **Legal Documents Overhaul**
  Rewrote our Terms of Service, Privacy Policy, Acceptable Use Policy, and Disclaimer to properly comply with US law, and clarified the minimum age to use VulnRadar (13+) along with parental consent requirements for younger teens.
- [Shield] **[ADDED]** **CCPA/CPRA & State Privacy Compliance**
  If you're in California, Virginia, Colorado, Connecticut, or Utah, our Privacy Policy now spells out your specific state privacy rights, including your right to know what data we have on you, delete it, or opt out of certain uses.
- [Bell] **[ADDED]** **Terms Re-Acceptance System**
  If our terms and policies change after you already agreed to them, you'll now see a clearly marked popup explaining what changed, and you'll need to agree again before continuing to use VulnRadar.
- [FileSearch] **[ADDED]** **New Legal Pages**
  Added two new pages: a Copyright Policy explaining how to report content that shouldn't be there, and an Accessibility Statement explaining our commitment to making the site usable for people with disabilities, plus how to tell us if something isn't working for you.
- [Key] **[FIXED]** **API Route Authentication Fix**
  If you connect other tools to VulnRadar using a saved key rather than logging in directly, several features (crawling, bulk scanning, and viewing history) didn't actually work with that key at all. Fixed, so all of them now work correctly with a saved key.
- [Lock] **[ADDED]** **Data Breach Notification Policy**
  Our Privacy Policy now spells out what happens if your personal information is ever caught up in a data breach: we'll notify you without unreasonable delay after we find out.
- [Mail] **[ADDED]** **Contact Form Privacy Notice**
  The contact form now shows a short note explaining what happens to the information you submit, and makes clear it won't be used to send you marketing.
- [FileText] **[ADDED]** **Enhanced Privacy Policy**
  Our Privacy Policy now covers what happens to your data if VulnRadar is ever acquired by or merged with another company, and clarifies that scan results are informational and can include false alarms or missed issues, not a legal guarantee of anything.
- [Shield] **[ADDED]** **Security Tool Disclaimers**
  Our Terms of Service now says plainly what should be obvious but is worth stating clearly: scan results are for information only, may include false alarms or miss things, and no security tool can catch absolutely everything.
- [AlertTriangle] **[ADDED]** **Mass Scanning Prevention**
  Added a rule to our usage policy against large-scale, automated scanning sweeps across the internet: you need to have real permission to scan each specific website you target, not blanket permission to scan broadly.
- [Layout] **[FIXED]** **Public Legal Pages Accessibility**
  Our Copyright Policy and Accessibility pages were showing the logged-in version of the site's header and footer even to visitors who weren't signed in. Fixed, so they now show the correct version for guests too.
- [Link2] **[CHANGED]** **Footer Legal Links Reorganization**
  All 7 of our legal pages (Terms, Privacy, Disclaimer, Acceptable Use, Copyright Policy, Accessibility, and Data Requests) are now listed consistently in the footer, whether you're logged in or just browsing, so you can always find the one you're looking for.
- [Heart] **[CHANGED]** **Accessibility Improvements**
  More detail added to our Accessibility page: how to get help if the 'prove you're not a robot' check is difficult for you, notes on our PDF exports, and a heads-up that response times can vary when we're busy.
- [Wrench] **[FIXED]** **Layout JSON Parse Fix**
  A rare bug could cause the site to throw an error when the page first loaded, due to a leftover empty value saved in your browser. Fixed, so pages load reliably.

---

## v2.0.3 - March 15, 2026
**310+ Security Checks, Config System Overhaul & UI Improvements**

Grew the scanner from a smaller check list to over 310 individual security checks. Simplified how the app is configured behind the scenes (mainly relevant if you're running your own copy), and fixed several display bugs on different browsers and operating systems.

### Changes
- [ShieldCheck] **[ADDED]** **310+ Security Checks**
  Nearly doubled the number of things VulnRadar checks for, from 175 to 310+. New coverage includes deeper checks on your site's security settings, cookie safety, and accidentally exposed login credentials for services like AWS, Stripe, GitHub, and several others.
- [Settings] **[CHANGED]** **Config System Overhaul**
  For self-hosters: the way basic site settings (like the app name and version number) get configured is now simpler and more reliable, and fixes a rare bug where the page could briefly show mismatched or stale information right after loading.
- [FileText] **[CHANGED]** **Updated Documentation**
  For self-hosters: our setup guide got a lot more thorough, with a complete example configuration file, a new section explaining how site settings work, and copy buttons on every code snippet so you can set things up faster.
- [Layout] **[FIXED]** **Modal & Toast Scrolling**
  Long popups and notifications used to overflow past the edge of the screen instead of scrolling. Fixed, so anything too tall to fit now scrolls properly instead of getting cut off.
- [Wrench] **[FIXED]** **Bulk Scan Helper Text**
  The bulk scan form told you every address 'must include https://', which wasn't actually true since VulnRadar adds that automatically. Fixed the misleading instructions.

---

## v2.0.2 - March 14, 2026 **(highlights)**
**Badge page 500 error fixed**

### Changes
- [Wrench] **Bug Fix**
  Fixed a 500 error on the badge page caused by a missing import, so it loads normally again.

---

## v2.0.1 - March 14, 2026
**Detection Engine v2.0.1, Subdomain Caching & Share Modal**

Tuned the scanner to report fewer false alarms. Added caching so re-checking a site's subdomains is faster, and built a proper popup for sharing a scan result, with a much nicer look than the old plain link.

### Changes
- [ShieldCheck] **[CHANGED]** **Detection Engine v2.0.1**
  Cut down on false alarms in your scan results. Sites built with common website frameworks no longer get incorrectly flagged for things those frameworks legitimately need to do, a bug that misidentified the plain text 'https:' as a security risk got fixed, checks no longer mistake documentation and example code for real problems, and a popular analytics script stopped getting flagged as suspicious.
- [Globe] **[ADDED]** **Subdomain Discovery Caching**
  Subdomain discovery results now stay saved for 4 hours so repeated lookups come back instantly, with a 'Refresh Now' button if you want the latest results sooner. Also raised the limit from 150 subdomains found to 1000.
- [Share2] **[ADDED]** **Custom Share Modal**
  Sharing a scan result now opens a clean popup with one-click buttons for X (Twitter), Facebook, LinkedIn, WhatsApp, and email, plus a copy-link button that shows a quick confirmation once it's copied.
- [Bell] **[CHANGED]** **Admin Notifications UI Overhaul**
  For admins: the notification cards in the admin panel got a full visual cleanup, easier to read at a glance, with action buttons that are always visible instead of hidden behind a hover.
- [FileText] **[ADDED]** **Admin User Notes**
  For admins: staff can now leave private internal notes on a user's account that stick around for future reference, showing who wrote each note and when.
- [Settings] **[CHANGED]** **Dynamic Version System**
  For self-hosters: the version number your installation reports is now always accurate the moment the server starts, instead of sometimes being set at build time and going stale.
- [Wrench] **[FIXED]** **Bug Fixes**
  A handful of smaller fixes: an error in the admin activity log under certain conditions, a display glitch on the History page, a bug where the subdomain discovery button behaved oddly, a missing screen-reader label on a dialog, and an off-center notifications popup, all fixed.

---

## v2.0.0 - March 12, 2026
**Stripe Billing, Discord Integration, Admin Notifications & Design System Overhaul**

Our biggest release yet. Added paid subscription plans, the ability to link your Discord account, a proper notification system for admins, and a full visual redesign across the app.

### Changes
- [Crown] **[ADDED]** **Stripe Billing Integration**
  Paid plans are here: Free, Core Supporter, Pro Supporter, and Elite Supporter, each unlocking a higher scan limit. You can manage your subscription, upgrade, downgrade, or cancel any time from a self-serve billing page.
- [Globe] **[ADDED]** **Discord Account Linking**
  You can now link your Discord account to your profile, showing your Discord avatar and username, with a one-click option to unlink whenever you want. This sets things up for future community features, like a Discord bot.
- [BellRing] **[ADDED]** **Admin Notification System**
  Admins can now post site-wide announcements in several styles: a banner across the top, a popup, a small toast in the corner, or a notification bell alert. Each one can be aimed at a specific group of users and scheduled to show for a set period.
- [Palette] **[CHANGED]** **Design System Overhaul**
  A full visual refresh around a refined cyan/teal color as the main accent, with consistent hover colors across the whole app instead of a mismatched mix of blue and purple.
- [Zap] **[CHANGED]** **API v2 Migration**
  If you connect your own tools to VulnRadar, everything moved to a newer version of our developer interface. The older version still works for now, but shows a warning telling you to switch over.
- [Database] **[ADDED]** **Enhanced Database Schema**
  Behind the scenes, the way we store data got expanded to support Discord linking, billing, and site notifications, all the new features above.
- [ShieldCheck] **[ADDED]** **Subscription-Gated Scanning**
  How many scans you can run each month now depends on your plan: 50 for Free, 100 for Core, 150 for Pro, and 500 for Elite, with a clear indicator in the app showing how much you've used. Self-hosters can turn billing off entirely and skip limits altogether.
- [Settings] **[ADDED]** **Admin Notifications Manager**
  For admins: a full screen for creating and managing site notifications, letting you choose the style, target audience, which pages it shows on, how long it runs, and preview exactly how it'll look before publishing it.
- [Bell] **[ADDED]** **Multi-Type Notification Display**
  Site announcements can now appear as a banner at the top, a popup in the middle of the screen, or a small toast in the bottom corner that fades away on its own, and dismissing one doesn't dismiss the others.
- [Link2] **[ADDED]** **Discord Profile Modal**
  A dedicated popup walks you through connecting your Discord account, shows your avatar, username, and Discord ID once linked, and lets you disconnect cleanly whenever you want.
- [BarChart3] **[ADDED]** **Billing Dashboard**
  A new Pricing page shows every plan side by side so you can compare features, highlights your current plan and usage, and lets you upgrade with one click or manage your payment details if you're already subscribed.
- [Wrench] **[ADDED]** **Stripe Webhook Automation**
  Behind the scenes, billing events (a completed checkout, a plan change, a cancellation, or a failed payment) are now handled automatically and reliably, with checks in place so the same billing event can never be processed twice by accident.
- [Activity] **[ADDED]** **Staff Heartbeat System**
  For admins: staff members now show a live online, away, or offline status in the admin panel, which helps coordinate who's around to help with support at any given moment.
- [Filter] **[ADDED]** **Notification Audience Targeting**
  Admin announcements can now be aimed at a specific group, everyone, logged-in users only, guests only, or just admins or staff, and can be limited to showing only on certain pages, with the most important one always shown first if several are active.
- [Timer] **[ADDED]** **Scheduled Notifications**
  Admins can now set a start and end date on a site announcement, and it'll show up and disappear automatically on schedule, handy for maintenance windows or limited-time promotions with nobody needing to remember to take it down.
- [Fingerprint] **[ADDED]** **Unique Cookie-Based Dismiss**
  Dismissing one site announcement no longer dismisses every other one too. Each stays dismissed on its own, for however long that specific announcement is set to stay hidden, even after you close your browser and come back.

---

## v1.9.5-patch.1 - March 9, 2026
**API v1 routes fixed**

### Changes
- [Wrench] **[FIXED]** **Middleware Routing Fix**
  If you connected other tools to VulnRadar using our developer interface, some requests were getting incorrectly redirected to the login page instead of getting a real response. Fixed, while all the normal usage checks and limits still apply as before.

---

## v1.9.5 - March 7, 2026
**API v1 Versioning, Developer SDK Support & Finding Types Endpoint**

### Changes
- [Zap] **[CHANGED]** **API v1 Versioning**
  For anyone connecting their own tools to VulnRadar: our developer interface now uses proper versioning, laying the groundwork for bigger changes coming in version 2.0.
- [FileText] **[ADDED]** **New Finding Types Endpoint**
  Developers building their own tools on top of VulnRadar can now pull a full list of all 110+ security checks we run, with their names, categories, and severity levels, straight from our developer interface.
- [Key] **[ADDED]** **Developer Documentation**
  A new 'Developers' section in our documentation covers how to build your own tools on top of VulnRadar, plus a link to the official Python toolkit we're currently building.
- [Globe] **[CHANGED]** **Updated API Documentation**
  Our developer documentation and every code example in it now reflect the current version of our developer interface.
- [Shield] **[CHANGED]** **Scanner Engine v2.0.0**
  The version number for our security-check definitions was updated to match the scanner engine itself, so everything now stays in sync under one version number.

---

## v1.9.4-patch.1 - February 28, 2026
**API Key Encryption Fix, Stronger Key Entropy & Validation Overhaul**

### Changes
- [Lock] **[SECURITY]** **Fixed Encrypted Key Validation**
  If your saved keys were stored with encryption turned on, they couldn't actually be validated at all, meaning encrypted keys silently stopped working. Fixed, so encrypted keys now work correctly, and older keys created before encryption was enabled still work too.
- [Key] **[SECURITY]** **Increased API Key Entropy**
  Newly generated saved keys are now longer and far harder to guess, making them meaningfully more resistant to someone trying to brute-force their way in.
- [Shield] **[SECURITY]** **Longer Deprecated Placeholders**
  A behind-the-scenes placeholder value used internally for old-style keys is now generated with much stronger randomness, closing off a theoretical weakness in how it was created before.
- [Fingerprint] **[CHANGED]** **Decrypt-and-Compare Validation**
  Building on the fix above: checking whether a saved key is valid now works correctly whether encryption is turned on or not, and keys created before encryption was ever enabled keep working without any changes needed.
- [Zap] **[CHANGED]** **Zero Breaking Changes**
  None of these fixes require you to do anything: your existing saved keys and setup keep working exactly as they did before, just more securely.

---

## v1.9.4 - February 26, 2026
**UI Consistency, Docker Build-Time Vars, Discord Giveaway & Encryption-First API Keys**

### Changes
- [Palette] **[FIXED]** **Unified Landing & Dashboard Fonts**
  The homepage header was using a different font than the rest of the site. Fixed, so the text style now matches everywhere you go.
- [Container] **[FIXED]** **Docker Build-Time Environment Variable Support**
  For self-hosters running VulnRadar in Docker: the 'prove you're not a robot' check on forms wasn't working because a required setting never made it into the build. Fixed, so it now works correctly in Docker installations.
- [Heart] **[ADDED]** **Discord Giveaway Notification**
  A time-limited giveaway notification for 3 free months of our top-tier plan now shows up in the notification bell, with a direct link to enter through our Discord server.
- [Key] **[SECURITY]** **Encryption-First API Key Storage**
  For self-hosters with encryption turned on: newly saved keys are now stored only in encrypted form, with no separate, less-secure copy sitting alongside them.
- [Lock] **[CHANGED]** **Hash-Based Fallback & Conditional Lookup**
  For self-hosters without encryption configured, saved keys still work exactly as before, with the app automatically adjusting to whichever storage method is active without breaking anything.

---

## v1.9.3 - February 24, 2026
**Admin Version Monitoring & Enhanced Admin Controls**

### Changes
- [Bell] **[ADDED]** **Automatic Admin Version Monitoring**
  For self-hosted admins: you'll now automatically get a notification if a newer version of VulnRadar is available, without needing to go check for it yourself.
- [Shield] **[ADDED]** **Intelligent Notification Frequency**
  How often you get reminded about a new version now depends on how far behind you are: more urgent daily reminders if you're behind, with a link straight to what's changed, and a lighter weekly check otherwise, without repeating the same alert over and over.
- [Settings] **[ADDED]** **Extended Admin Management Options**
  For admins: more tools for managing users, teams, security settings, and overall site configuration, with better visibility into what's happening across the platform.
- [Lock] **[SECURITY]** **Enhanced Admin Page Security**
  Every admin action now checks that the staff member actually has permission to do it, and sensitive actions get logged so there's a record of what happened and who did it.

---

## v1.9.2 - February 24, 2026
**Security Hardening, GDPR Compliance & Docker Production Overhaul**

### Changes
- [Lock] **[SECURITY]** **Stricter Password Strength Calculator**
  The password strength meter used to rate 'Password' as 'Fair', which isn't a strong password by any real measure. It's now much stricter, checking against a list of common passwords and flagging things like 'abc' or '123', so the rating you see actually means something.
- [Key] **[SECURITY]** **AES-256-GCM API Key Encryption**
  For self-hosters: saved keys can now be encrypted while stored, giving admins a secure way to recover a key if needed, on top of the existing protection already in place.
- [Globe] **[ADDED]** **Expanded Fix Examples for 8 Security Checks**
  Every major security-header finding now shows fix instructions for several popular web server setups, not just one, so you can copy the fix for whatever you're actually running.
- [Container] **[CHANGED]** **Docker Production Overhaul**
  For self-hosters using Docker: setting up VulnRadar now uses a ready-made version by default, so you don't need to build it yourself, and it comes with sensible defaults like automatic restarts if something crashes.
- [ShieldCheck] **[ADDED]** **GDPR Compliance & Data Request Links**
  If you're in the EU, our Privacy Policy now clearly explains your data rights, with a direct link to download a copy of your data, now easy to find in the footer of every page.
- [FileText] **[CHANGED]** **Privacy Policy Updates**
  Our Privacy Policy now spells out exactly how to exercise your data rights, either in the app or by email, with a commitment to respond to any data request within 30 days.

---

## v1.9.1 - February 23, 2026
**ToS Modal & Header Fixes**

### Changes
- [FileText] **[CHANGED]** **ToS modal wording**
  The terms-of-service popup now makes clear that closing it without agreeing doesn't get you out of your legal obligations, and it now shows up reliably whether you're logged in or just browsing.
- [Layout] **[FIXED]** **Centralized Route & API Constants**
  The site header used to flicker briefly between showing you as logged in or logged out right after a page loaded. Fixed, so it now shows the correct navigation immediately.

---

## v1.9.0 - February 23, 2026
**Auth-Aware Public Pages, Codebase Refactor & Performance**

### Changes
- [Shield] **[ADDED]** **Auth-Aware Public Pages**
  The Demo, Staff, Legal, and Shared pages now show you the full site navigation if you're logged in, or a simpler header with a Sign In button if you're just browsing, instead of one generic look for everyone.
- [Layout] **[CHANGED]** **Centralized Route & API Constants**
  Internal cleanup: page addresses and role names used across the site are now defined in one central place instead of scattered throughout the code, reducing the chance of a stray typo breaking a link somewhere.
- [Wrench] **[CHANGED]** **Role Badge Deduplication**
  Role badges (Admin, Moderator, Support, Beta Tester) now use the exact same colors everywhere they show up across the app, instead of four separate versions that could look slightly different depending on which page you were on.
- [Zap] **[PERFORMANCE]** **Dynamic Imports for Heavy Components**
  Parts of the Dashboard and Profile page that you don't see right away (like export options and the onboarding tour) now load only when you actually need them, which makes the initial page load a bit faster.
- [Lock] **[CHANGED]** **Auth Flow UI Standardization**
  The Forgot Password and Reset Password pages now match the same clean look as Login and Signup, with a password strength indicator shown while you're setting a new one.
- [Globe] **[CHANGED]** **Landing Page Refresh**
  Fixed a broken browser tab icon, added a clearer 'Try the Demo' button on the homepage and in the navigation, and updated the stats section to show accurate, up-to-date numbers.
- [Trash2] **[CHANGED]** **Dead Code Removal**
  Removed an old notification style that had already been replaced by the notification bell, and a leftover duplicate color setting on the Teams page.
- [Eye] **[CHANGED]** **Accessibility Improvements**
  If you use a screen reader, every icon-only button on the Teams page (save, cancel, remove member, close) now properly announces what it does, and the footer's links are easier to navigate too.
- [Link2] **[CHANGED]** **Semantic Navigation in PublicPageShell**
  Navigation links on our public pages now behave like real links (you can right-click to open in a new tab, for instance) instead of acting like buttons that only work with a direct click. Also added a copyright line to the guest footer.

---

## v1.8.0 - February 21, 2026
**Email 2FA, Expanded Notifications & 55+ New Security Checks**

### Changes
- [Mail] **[ADDED]** **Email-Based Two-Factor Authentication**
  A new way to add a second layer of protection to your login: get a 6-digit code emailed to you every time you sign in, instead of using an authenticator app. Turn it on from the Security tab in your profile (you can only have one of the two active at a time). Codes expire after 10 minutes.
- [BellRing] **[ADDED]** **18 Granular Notification Preferences**
  Notification settings went from 5 broad switches to 18 specific ones, grouped into Security, Scanning, Developer tools, Account, and Product updates, so you can turn on exactly the alerts you actually want instead of an all-or-nothing choice.
- [Target] **[FIXED]** **Accurate Notification Routing**
  Password change, two-factor, and account update emails now each respect their own specific on/off switch instead of all being controlled by one generic 'security' toggle, so turning off one type doesn't silence the others.
- [Radar] **[ADDED]** **55+ New Security Checks (175+ Total)**
  Check count jumped past 175, with new coverage for things like: your site accidentally revealing what software it runs on, weaker security settings that let outside scripts run more freely than they should, error pages that leak internal details, and exposed secrets like login tokens, private keys, and configuration files sitting somewhere they shouldn't be.
- [Bell] **[CHANGED]** **Notification Bell in Header**
  Notifications no longer take over your whole screen. A small bell icon in the header now shows how many unread notifications you have, and clicking it opens a dropdown you can dismiss. Anything truly critical, like your backup codes, still gets a full-screen popup since that's worth stopping for.
- [Filter] **[ADDED]** **Scanner Category Selector**
  A new 'Select Scanners' button lets you choose exactly which categories of checks to run, so if you only care about certain things, you can skip the rest and get a faster, more focused scan.
- [Zap] **[PERFORMANCE]** **Major Performance Improvements**
  Every single page you clicked to was making the site pause and re-check who you were, which added up to real lag as you navigated around. Fixed, so the header and navigation now show up instantly instead of waiting on that check every time.
- [Bug] **[FIXED]** **Fixed /shared Page Auth Detection**
  Pages you share with others weren't correctly detecting whether the person viewing them was logged in. Fixed, so shared scan pages now show the right header depending on whether the viewer is signed in or just browsing.
- [ShieldAlert] **[CHANGED]** **Engine Version 2.0.0**
  The scanning engine's version number moved to 2.0.0, reflecting how much bigger and better organized the checks above are.

---

## v1.7.4 - February 19, 2026
**Docker Production Ready, Mobile UX Overhaul & Error Pages**

### Changes
- [Container] **[FIXED]** **Docker Production Ready**
  For self-hosters using Docker: the build process was failing because it needed a working database connection that isn't actually available yet at that stage. Fixed, so setting up VulnRadar with Docker now works reliably from start to finish.
- [Menu] **[CHANGED]** **Mobile Menu Overlay**
  On mobile, the menu used to shove the whole page down when you opened it. It now slides in smoothly from the side instead, without disturbing what's already on screen.
- [Smartphone] **[CHANGED]** **Icon-Only Buttons on Mobile**
  Buttons that showed both an icon and a text label (like 'View Scans' or 'Export') now show just the icon on mobile to save space, with the full label back once you're on a bigger screen.
- [Pencil] **[ADDED]** **Editable Team Names**
  Team owners and admins can now rename a team right on the page: click the pencil icon, type the new name, and save.
- [Image] **[ADDED]** **Team Member Avatars**
  Team member rows now show real profile pictures where available, falling back to a letter icon when someone doesn't have one set.
- [ServerCrash] **[ADDED]** **Custom Error Page**
  Added a proper error page that matches the rest of the site's look when something goes badly wrong, with a copy-to-clipboard error code and links to get back to somewhere useful.

---

## v1.7.3 - February 19, 2026
**Unified Footer, Contact Upgrades & Error Pages**

### Changes
- [Globe] **[CHANGED]** **Version Check via GitHub Releases**
  For self-hosters: checking whether your installation is up to date is now more reliable, and it now points you straight to the specific release when an update is available.
- [Layout] **[CHANGED]** **Unified Footer Across All Pages**
  Every page now shares one consistent footer with clearly organized sections, a donate button, and social links, replacing several different footers that had drifted apart over time.
- [Mail] **[ADDED]** **Contact Email Auto-Fill**
  If you're logged in, the contact form now fills in your email automatically so you don't have to type it again. Your name also fills in but you can still change it.
- [Users] **[ADDED]** **Staff Application via Contact Form**
  You can now apply to volunteer as a Support or Moderator staff member directly through the contact form, with a clear note that these are unpaid volunteer roles.
- [ServerCrash] **[ADDED]** **Error Pages**
  Added a proper error page with a retry button and a link to support, plus a fallback for the rare case where the entire page layout fails to load at all.

---

## v1.7.2 - February 19, 2026
**Self-Hosted Schema & Stability Fixes**

### Changes
- [Database] **[FIXED]** **Scan History Save Fix**
  Scans weren't saving to your history at all due to an internal storage mismatch. Fixed, across quick scans, deep crawls, and bulk scans, so every scan now saves properly.
- [Bug] **[FIXED]** **Bulk Scan Notes**
  Bulk scans weren't getting the same default note that quick scans and deep crawls already included. Fixed, so all three scan types are now consistent.
- [Wrench] **[FIXED]** **Silent Catch Logging**
  If saving a scan to your history failed for some reason, that failure used to happen silently with no record of it anywhere. It now gets properly logged so problems like this can actually be tracked down.
- [Shield] **[FIXED]** **Notification Preferences Cleanup**
  A few notification preference settings referenced storage that had never actually been created, meaning those specific toggles quietly did nothing. Cleaned up so every notification setting is now backed by something real.
- [FileSearch] **[FIXED]** **Docs Column Name Fixes**
  Fixed a setup guide that told self-hosters to check for a field that doesn't actually exist, and updated version numbers across the documentation to match reality.

---

## v1.7.1 - February 19, 2026
**Migration Tool Improvements & Documentation Overhaul**

### Changes
- [GitMerge] **[ADDED]** **Table & Column Rename Detection**
  For self-hosters: the update tool now recognizes when something has simply been renamed between versions and offers to rename it in place, keeping all your existing data instead of treating it as something completely new.
- [Database] **[CHANGED]** **Smarter Migration Prompts**
  For self-hosters: the update tool's prompts are now smarter about their default answers, safe changes default to going ahead, while anything that would actually delete something defaults to not doing it, and requires you to confirm twice.
- [Bug] **[FIXED]** **Migration Parser Rewrite**
  For self-hosters: the update tool used to sometimes falsely report a column as unexpected or extra when it wasn't. Fixed with a much more reliable way of reading your database's structure.
- [FileSearch] **[ADDED]** **Extra Table Detection**
  For self-hosters: the update tool now flags anything in your database that isn't actually part of VulnRadar, showing you how much data is in it and letting you remove it if you want, handy if you're sharing a database with something else.
- [Wrench] **[CHANGED]** **Documentation Overhaul**
  For self-hosters: our setup and developer documentation now covers Deep Crawl, subdomain discovery, and version checking, with clearer, more accurate setup instructions overall.
- [ServerCog] **[ADDED]** **Startup Version Check**
  For self-hosters: your installation now checks for updates every time the server starts, showing a clear message if you're current, or a note pointing you to the latest release if you're behind.
- [Shield] **[FIXED]** **Exact Hostname Crawl Fix**
  Deep Crawl was wandering off to scan unrelated subdomains instead of staying on the exact site you asked it to check. Fixed, so it now stays focused on the address you actually entered.

---

## v1.7.0 - February 18, 2026
**Deep Crawl URL Selector, IP Rate-Limited Demo & Auto Scan Notes**

### Changes
- [Network] **[ADDED]** **Deep Crawl URL Selector**
  Deep Crawl now shows you the pages it found before scanning anything, so you can pick exactly which ones to check, search through the list, or select or deselect them all at once. No more waiting through scans of pages you didn't actually want checked.
- [Filter] **[ADDED]** **Smart Crawl URL Filtering**
  Deep Crawl now automatically ignores things like stylesheets, fonts, and internal technical files, and other clutter with weird encoded characters, so what you're shown to pick from is just real, normal pages you'd actually want checked.
- [Globe] **[FIXED]** **Same-Domain Redirect Handling**
  Websites that automatically redirect you to a slightly different address (like adding a language prefix) used to break Deep Crawl. Fixed, so those sites now crawl correctly.
- [Layers] **[CHANGED]** **Crawl Results Separated by Page**
  Deep Crawl results now show the page you actually entered as the main view, with every other page it checked tucked into a collapsible 'Also Crawled' section you can open up individually.
- [Shield] **[SECURITY]** **IP-Based Demo Rate Limiting**
  The free demo scanner now limits you to 5 scans every 12 hours based on your actual internet connection, instead of a cookie you could just clear in your browser to get more scans.
- [FileText] **[ADDED]** **Auto Scan Notes**
  Every scan you run now automatically gets a note showing which version of VulnRadar and its scanning engine were used, saved right away and visible on shared scans too.
- [Link2] **[CHANGED]** **Full URL Display in History**
  Your History and Compare pages now show the full page address you scanned instead of just the base website name, making it much easier to tell which exact page a scan was actually looking at.
- [Lock] **[CHANGED]** **Demo Subdomain Auth Message**
  Trying Subdomain Discovery on the free demo page while logged out now shows a friendly 'Log in to use this feature' message instead of a confusing generic error.
- [Wrench] **[CHANGED]** **Code Cleanup**
  General text cleanup across the site for clearer, more consistent writing.

---

## v1.6.8 - February 16, 2026
**Metadata & Social Preview Fixes**

### Changes
- [Sparkles] **[FIXED]** **Page Metadata Fixed**
  Page titles and descriptions sometimes failed to show up correctly, which affected browser tabs and how links looked when shared. Fixed, so they now consistently show the right VulnRadar branding.
- [Newspaper] **[FIXED]** **Consistent OG Images**
  Links to VulnRadar shared on Discord, Twitter, or elsewhere sometimes showed a broken or missing preview image. Fixed, so shared links now consistently show the correct branded image.
- [CheckCircle] **[FIXED]** **Canonical & Meta Tags**
  Fixed a rare mismatch where page details could look slightly different depending on how the page loaded, so everything is now consistent across the whole site.

---

## v1.6.7 - February 16, 2026
**Scan Notes Visibility & Team Collaboration**

### Changes
- [Eye] **[ADDED]** **Notes Visible to Team Members**
  Notes left on a scan are now visible to your whole team, not just whoever ran the scan. Before this, the notes section was hidden completely from everyone else, which meant helpful context like known false alarms or fix progress was getting lost.
- [Lock] **[CHANGED]** **Owner-Only Edit Permissions**
  Only the person who originally ran a scan can add or edit its notes. Teammates now see a clean, read-only view with no edit buttons that wouldn't have worked anyway.
- [Share2] **[ADDED]** **Notes on Shared Scans**
  Scan notes now show up on shared links too, so anyone you send a link to can see the same context you left for yourself, not just the raw findings.
- [MessageSquare] **[CHANGED]** **Empty State Messaging**
  Teammates viewing a scan with no notes now see a simple 'No notes for this scan' message instead of a prompt to add one, since only the person who ran the scan can actually do that.

---

## v1.6.6 - February 15, 2026
**Subdomain Discovery Depth & Deep Scan Prefix**

### Changes
- [Search] **[CHANGED]** **Increased Subdomain Discovery Depth**
  Subdomain Discovery now finds up to 150 subdomains per website instead of just 25, giving you a much fuller picture for larger sites.
- [ScanSearch] **[CHANGED]** **Deep Scan URL Prefix**
  Quick Scan and Deep Scan now show a bit of the page's actual path, not just the website name, in the scanner and your history, making it easier to tell exactly which page you scanned.

---

## v1.6.5 - February 15, 2026
**Scan Depth & Performance Improvements**

### Changes
- [Gauge] **[CHANGED]** **Deeper Crawl Limit**
  Deep Scan now checks up to 15 pages on a site instead of 10, giving you more thorough coverage.
- [Zap] **[PERFORMANCE]** **Parallel Fetch with Concurrency Limit**
  Deep scans are noticeably faster now, since the scanner checks several pages at once instead of one at a time, while still pacing itself so it doesn't overwhelm the site being scanned.
- [Timer] **[CHANGED]** **Consistent Fetch Timeout**
  Every request the scanner makes now waits the same amount of time before giving up, instead of a scattered mix of different wait times, making scans behave more predictably.

---

## v1.6.4 - February 14, 2026
**Subdomain Discovery & Real-Time Progress**

### Changes
- [Globe] **[ADDED]** **Subdomain Discovery**
  A new 'Discover Subdomains' feature on the dashboard finds other subdomains related to any website you enter, with a one-click button to scan any of them right from the results.
- [Activity] **[ADDED]** **Real-Time Scan Progress**
  While a scan runs, you can now see exactly what it's doing at that moment (fetching the page, checking headers, checking cookies, and so on) instead of just watching a generic loading bar.
- [Crosshair] **[CHANGED]** **Accurate Progress Tracking**
  The scan progress bar now actually reflects how far along a scan really is, instead of just guessing based on how much time has passed, so you can trust it more during longer scans.

---

## v1.6.3 - February 14, 2026
**Scanner Category Visualization**

### Changes
- [Columns3] **[ADDED]** **Category Breakdown Chart**
  Scan results now include a simple visual bar showing how your findings break down by category (headers, cookies, SSL, and more), so you can see at a glance where most of your issues are coming from.
- [Filter] **[ADDED]** **Category Filtering**
  Click any category in that new breakdown chart to instantly filter your findings list down to just that category, and click it again to see everything.

---

## v1.6.2 - February 13, 2026
**Expanded Security Coverage**

### Changes
- [ShieldAlert] **[ADDED]** **15+ New Security Checks**
  Added new checks for outdated, no-longer-secure connection methods, weak encryption settings, and a few other certificate and security-header issues.
- [AlertTriangle] **[CHANGED]** **Improved Severity Ratings**
  Severity ratings on findings are now more realistic based on how likely something actually is to be exploited, and purely informational notes are now separated from real vulnerabilities so your report is easier to prioritize.

---

## v1.6.1 - February 12, 2026
**Export & Sharing Enhancements**

### Changes
- [FileDown] **[ADDED]** **CSV Export**
  You can now export your scan results as a spreadsheet file, handy for further analysis or feeding into other tools you use.
- [FileSpreadsheet] **[CHANGED]** **Enhanced PDF Reports**
  PDF reports now include a short summary up top and a category breakdown chart, with cleaner formatting overall, closer to something you can hand straight to a client.

---

## v1.6.0 - February 11, 2026
**Deep Crawl Scanning**

### Changes
- [Network] **[ADDED]** **Deep Crawl Mode**
  A new scan mode automatically finds and checks other pages linked from the one you entered, covering up to 10 pages instead of just the single page you typed in.
- [Layers] **[ADDED]** **Aggregated Findings**
  Deep Crawl results combine findings from every page it checked, removing duplicates and showing you which issues show up on more than one page.
- [Link2] **[ADDED]** **Link Discovery**
  The scanner now finds the links on each page it visits to figure out what else on the site is worth checking, giving Deep Crawl a fuller picture of the whole site.

---

## v1.5.0 - February 10, 2026
**Scheduled Scanning & Bulk Operations**

### Changes
- [RefreshCw] **[ADDED]** **Scheduled Scans**
  You can now set a scan to run automatically on a daily, weekly, or monthly schedule, and get an email summarizing what changed since the last time it ran.
- [List] **[ADDED]** **Bulk Scanning**
  You can now scan up to 10 websites at once with a single click, with the results grouped together so you can compare them side by side.
- [Tag] **[ADDED]** **Scan Tags**
  You can now label your scans with your own custom tags, making them easier to find and group together later in your history.

---

## v1.4.0 - February 10, 2026
**Team Collaboration**

### Changes
- [Users] **[ADDED]** **Teams & Organizations**
  You can now create a team, invite people by email, and work together on scans, with everyone able to see the shared scan history and results.
- [UserCheck] **[ADDED]** **Role-Based Access**
  You can now give each team member an Owner, Admin, or Viewer role, each with different permissions for what they're allowed to do.
- [Mail] **[ADDED]** **Team Invitations**
  Team invites now go out as proper emails with a secure link that lets the person accept with just one click.

---

## v1.3.0 - February 9, 2026
**API Access & Webhooks**

### Changes
- [Key] **[ADDED]** **API Keys**
  You can now generate a saved key that lets other programs or scripts trigger a scan on your behalf, useful for connecting VulnRadar into your own automated tools.
- [Zap] **[ADDED]** **Webhooks**
  You can now set up automatic scan-result delivery to Discord, Slack, or any other app that accepts a web notification, so you find out the moment a scan finishes without having to check back yourself.
- [Gauge] **[ADDED]** **Rate Limiting**
  How many requests you can make through your saved key now depends on your plan, and you can always see clearly how much of your quota you have left.

---

## v1.2.0 - February 9, 2026
**Comparison & History**

### Changes
- [Eye] **[ADDED]** **Scan Comparison**
  You can now compare any two scans side by side to see exactly what changed between them: what's new, what got fixed, and what's stayed the same.
- [RefreshCw] **[ADDED]** **Full Scan History**
  Every scan you've ever run is now saved and searchable, so you'll never lose track of a past result again.
- [Share2] **[ADDED]** **Shareable Links**
  You can now create a link to share a scan result with anyone, or keep it limited to just your team, handy for client reports or working together on fixes.

---

## v1.1.2 - February 9, 2026
**Safety Rating Indicator**

### Changes
- [ShieldCheck] **[ADDED]** **Website Safety Rating**
  Scan results now show a simple, plain-language safety rating (Safe to View, View with Caution, or Not Safe to View) right up top, so anyone can understand the result at a glance, even without knowing anything technical.
- [Eye] **[ADDED]** **PDF Report Safety Rating**
  That same easy-to-understand safety rating now shows up in your exported PDF reports too, making them easier to share with clients or anyone else who isn't technical.

---

## v1.1.1 - February 9, 2026
**Metadata & Branding Polish**

### Changes
- [Sparkles] **[CHANGED]** **Consistent Social Cards**
  Every page now shows a consistent preview image and description when shared on Discord, Twitter, or other platforms, instead of a mismatched look depending on which page you shared.
- [Eye] **[CHANGED]** **Unified Page Titles**
  Every browser tab now consistently shows "" in its title, making it easier to spot the right tab when you have several open.
- [Shield] **[SECURITY]** **Enhanced Security Headers**
  Adjusted one of our site's own security settings to properly allow the 'prove you're not a robot' check to work, without weakening any of our other protections.

---

## v1.1.0 - February 9, 2026
**Contact System & UI Enhancements**

### Changes
- [MessageSquare] **[ADDED]** **Enhanced Contact Form**
  The contact form now lets you pick a category (Bug Report, Feature Request, Security Issue, or General Help) so your message gets to the right place, and it sends right away without making you wait on the page.
- [Shield] **[SECURITY]** **CAPTCHA Protection**
  Added a 'prove you're not a robot' check to the contact form to keep out spam and automated junk submissions, without adding an annoying puzzle for real people to solve.
- [Users] **[ADDED]** **Team Collaboration**
  Click 'View Scans' next to any teammate to see their full scan history and results, so your team can actually work from the same information instead of comparing screenshots.
- [Users] **[ADDED]** **Team Invite Emails**
  Team invitations now go out as real emails with a secure link, instead of requiring you to manually walk someone through joining.
- [Sparkles] **[ADDED]** **Professional Email Templates**
  Contact confirmations, password resets, and team invites now arrive as nicely designed emails instead of plain, bare-bones text.
- [Zap] **[PERFORMANCE]** **Instant Response Times**
  Submitting the contact form or requesting a password reset now responds instantly instead of making you sit and wait while the email actually gets sent in the background.
- [Lock] **[CHANGED]** **Smart Email Routing**
  Replying to a contact email now goes straight back to the right place, and you'll always get an automatic confirmation that your message was received.
- [Eye] **[CHANGED]** **Improved Scanner UI**
  Added a 'Scan Another URL' button right above your results, so starting a new scan doesn't mean scrolling all the way back up the page.

---

## v1.0.0 - February 8, 2026
**First Release**

### Changes
- [Shield] **[ADDED]** **65+ Security Checks**
  The first release: over 65 checks covering security settings, secure connections, cookies, information your server might be leaking, and much more.
- [Users] **[ADDED]** **User Accounts & Auth**
  A full account system: sign up, log in, manage your profile, turn on two-step login with backup codes, and securely reset your password if you forget it.
- [Lock] **[ADDED]** **Admin Dashboard**
  An admin panel for managing users, reviewing an activity log, and revoking someone's login session or saved keys if needed.
- [Zap] **[ADDED]** **Webhooks & Notifications**
  Connect Discord, Slack, or any other app that can receive automatic notifications, and get notified the moment a scan finishes.
- [RefreshCw] **[ADDED]** **Scheduled & Bulk Scanning**
  Set a scan to run automatically on a daily, weekly, or monthly schedule, or scan up to 10 websites at once.
- [Eye] **[ADDED]** **Scan Comparison & Sharing**
  Compare two scans side by side to see how things have changed over time, and create a shareable link to send a report to a client.
- [Tag] **[ADDED]** **Scan Tags & History**
  Every scan is saved and searchable, and you can label scans with your own tags to organize them by project, environment, or client.
- [List] **[ADDED]** **PDF Export**
  Export any scan as a professional PDF report, ready to hand to a client or stakeholder.
- [Users] **[ADDED]** **Teams & Organizations**
  Create a team, invite people with an Owner, Admin, or Viewer role, and work together on security scans.
- [Gauge] **[ADDED]** **API Keys & Rate Limiting**
  Generate a saved key that lets other programs trigger scans on your behalf, with built-in usage limits to prevent abuse.
- [MessageSquare] **[ADDED]** **Contact & Support**
  A dedicated page for reporting a problem, suggesting a feature, or just getting help.
- [Eye] **[ADDED]** **Self-Scan Demo**
  Try a one-click demo scan with no account needed, so you can see exactly what a result looks like before signing up.
- [Sparkles] **[ADDED]** **Onboarding Tour**
  A guided walkthrough for first-time users covering everything the app can do.
- [Newspaper] **[ADDED]** **Documentation**
  Full documentation, usage guides, legal pages, and this changelog, all live from day one.

---

## Quick reference

- **Total releases:** 65
- **Total changes documented:** 1125
- **Latest:** v3.8.0 (August 29, 2026) - Self-Hosting Works, Scans Tell the Truth, and Nothing Runs Free
- **Earliest in file:** v1.0.0 (February 8, 2026) - First Release
