# VulnRadar Changelog - AI Knowledge

_Auto-compiled from `lib/changelog/data.ts` on 2026-08-16._

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

## v3.4.0 - August 14, 2026 **(highlights)**
**Team-Scoped Resources, Admin Security Hardening**

A big one. Scans, webhooks, and scheduled scans can now be shared with a team instead of only living under one account, with real owner/admin/member/viewer permissions behind it. Alongside that: a proper audit of the admin panel's own security turned up and fixed a handful of real gaps, including a route that skipped 2FA enforcement entirely and a password re-entry prompt that was never actually checked server-side. A broader sweep for the same underlying bug, UI that claims success without checking whether the request behind it actually succeeded, found and fixed a dozen more instances across the admin panel, checkout, scan history, and every copy-to-clipboard button in the app.

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
  The browser extension is now installable straight from the Chrome Web Store instead of a manual unpacked-folder install. Firefox Add-ons review is still in progress; that path still uses the packaged release.
- [Bell] **[ADDED]** **Site Notifications Support a Second Action Button**
  A site-wide notification (banner, modal, toast, or bell) can now carry up to two action buttons instead of one, e.g. "Add to Chrome" next to "Add to Firefox" on the same announcement.
- [Wrench] **[FIXED]** **Extension: Auto-Scan URL Filters Could Be Resized Away**
  The whitelist and blacklist text boxes in the extension's Auto-Scan settings had no minimum or maximum height, so dragging the resize handle could shrink one down to a sliver or blow it up past the rest of the page. Now clamped to a sensible range.
- [Code] **[ADDED]** **Try It Live on the API Reference**
  Every documented GET endpoint on the API Reference page now has a live request panel: paste an API key, fill in the parameters, and see the real response, status, and timing without leaving the docs.
- [BellRing] **[ADDED]** **AI Verification and Summaries Now Work With an API Key**
  POST /scan/verify and POST /history/{id}/summary previously only accepted a logged-in session, so a script using an API key could get an AI verdict on a finding but never persist it, and couldn't generate a scan summary at all. Both now accept a Bearer API key with the scan:write scope, the same as every other scan-management endpoint.
- [Bug] **[FIXED]** **Detection Engine v3.2.1: More False-Positive Fixes**
  Bulk-scanned roughly 1,200 real sites, popular third-party hosts plus VulnRadar's own authenticated pages, and grouped the findings by title and host to spot systemic false positives instead of one-offs. Fixed: exposed-panel checks (Jenkins, Consul, MinIO, phpMyAdmin, Adminer, RabbitMQ) matching any single-page app's generic shell instead of the real panel; Twilio, Mailgun, and Facebook secret patterns matching substrings buried inside unrelated longer tokens; an XSS detector whose pattern could span across unrelated later code in the page; and a Connection String check that collided with Sentry's own unrelated dsn= convention (caught scanning roblox.com).
- [RefreshCw] **[FIXED]** **Any Hardcoded-Secret Finding Could Push a Scan to 10/10 Risk**
  The risk-score calculation treated every hardcoded-secret finding as "actively exploitable", including the deliberately low-risk tiers like a key that's already meant to be public client-side. A handful of harmless ones together could push a scan from safe straight to critical. Now only the two genuinely dangerous secret tiers count toward that.
- [Flag] **[FIXED]** **Marking a Finding False Positive Didn't Refresh the Risk Score On Screen**
  The score recalculation itself was already correct and saved right away, but the scan view you were looking at didn't know to refresh, so the risk score looked unchanged until you left and reopened the scan. It now updates in place as soon as you mark a finding.
- [Bug] **[FIXED]** **Detection Engine v3.2.2: Three More False Positives**
  A second bulk-scan pass over the same dataset. A cookie check that contradicted its own advice, flagging the modern, correct cookie syntax and telling you to revert to the deprecated one, got merged into the check that already covers the real risk. A prototype-pollution check was matching the standard defensive guard against pollution as if it were the vulnerability itself (flagged critical on google.com). And a Twilio credential pattern still collided with an unrelated token on a large enough page even after last version's fix, so it now also requires a Twilio-related keyword nearby before firing.
- [Lock] **[FIXED]** **Five of Our Own Pages Were Wrongly Gated Behind Login**
  Found by scanning our own site with our own scanner: the legal index page, the badge page, the post-checkout confirmation page, team invite links, and public host reports were all silently redirecting a logged-out visitor to the login screen instead of showing the page. Team invite links were the worst of it, since an invite is supposed to work for someone who doesn't have an account yet. All five are public now, the same as they were always meant to be.
- [Bug] **[FIXED]** **Detection Engine v3.2.3: 12 More, From Scanning Ourselves**
  Ran the scanner against every page on our own site for the first time this session, logged out and logged in, and worked through everything it found. Most of it was the scanner reading our own documentation's example code and prose as if it were a live vulnerability: a documented API response showing a sample nginx version, a docs page explaining what our webhook and .env paths are for, an OTP example bearer token, a privacy policy describing our OAuth integrations in plain English. Also fixed: a DOM-clobbering check that flagged an ordinary docs heading anchor, a hardcoded-IP check that didn't know about the reserved documentation IP ranges, an admin-path check whose wording claimed something it never actually verified, and a password-strength check that treated a login field the same as a signup field.

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

- **Total releases:** 57
- **Total changes documented:** 505
- **Latest:** v3.4.0 (August 14, 2026) - Team-Scoped Resources, Admin Security Hardening
- **Earliest in file:** v1.0.0 (February 8, 2026) - First Release
