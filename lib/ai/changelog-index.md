# VulnRadar Changelog: AI Index

_Auto-compiled from `lib/changelog/data.ts`._

Every release VulnRadar has shipped is listed here, newest first. Recent
releases carry every change with its full description; older ones thin out
to change titles and then to a single line, because the whole history with
full descriptions is far too large to hand over at once.

If someone asks about a release that only appears as a title or a line,
say what you can see and answer from the detail that gets retrieved
alongside their question: the complete entry for every release is indexed
in `lib/ai/changelog-knowledge.md` and pulled in automatically when a
question matches it. Never say a release does not exist because its
detail is not in front of you.

Versioning: major.minor.patch. The engine version (scanner rules) and the
app version (UI/backend) are tracked separately in the config (see
`lib/config/config-values.ts`).

---

## v4.0.0 - Unreleased **(highlights)**
**The Things That Were Written Down Twice**

The largest release since 3.0, and a pass over the whole product rather than one part of it. The theme that kept returning was facts written down in more than one place: a pagination parser copied seven times, a protocol list that silently dropped nine of the fifteen targets its sibling route accepts, API docs describing response shapes the routes do not return, and an example environment file that broke signup for anyone who copied it. Where a second copy earns its place it now has a test holding it to the first; where it did not, it is gone. Alongside that: admins can test a broadcast and save their own templates, the CLI's exit codes finally separate a failed security gate from a failed run, everything draggable works from the keyboard, and a set of performance fixes removed waiting that did not need to happen. Read Breaking Changes before upgrading.

### Changes
- [Code] **[BREAKING]** **Command-Line Tool Now Tells Failed Checks From Failed Runs**
  Our command-line tool sends a signal when it finishes, so automated pipelines can react to it. It used to send the same signal whether your site failed a security check or the tool itself could not run, for example because of an expired key or a network problem. Now those are different signals, so a pipeline can tell a real problem with your site apart from a tool error. If your pipeline treats any failure the same way, nothing changes; if it checks for a specific number, you may need to update it to also handle the new one.
- [Webhook] **[BREAKING]** **Webhook Type Is Now Validated**
  A webhook sends your scan alerts straight to Discord or Slack. The setting for which kind of webhook it is used to accept anything typed into it, but delivery only actually understands Discord and Slack: a webhook saved with the type spelled "Discord" instead of "discord" silently sent plain data instead of a formatted message, while still reporting success. The system now checks this field and rejects anything other than the four valid options. If you set up a webhook, use one of those values, or leave the type out so it is worked out from the web address.
- [ShieldCheck] **[SECURITY]** **Deleting a Webhook No Longer Reveals Which Ones Exist**
  Deleting a webhook used to respond differently depending on whether its identifying code belonged to someone else or simply did not exist at all: one case returned "not found", the other returned "success". Comparing the two responses let someone work out which webhook codes were real. Both cases now return the same "not found" response. If you delete a webhook twice, the second attempt will now show as "not found" rather than "success", which is expected and not an error.
- [Lock] **[SECURITY]** **Completing a Password Reset Is Now Rate Limited**
  Requesting a password reset link was already limited to stop abuse, but actually using that link to set a new password was not limited at all. Each attempt to use a reset link ties up part of the database, so someone could send huge numbers of attempts and slow the service down for everyone, even though the reset codes themselves are far too long to guess. Completing a reset now shares the same limit as requesting one, closing that gap.
- [Lock] **[SECURITY]** **Scan Reports No Longer Store Your Actual Cookie Values**
  When the scanner found a problem with a cookie (a small piece of data websites use to keep you signed in) or with a pre-filled form field, it used to save the exact value as proof. For a sign-in cookie, that value can be used to access the account itself. This proof is kept with the scan and shown in the report and any exports. Cookie values are now replaced with just their length, and form values are hidden, while the report still shows enough detail to explain the problem. This is now checked automatically so it cannot be reintroduced by accident.
- [ShieldCheck] **[ADDED]** **VulnRadar Scans Itself on Every Change**
  Every change to VulnRadar is now checked by scanning every page of our own public site with the same scanner customers use. If that scan finds a real problem, the change is stopped until it is fixed. Three known, harmless items are allowed through: two notes about a styling choice we made deliberately, and the description of our own API, which we publish on purpose. Everything else must come back clean, and the scanner is given no special treatment for being pointed at our own site.
- [Mail] **[ADDED]** **Send Yourself a Test Broadcast First**
  When staff write an announcement email to send to users, they can now send a test copy to themselves first, using the exact same layout and unsubscribe link a real recipient would see, before sending it to everyone. Sending a test does not save a draft, create a recipient list or add a history entry, so it can be tried as many times as needed. The test email's subject is marked [TEST] so it can never be mistaken for the real thing, and there is a limit on how many test sends can happen in a row.
- [FileText] **[ADDED]** **Save Your Own Broadcast Templates**
  Staff sending announcement emails used to be limited to seven built-in templates; adding another required a code change. They can now save the current subject and message as a new template, which then appears for every staff member to reuse. Saving under a name that already exists replaces that template rather than creating a duplicate. If a staff member leaves, the templates they created stay in place, and creating, changing or deleting a template is recorded for accountability.
- [Bot] **[ADDED]** **The Assistant Can See How Much of Your Limit Is Left**
  If you ask the in-app assistant why a scan will not start, it can now check exactly how much of your daily scan limit you have used, using the same figure that actually decides whether your next scan is allowed. Before, it could see your limit but not your usage, so it had to guess. It can also now tell you which specific problems a scan found, rather than only how many were high, medium or low severity.
- [UserCheck] **[IMPROVED]** **Password Managers Now Recognise the Sign-In Field**
  The email box on the sign-in and sign-up pages was labelled in a way that password managers did not recognise as the username field they should pair with your saved password, so some password managers would not offer to fill it in automatically. It is labelled correctly now, and it was our own scanner that caught the problem on our own site.
- [Palette] **[IMPROVED]** **A Calmer, More Consistent Interface**
  A round of visual polish across the site: sections on the landing page are now separated by a subtle background change instead of a thin line, buttons visibly respond when you press them, and cards no longer have a mismatched drop shadow. Menus, checkboxes and tabs now share the same rounded corners as the rest of the interface, and marketing buttons are pill-shaped while buttons inside the app itself stay rectangular. On your first visit, the site now matches your device's light or dark setting, defaulting to dark if that cannot be detected.
- [Layers] **[IMPROVED]** **Every Pop-Up Panel Now Opens the Same Way**
  Pop-up panels, such as sign-in, confirmations, the quick search box and others, already looked the same but opened differently: some slid in, one zoomed, and others simply appeared with no animation at all. They now all open with the same smooth motion, so panels that are meant to look identical now also behave identically.
- [ServerCrash] **[IMPROVED]** **See Which Scans Failed, Not Just How Many**
  In the admin area, the scanner queue used to show only a number of failed scans, with nothing behind it. That number now expands to show the failures grouped by error message, so 25 identical timeouts no longer look the same as 25 unrelated problems. The details only load when opened, rather than being sent automatically every 45 seconds, which also stops customer web addresses being sent over the network unnecessarily. On the billing overview page, the list of overdue accounts now shows as cards on a phone screen instead of a wide table you had to scroll sideways to read.
- [Target] **[FIXED]** **Icons Now Line Up With the Text Beside Them**
  An icon placed next to a line of text was sitting slightly too high, about four pixels above where it should be, in 18 places across the app. The shared icon component has been corrected so icons now line up properly with the text beside them.
- [Layout] **[FIXED]** **The Pricing Page Fits Small Phones**
  On a narrow phone, the plan comparison table on the pricing page made the whole page wider than the screen: the page was drawn zoomed out, and the cookie notice at the bottom ran off the right edge with its button out of reach. The same hidden table label that caused it sat in the table on the homepage, in the documentation tables and on the comparison pages, and all of them now stay inside their own scrolling area.
- [Smartphone] **[FIXED]** **Pages No Longer Swipe Sideways on iPhone**
  Some pages could be dragged left and right on an iPhone even though nothing on screen was actually wider than the phone. This was caused by a mismatch in how two different page elements handled overflow. It is fixed, and every page now measures exactly the width of the screen.
- [Shield] **[FIXED]** **The Status Badge Uses the Correct Brand Colour**
  The small status badge that sites can embed to show their scan result was drawing its warning colour in a generic yellow, one shade off from the product's actual amber. Because this badge appears inside other people's websites and README files, there was no way to notice or correct it there. It now uses the correct brand colour directly, and an automated check compares it against the real colour rather than a copy that could drift.
- [Gauge] **[PERFORMANCE]** **Less Waiting on the Pages You Use Most**
  Several of the most-used pages, including the scan detail page, used to load two pieces of information one after another even though neither needed to wait for the other; they now load together. A bulk scan used to save each web address to the database one at a time while holding up other work behind it; it now saves them all in one step. Scans that require signing in to the target site used to briefly freeze the server for about a second each, slowing down everything else happening at the same time; they now run without causing that slowdown.
- [Download] **[PERFORMANCE]** **Audit Log Exports No Longer Strain the Server**
  Exporting the admin audit log, the record of who did what, used to load up to a year of entries into the server's memory all at once before building the file, which on a busy day could have slowed the whole site down for everyone. The export now builds the file in smaller pieces instead. You still get the complete log, and if something goes wrong partway through, the download stops rather than quietly producing a file that looks complete but is missing data.
- [Search] **[PERFORMANCE]** **The Public Scans Page Loads Faster**
  The public scans directory, the page listing scans people have chosen to make public, had to search through the entire scan history on every visit to work out which entries to show, then count them again separately. The database has now been set up to find exactly those entries directly. This page is public and read by search engines, so it was the page that needed the improvement most.
- [AlertTriangle] **[ENGINE]** **Bulk Scans No Longer Drop Addresses Without Explanation**
  Scanning many web addresses at once only recognised six of the fifteen address types the scanner actually supports. If your batch included an email server, file transfer, remote login or database address, for example, it was silently left out of the results with no error explaining why, even though scanning that same address on its own worked fine. Bulk scans now accept the same range as single scans, and if an address type genuinely is not supported, the error message now names all fifteen types that are.
- [ServerCrash] **[ENGINE]** **A Scan That Failed Silently Now Leaves a Record**
  In rare cases, usually when the database itself was having problems, the system could not even record that a scan had failed, and the error explaining why was simply discarded. The scan would then sit stuck as "pending" or "running" with nothing to explain what went wrong. Those situations are now written to the admin error log with the scan's id and the reason, without affecting the rest of the service.
- [ScanSearch] **[ENGINE]** **Secret Key Checks Now Look Inside the Page's Own Scripts**
  The checks that look for exposed secret keys used to strip out all script code from a page before searching it, so that example code shown on documentation pages would not trigger a false alarm. That also removed the page's own working scripts, which is exactly where a real leaked key usually appears, so a key accidentally left in a page's own script was never caught. The checks now look inside real scripts too, while still skipping example code blocks and technical data the page uses internally, so documentation pages still do not falsely report themselves.
- [Globe] **[ENGINE]** **Checks Judge the Page That Was Actually Loaded**
  If you scanned a plain http:// address that redirected to the secure https:// version, the scanner judged the secure page as if it had loaded over the insecure connection. A check that only matters for secure pages never ran, an unrelated warning about plain connections fired even though the site does redirect to safety, and two other checks were skipped entirely. The scanner now judges the actual page it ends up on, and your previous notes on existing findings still carry over, since problems stay tracked against the address you originally typed in.
- [Layers] **[ENGINE]** **One Misconfiguration, One Finding**
  Some newer checks were meant to combine with older, similar checks into one finding, but the matching setup on the older side was missing, so they never merged. One misconfigured cookie could show up as nine separate findings, one flawed policy as four, and some issues repeated two or three times over. These now correctly merge into a single finding that lists which checks agreed. This is now tested automatically, which caught seven merge rules that had silently stopped working.
- [ShieldCheck] **[ENGINE]** **Security Policy Checks Now Look in Both Places**
  A website's security policy, which restricts which scripts and resources it can load, can be set two different ways: as a hidden instruction in the page's code, or as a setting sent by the server. Eleven checks only looked at the server setting, so a site using the in-page version was wrongly told it had no policy at all. Both places are now checked. Several smaller accuracy fixes went in alongside this, including rules that only apply to the server version, which are still checked only there, and other logic errors that caused missed or incorrect results.
- [FileSearch] **[ENGINE]** **Talking About a Problem No Longer Counts as Having One**
  Scanning our own site, including articles that discuss security problems the way any security blog does, used to raise about 120 false alarms, a dozen marked critical, because the checks treated example code and terms mentioned in the text as if the site ran them. Any customer with a similar documentation page had the same problem. Checks now read a page the way a browser uses it: code that really runs, not words describing it in headings or paragraphs. Checks meant to look for written text, such as an error message, still do, and this is now tested both ways.
- [FileSearch] **[ENGINE]** **Five Exposed Services Are Now Recognised**
  Five real exposures seen in actual security breaches had no dedicated check before. The scanner can now recognise: a Go program's built-in diagnostics page left open to the public, which leaks internal data; Symfony's developer debug panel, which records other visitors' sign-in cookies; Grafana dashboards left open to signed-out visitors; and an Elasticsearch, OpenSearch or Jupyter server left open with no password, the last of which lets anyone run code on that machine. Each is only flagged when the real product responds in a way only it would, so an ordinary site is not wrongly flagged.
- [ShieldAlert] **[ENGINE]** **A Certificate That Does Not Match Your Site Is Now Flagged**
  If your site's security certificate did not actually cover your domain name, or came from an untrusted source, your security grade dropped to the worst score with no finding explaining why, since only expired or self-signed certificates had one. Both problems are now reported clearly, and a mismatched certificate now lists which names it does cover. Separately, a common email-authentication setup was undercounting its lookups, so it could go over the allowed limit unreported, and a record that sets no real policy was wrongly treated as passing.
- [ShieldAlert] **[ENGINE]** **Open Redirect Checks Now Catch a Common Half-Fix**
  The scanner actively tests whether a site can be tricked into redirecting visitors somewhere unexpected, a common phishing trick. It used to try only one method, and sites using a common half-fix, blocking full web addresses but allowing anything starting with a slash, which can still point to a different site, were wrongly marked as safe. The scanner now also tries that bypass, closing the gap, while still correctly ignoring a redirect that simply carries the test value harmlessly in its own web address.
- [ShieldAlert] **[ENGINE]** **One Outdated Library Now Gets One Finding, Rated Correctly**
  An outdated code library, such as an old jQuery, used to be reported as up to six separate findings, with anything past the fifth silently dropped. It is now one finding, listing every issue worst first and naming the one upgrade that fixes them all. The backup list used when the outside database is unreachable had its own problems: some versions were wrongly cleared, others blamed for issues already fixed, and every issue was rated high regardless of severity. The two systems that detect a site's libraries have also been merged into one fuller list. Because each library now has a single finding, the first scan after upgrading shows these findings with new identifiers: expect a one-time set of "new" and "resolved" library findings in comparisons and alert emails, and set any false positive or accepted risk you had recorded on the old library findings again.
- [Layers] **[ENGINE]** **Duplicate Findings Merge Across the Whole Scan**
  The system that merges duplicate findings into one used to only look at checks that read the page's content, so anything found later, such as domain, certificate and live network checks, never merged, even when it genuinely reported the same issue. That is fixed: merging now runs once more over the complete result. Separately, the free demo on our landing page used an older, simpler scanner that skipped this merging and several other checks, so it showed a noisier result than a real account gets for the same address. It now uses the same engine as an actual scan.
- [Globe] **[ENGINE]** **A Broken DNSSEC Setup Is Now Correctly Reported**
  DNSSEC is the system that proves a domain's DNS answers, the records that turn a domain name into an address, are genuine. If a domain's DNSSEC setup broke, usually after a routine key change left an old record at the registrar, the domain becomes unreachable for many internet users, yet the scanner reported nothing about it. Worse, its own lookups hit the same problem, so it misread the domain as never having DNSSEC at all. The scanner now works around this and reports a clear, high-severity finding for a broken DNSSEC setup, without confusing it with a server that is simply down.
- [Globe] **[ENGINE]** **Subdomain Takeover Warnings Are More Accurate**
  A "dangling DNS" warning means a domain record still points at a service you no longer control, which someone else could claim to impersonate your site. This check used to mistake a brief, unrelated DNS outage for a genuinely missing target, wrongly flagging live sites, and it only checked one type of address, missing sites reachable only by the newer kind. Both are fixed: a takeover warning now needs solid proof the target really does not exist, and a weaker case is reported as a separate, less alarming issue instead. Reports of missing email signing (DKIM) are also marked as less certain, since the scanner can only guess where a domain keeps it.
- [Bug] **[FIXED]** **Scripts Can No Longer Slip Past the Code Checks**
  The scanner deliberately skips a few kinds of script that a site did not write itself, such as the page data a Next.js site sends along with every page and a small script Cloudflare adds for bot protection. It used to recognise those by looking for a telltale word anywhere inside a script, so a real script with that word in a comment was skipped too, and anything dangerous in it went unreported. A script with an unrelated setting whose name happened to end in "type" or "src" was skipped the same way. The scanner now only skips a script when the whole script matches what Next.js or Cloudflare actually send, and reads each script's settings properly, so these scripts are checked like any other.
- [ShieldCheck] **[FIXED]** **Each Loose Security Policy Rule Gets Its Own Finding**
  A site's Content Security Policy is a list of rules saying where a page may load things from, one rule per kind of thing: scripts, styles, connections, frames and so on. Two checks looked for rules that allow anywhere at all, and when both fired they were merged into one finding. So a policy that allowed scripts from anywhere and also allowed connections to anywhere was reported as one problem naming only one of the two, and the other fix was easy to miss. The two checks now look at different rules, and the one covering connections, frames and the rest lists every rule that allows anywhere, not just the first it finds.
- [Zap] **[SECURITY]** **A Scanned Page Can No Longer Stall the Scanner for Minutes**
  Some checks read a page in a way that slowed down enormously on unusual pages, for example a page full of an unfinished comment, an unclosed image tag, or text that looks like the start of a login token. The time these checks needed grew with the square of the page's size, so a page built that way could hold up the scanner for many minutes and delay everyone else's scans. Eighteen checks and the sign-in form reader used by authenticated scans had this problem. They now read the page in a single pass. A new automated test now measures how each check's time grows with page size, including the page checks the older speed tests never measured, so this cannot quietly come back.
- [Package] **[FIXED]** **Outdated Library Checks Are More Accurate**
  The scanner looks at the code libraries a page loads, such as jQuery or Bootstrap, and warns when a version has known security problems. Several things made that less accurate. A site's own file that merely sat in a folder called "bootstrap" was reported as the Bootstrap library, with Bootstrap's security problems named against it; now the file has to actually be the library. WordPress sites were missed, because WordPress writes a library's version at the end of the address ("?ver=3.7.1") where the scanner never looked; it now reads that for the libraries WordPress itself ships. A test version such as 2.0.0-rc.1 was treated as newer than the finished 2.0.0, so sites on the finished release were warned about a problem fixed before it came out. Problems that have no fix yet now say so, instead of leaving the advice blank, and a problem rated only on the newest scoring system now counts toward how serious the finding is.
- [ShieldAlert] **[FIXED]** **An Unreachable Vulnerability Database No Longer Looks Like a Clean Result**
  Part of the outdated library check asks OSV.dev, a public database of known security problems, about each library it finds. When OSV.dev could not be reached, the scan quietly treated that as "no problems found", so a report could say a library was fine when it was never checked. A scan now says this part did not complete when none of those questions got an answer, the same way it already does for other parts that fail. The software list in a report shows "unknown" rather than "clean" for anything it could not look up, and it asks again on the next scan instead of remembering the failure for half an hour.
- [BookOpen] **[FIXED]** **Further Reading Links Now Match the Problem**
  Every finding ends with links to read more about the problem. For about 250 checks those links had been filled in with the same few pages regardless of the subject, so a finding about a server revealing its version pointed at a guide to forcing secure connections, and a leftover debug page pointed at an article about cross-site scripting. Each of those checks now links to material about its own subject: the matching reference page for the setting involved, the official description of the weakness, and the matching OWASP Top 10 category.
- [Mail] **[FIXED]** **Emails Look Right in Gmail, Apple Mail and on Small Phones**
  In most mail apps, the rounded box around every email and around its highlighted notes had square outline corners with a rounded fill inside, so a thin sliver of the background showed at each corner. Those boxes are now cleanly rounded. On narrow phones, about half of all emails were also wider than the screen and had to be scrolled sideways, because the links at the bottom, the row of severity counts in scan emails, or a long web address could not wrap onto a new line. Every email now fits a 320 pixel wide screen.
- [ShieldCheck] **[SECURITY]** **Shared Reports No Longer Reveal Staff Roles**
  A shared report and the public scans list showed the exact role of the person who shared it, such as Super Admin or Billing. That told anyone with the link which accounts have the most power, which makes them easier to target. Public pages now only say Staff.
- [Layout] **[FIXED]** **Pages Say When Something Failed to Load**
  Several pages treated a failed request as if there was simply nothing there. The badge page said you had no scans to badge, the attack surface page said you had no domains, and the admin staff list said there were no staff members. Two admin lists also kept showing their loading placeholder forever when a request was refused. Each now says the list could not be loaded and offers a Try again button. Accepting a team invite or dismissing a notification from the bell also now tells you when it did not work, instead of quietly doing nothing.
- [Users] **[IMPROVED]** **Easier to Use With a Screen Reader or Keyboard**
  A review of every page found places where people using a screen reader or a keyboard were left out. Pop-up notices, demo scan results, API test responses and copy confirmations are now announced. Buttons that showed only an icon on phones have names. The notification panel closes with Escape. Headings are in a sensible order on the sign-in, pricing and comparison pages. Several small buttons were enlarged to be easier to tap, and the support chat no longer types replies out word by word for people who have asked their device to reduce motion.
- [Search] **[FIXED]** **History Filters Survive a Reload**
  Filtering your scan history and moving to page 2 remembered the page but not the filters, so reloading or sharing the link showed page 2 of everything. The search, tag, severity, date and sort choices are now kept in the address too.
- [Layout] **[FIXED]** **Small Visual Fixes Across the Product**
  The pricing page showed visitors who were not signed in a greyed-out Current Plan button on the free plan instead of a way to sign up. The scanned web address at the top of a finished scan was smaller on the dashboard and in history than on shared reports, and all four now match. The support chat button could float in the middle of the screen on a first visit. Warning notices, such as the one saying a scanned page redirected, were almost invisible in the light theme and now stand out as they do in the dark theme.
- [Lock] **[SECURITY]** **Emails No Longer Show Codes or Webhook Secrets**
  Sign-in and billing code emails put the code itself in the subject line, which shows on a locked phone's notifications and in the inbox list. The code is now only inside the message. Emails about webhooks printed the full webhook address, and for Discord, Slack and most other services that address works as a password for posting to your channel; they now show only enough of it to recognise which webhook is meant.
- [Mail] **[IMPROVED]** **Easier-to-Read Emails**
  Small grey text in emails, such as the labels next to details, the footer and the line offering a link to copy if the button does not work, was too faint to read comfortably and is now brighter. The main button in every email now matches the buttons in the app, with dark text on light blue that is much easier to read than the white text it had before. Emails about a deleted scheduled scan or a changed team role now say what to do if the change was not expected, like the other notices already did.
- [Bug] **[FIXED]** **Letters No Longer Cut Off at the Bottom**
  In several places the bottoms of letters like g, p and y were cut off, most visibly in the website address at the top of a shared report and in the numbers across the top of a scan result. Headings now get enough room for the whole letter, everywhere in the app, and a test keeps it that way.
- [Bug] **[IMPROVED]** **Buttons Stay Still When You Click Them**
  Buttons used to shrink slightly when pressed, and a few arrows and badges grew or slid when you hovered over them. It looked jittery, especially on buttons that open a menu. Buttons now just change colour, and nothing jumps around under your cursor.
- [Bug] **[FIXED]** **Icons Lined Up in the Broadcast Composer**
  The icons on the "Start from a template" and "Fill from the newest changelog entry" buttons in the admin broadcast composer sat above the text instead of beside it. They are centred now.
- [Bug] **[SELFHOST]** **Restoring a Backup No Longer Fails at Random**
  Restoring a database backup on a self-hosted install could stop with a message saying the file was not made by VulnRadar, even though it was. It depended on timing: if the database was a little slow to respond, the first part of the file was skipped. Restores now read the whole file every time. If one failed for you before, running it again with this version will work.
- [Bug] **[FIXED]** **Small Text No Longer Double-Spaced**
  Short descriptions and help text under settings, cards and forms had far too much space between their lines, so a two-line note looked like two separate notes and long explanations stretched down the page. Text now uses the normal spacing for its size, so the same sentence looks the same wherever it appears.
- [Shield] **[SECURITY]** **Admin Settings No Longer Show or Log Secrets**
  Two admin settings hold secrets: the signing secret for admin alert webhooks and the client secret for staff single sign-on. The settings page used to load them into the browser and show them in plain text, and every change wrote the old and new secret into the admin audit log. Now the page only says whether a secret is saved, the box is write-only, the audit log records that it changed but not what it is, and settings exports leave it out. If you saved either secret before this update, older audit log entries still contain it, so replace that secret with a new one.
- [Wrench] **[ADMIN]** **A Settings Page You Can Actually Find Things In**
  The admin settings page was a long column of 294 fields, with each description squeezed into a narrow strip and its control floating at the far edge of the screen. It now has a search box that looks through every setting's name and description at once, a Changed only filter, and a side list of sections instead of a strip of tabs that wrapped onto two lines. Plan limits are a single table with a column per plan instead of sixty separate rows, and each rate limit and its time window sit on one line. Unsaved changes on any section are saved together, instead of only the section you happened to have open.
- [Wrench] **[ADMIN]** **Settings That Could Not Change Anything Are Now Read-Only**
  About forty settings, such as the app name, logo and social links, are built into the app, so saving them in the admin panel was recorded but never used. They are now shown read-only, with the exact setting to change in the configuration file and the environment variable that overrides it. Two settings that nothing used at all, a footer text and a light background colour, have been removed.
- [Bug] **[EXTENSION]** **Clearer Extension Messages When Something Goes Wrong**
  When the browser extension could not reach VulnRadar, because you were offline or a network blocked it, it showed a technical browser error like "Failed to fetch". It now says it could not reach VulnRadar or that the request took too long. On browser pages that cannot be scanned, such as settings or new tab pages, the popup now says so up front instead of offering a Scan button that could never work. The small Scanning badge on pages is also easier to read, and the privacy section now explains what the extension runs on each page and why it needs each permission.
- [Trash2] **[ADMIN]** **Blocked-Domain Cleanup Previews Exactly What It Deletes**
  When staff block a domain they can wipe every cached scan of it. The preview list and the delete used different matching rules for one shape of input, so a search could list scans that the delete then refused to touch, reporting zero removed. Both now use the same rule, and the rule that stops a pattern like "%.com" from being read as a wildcard is now tested against a real database rather than assumed.
- [Key] **[ADMIN]** **Support Can Revoke One API Key Instead of All of Them**
  If you told us one of your API keys had leaked, the only thing our support tools could do was revoke every key on your account, taking down every other integration you run along with the leaked one. Each key in the admin panel now has its own revoke control, which invalidates that key and leaves the rest working. It needs the same permission and the same password confirmation as before, and you are emailed about it the same way.
- [Shield] **[ADMIN]** **Security Alerts Show Which Account They Are About**
  Each security alert in the admin panel now names the account it concerns, links to that account, and gives the alert a readable name instead of an internal code. The Block user confirmation lists the account being blocked, so nobody is blocked without being named first.
- [Wrench] **[ADMIN]** **A Tidier, More Predictable Admin Panel**
  A sweep across every admin section. Buttons for viewing and renaming teams and staff are visible without hovering, and deleting a team is no longer the most prominent button in its row. Revoking a staff invite now asks first. Search boxes, table headers, dates and small labels look the same in every section, and no admin text is smaller than 11 pixels. Counts no longer flash zero while a page loads, lists that show only part of their results say so, the broadcast composer no longer moves a field when you pick a recipient, and pop-up messages on phones appear at the top of the screen instead of covering the Contents button.
- [Mail] **[FIXED]** **Smaller Email Fixes**
  The red Critical tag in finding emails is now easy to read on its dark background. The email that asks you to verify your address uses the same word throughout instead of switching between verify and confirm. The notice about a new API key no longer puts the key's name on your lock screen. Promotional emails show offer codes and bullet lists in the same style as every other email, including in dark mode.
- [Wrench] **[IMPROVED]** **Dashboard, History and Scan Results Polish**
  A sweep of the signed-in pages. Bulk scans now show their queuing progress, which never appeared before. On phones, the scan form now explains why port scanning is unavailable when the real reason is a scan that signs in first, not an unverified domain. History's filters match every other list, the whole search box is clickable, and filters only appear once you have enough scans to need them. Every copy button now waits the same length of time before resetting and tells screen reader users that the copy worked. Search boxes no longer show two clear buttons at once, and several small labels are easier to read.
- [Wrench] **[IMPROVED]** **Steadier Pages While They Load**
  Several pages, including assets, public scans and repositories, jumped or changed shape when their content finished loading, because the placeholder shown while loading did not match the real layout. They now match. The same scan verdict reads Clean, Caution or Exploitable on every page, including the badge page, which said Safe and Unsafe. Closing a support ticket now asks first, because a closed ticket cannot be reopened. Dates on team invites, domains and repositories use the same format as the rest of the app.
- [ShieldCheck] **[CHANGED]** **Anything That Changes Your Data Asks First**
  About thirty controls across the app and the staff panel did what they did the moment you clicked them. They now ask first, and say what will happen: making a scan public or listing it in the public directory, signing out one session, removing a trusted device, removing your profile picture, scanning a site again, stopping a scan in progress, changing a teammate's role, cancelling an invite, applying a status to every selected finding at once, and setting a finding back to Open, which is the one that also clears its note, assignee and due date. On the staff side the same now applies to failing stuck scans, unlisting somebody's report, closing a support ticket, pausing a blocking rule, renaming a team, replacing a site-wide notice, and every quota reset. Switches that simply flip back, like pausing a webhook, still act immediately.
- [UserCog] **[FIXED]** **Your Settings Pages, Reviewed Screen by Screen**
  A pass over every tab of your account settings. Confirmations that could fail silently now stay open and say why, so a disconnect or a delete that did not work no longer looks like it did. Dates across the tabs are written the same way instead of three ways. Copy buttons announce themselves to screen readers, password and code fields point at their own error messages, and pressing Enter submits the password form from any of its three fields. Leaving the Security tab while your one-time backup codes are on screen now asks first, because leaving was the last chance to see them. Panels that failed to load announce themselves, the schedule and webhook rows stop showing raw internal names, and a progress bar that could overflow its track is capped.
- [Bug] **[FIXED]** **Payment and Account Dialogs Behave**
  The billing verification step no longer jumps to 'check your email' before the code has actually been sent, and pressing Continue twice no longer sends two emails. Pressing Escape or clicking outside a dialog while it is saving no longer closes it and loses what you typed. Subscription prices show as $5/mo like the credit prices, instead of $5.00/mo. The upgrade prompt uses the full plan name, such as Pro Supporter, so it matches the pricing page. Back links on checkout pages are easier to tap on phones, the credit meter shows your remaining free allowance as its own section, and the terms prompt's full terms link now opens the Terms of Service instead of the disclaimer.
- [Lock] **[ENGINE]** **Fewer Repeated Requests to Your Site**
  Checking your site's security certificate used to involve four separate connections to your server, one per certificate-related check. If your site sits behind a service that can route different connections to different servers, the four checks could see four different certificates, and the report then described several at once. They now share a single connection, so every certificate finding describes the certificate your visitors actually see. The check that deliberately tests old, insecure connection versions still connects separately, since it must offer only those versions. Three other checks that each downloaded your page again, to look for outdated code libraries, open storage buckets and a reused security code, now share a single download as well.
- [Timer] **[FIXED]** **A Busy Site Is No Longer Mistaken for Your Own Limit**
  Three different refusals shared one screen, and its wording described only one of them: your plan's daily scans. So being told "that address has been scanned too many times in the last hour", a limit we apply to protect the site being scanned and count across everybody, came with a headline suggesting a higher plan would fix it. It would not. Each of the three now says what it actually is: your daily allowance, a busy address that clears within the hour, or your own scans already running. Only the first mentions plans.
- [CalendarClock] **[FIXED]** **A Scheduled Scan That Fails Now Tells You**
  Scheduled scans emailed you when they finished and said nothing at all when they could not run. A schedule whose target went offline, lost its DNS or stopped answering could fail every run for weeks in silence, while the whole point of it was watching the site for you. You now get one email the first time a run fails, saying what happened in plain language, and nothing further until a run succeeds and then fails again, so a site that stays down does not fill your inbox.
- [Layers] **[FIXED]** **A Crawl Reports Each Problem Once**
  Scanning a whole site repeated every problem once for every page it was found on, so a missing header on thirty pages became thirty findings. One real site came back with over three thousand findings where scanning its homepage found under a hundred, and the risk score and grade were worked out from the inflated list. A crawl now reports each problem once and shows how many pages it was seen on. Findings that genuinely differ from page to page are still reported separately.
- [Lock] **[FIXED]** **A Crawl That Gets Signed Out Says So**
  When you scan a site behind a login and the site drops your session partway through a multi-page crawl, every page after that point is scanned as a signed-out visitor. The result showed a badge saying the session was lost, but still counted as a complete scan: full confidence, no warning, and nothing saying the signed-in area had not been checked. It now counts as an unfinished scan and names the signed-in view as the part that was missed, the same as a single-page scan already did.
- [AlertTriangle] **[FIXED]** **A Partial Scan Now Says Which Part Is Missing**
  When a scan did not finish and found nothing, the page named the areas that were skipped. When it did not finish but found something, it said only that "some checks ran out of time" and never which, so the one reader with both a partial result and findings in it was the one reader who could not tell what was still unchecked. Both places now name the same areas, and the wording no longer says the checks timed out when a check failed instead.
- [Filter] **[ENGINE]** **Five Page Checks Stop Flagging Ordinary Pages**
  Five checks were producing false alarms on ordinary pages: a source-code download link was flagged as an exposed sensitive file; a field was flagged just because its name contained letters like "tax", like a checkout page's tax rate, and now needs a real card, ID or tax number filled in; a common code-loading technique was mistaken for a riskier one; an article merely mentioning a debugging address, without linking to it, was wrongly flagged; and an insecure setting was marked high severity even where nothing changed. All five now need real evidence before reporting a problem.
- [ShieldCheck] **[SECURITY]** **A Page Designed to Freeze the Scanner No Longer Can**
  Before reading a page, the scanner first checks whether it is looking at a real web page at all. A page could be deliberately built to make that first check run almost forever, and while it did, every other scan running on the same server had to wait behind it. The check now takes an amount of time based only on the size of the page, not what is in it. A similar slowdown in the admin tool that converts a broadcast email into plain text was fixed the same way. Both were caught by automated security scanning of our own code.
- [ShieldAlert] **[ENGINE]** **A Security Code That Never Changes Is Reported**
  Some sites protect their pages with a one-time code, called a nonce, that tells the browser which scripts are genuine. It only works if the code is new on every visit. When it stays the same, for example because a page was cached with it, anyone can read it and use it to slip their own script in. The scanner now loads such a page twice and reports a code that did not change, without printing the code itself.
- [Wrench] **[ADMIN]** **Grant Credits From the Admin Panel**
  Staff can now see a user's AI, GitHub review and browser session credit balances in the admin panel and add credits directly, for example to make up for a problem, without touching the database. Each grant needs a reason and the staff member's own password, is recorded in the audit log, has a sensible maximum, and staff cannot grant credits to their own account. Only admins and the billing role can do this.
- [ShieldAlert] **[BREAKING]** **A Misspelled Check Name No Longer Gives a Clean Result**
  When a scan is started from the API, the command-line tool or a pipeline, it can be limited to certain kinds of checks by name. A misspelled name used to match nothing, so the scan quietly ran no checks at all and reported no problems, which looked exactly like a clean site. A name the scanner does not recognise is now refused straight away, with the list of names it does accept. If an existing pipeline passes a name that was never valid, it will now stop with an error instead of passing, which is the point: it was never actually checking anything.
- [Mail] **[ENGINE]** **Mail Servers That No Longer Exist Are Reported**
  A domain's MX records tell the world which servers receive its email. When one of those servers no longer exists, mail can bounce, and if the missing server belonged to another company's domain, whoever registers that domain could start receiving your email, password resets included. The scan now reports mail servers that do not exist, and treats the second case as high severity. A server that simply did not answer in time is not counted as missing.
- [CheckCheck] **[ENGINE]** **Several Incorrect Results Corrected**
  A batch of accuracy fixes. Sites that had enabled a browser security feature were wrongly told they had not, because the check looked for the wrong term. Algolia's public search key, documented as public by Algolia itself, was wrongly reported as a leaked admin key at the highest severity. A check about token verification was over-broad and flagged safe code as critical, and documentation pages merely mentioning a sensitive file path were wrongly flagged as exposing it. Several real problems previously missed are now caught too, including insecure cookies hidden by a nearby secure one.
- [ScanSearch] **[ENGINE]** **Error Pages Are Now Recognised by Their Actual Content**
  Checks that detect a default "error" or "not found" page, which can reveal a misconfigured server or an unclaimed subdomain, used to look for a sentence describing the page rather than the page itself, so they could be fooled or could miss it. Each now looks for what that error page actually contains. A check for an unclaimed subdomain also now requires the page to be short, since a real "not registered" response is only a line or two. A separate mismatch that misread a styling detail as a hidden password field, wrongly flagging every properly styled sign-in form, was fixed too.
- [AlertTriangle] **[ENGINE]** **A Check That Breaks No Longer Reads as a Clean Scan**
  If one of the checks that reads a page crashed instead of finishing, the scan used to just carry on and report as if that check had run cleanly and found nothing, even though it never actually looked. The report now says plainly when part of a scan did not finish, lowers its confidence figure accordingly, and records which checks failed. It also stopped blaming every unfinished section on running out of time, since that is only one possible reason.
- [Database] **[API]** **Asking for a Page of Results Can No Longer Break a Request**
  Several parts of the API that return lists of results let you ask for a specific page and page size. Seven of these handled the numbers slightly differently, and three had bugs: asking for page zero could crash the request, a page size that was not a proper number could cause an error, and an extremely large page size was accepted and caused a different kind of failure. All seven now use the same, corrected logic.
- [FileText] **[API]** **The API Specification Now Lists Everything Scans Accept**
  The API's technical specification, which any tool built to generate code from our API, or our own interactive API tester, relies on, was missing several real options for starting a scan, described the settings for a website crawl incorrectly, and did not correctly describe how sign-in details for authenticated scans should be structured. All of this is now accurate, and the interactive API tester on our site no longer pre-fills an example request that would actually fail.
- [BookOpen] **[API]** **API Reference Corrections**
  The written API documentation was checked line by line against how the API actually behaves. The most important fix: scanning multiple linked pages on a site was documented as costing a single unit of your quota, but it actually costs one unit per page scanned, for every way of using the API. Several smaller inaccuracies were also corrected, including what one endpoint's response looks like, exactly what a delete action requires and who is allowed to use it, and how long certain cached results last. A few previously undocumented options are now documented too.
- [Puzzle] **[EXTENSION]** **The Extension's Permission List Now Matches Reality**
  The browser extension's documentation listed two permissions it does not actually use, and left out two that it does use, for right-click scanning and exporting reports. For a security tool, claiming access it does not have is just as misleading as hiding access it does have. The documented list now exactly matches what the extension actually requests from your browser.
- [Wrench] **[CLI]** **Command-Line Tool: Choose Scanners, Visibility and Teams**
  Our command-line tool, used to run scans from scripts and automated pipelines, previously started every scan with only default settings. It can now choose which categories of checks to run, whether the result is public or private, and which of your teams should be able to see it. If the server is temporarily rate limiting requests, the tool now waits and retries automatically instead of failing your build outright.
- [FileDown] **[CLI]** **Command-Line Tool Can Download Your Report**
  The website could export a scan as a SARIF file for GitHub code scanning, a PDF, a Markdown report, a spreadsheet, or the compliance crosswalk, but our command-line tool could not ask for any of them: a pipeline that wanted one had to make a second request of its own, with a second copy of your key. The tool now takes a report format and a file to write it to, including the choice of whether findings you marked a false positive or accepted are included. The file is fetched before the tool decides whether your thresholds were exceeded, so the run that fails your build still leaves the report behind for the step that uploads it.
- [Wrench] **[CLI]** **Pipeline Templates Now Match the Command-Line Tool**
  The ready-made templates for running scans in GitHub and GitLab pipelines behaved slightly differently from our command-line tool. A single failed status check used to fail the whole pipeline; it now takes five failures in a row. Like the tool, they fail the build only when a real threshold is exceeded, and separately report when the scan itself could not run, so a temporary outage does not silently block your pipeline while findings still can. The GitLab template's timeout now follows how long the scan is actually allowed to take.
- [Eye] **[EXTENSION]** **The Extension's Privacy Statements Now Match What It Sends**
  The browser extension's Site Alerts feature, on by default, checks every site you visit against our records, sending that site's address at most once every 45 seconds per site. The extension's own privacy settings and privacy policy described this incorrectly: they said it only happened when you chose to scan, called it optional when it is on by default, and said page titles were sent, which they are not. All three now correctly describe what the extension actually sends, that the check does not store your address, and how to turn it off.
- [Keyboard] **[ACCESSIBILITY]** **Everything Draggable Now Works From the Keyboard**
  Two features could previously only be used with a mouse. The profile picture cropping tool could only be repositioned by dragging; it can now also be moved with the arrow keys, holding Shift for bigger steps. The handles used to resize the assistant panel had no way to be reached or operated by keyboard; they can now be selected with the keyboard and adjusted with the arrow keys, Home and End.
- [Eye] **[ACCESSIBILITY]** **Menus That Claimed to Hide the Page Behind Them Now Do**
  When certain mobile menus were open, screen reader software was told the rest of the page was unavailable, but the rest of the page could actually still be reached, including by a swipe gesture. Opening one of these menus now genuinely blocks interaction with the page behind it, matching how every other pop-up panel on the site already worked. Two buttons that were smaller than the recommended minimum touch size were also made bigger.
- [Container] **[SELFHOST]** **The Example Configuration File No Longer Breaks Signup**
  The example configuration file for self-hosting the app included a placeholder captcha key, switched on, without its matching secret. Copying the example file exactly as the setup instructions describe, which is what most people do, turned the captcha on without properly configuring it, breaking sign-up, password reset and the contact form on a fresh install. That placeholder is now switched off like every other credential. A now-unnecessary database setup step was also removed from the quick-start guide, since the database creates itself automatically on first start.
- [Activity] **[SELFHOST]** **Self-Hosted Installs No Longer Show as Unhealthy**
  Self-hosted installs running in Docker were being reported as "unhealthy" even when working correctly. The app redirects insecure requests to a secure connection, and it was applying that rule even to its own internal health check, which does not use a secure connection, so the health check always failed. The health check is no longer redirected. This had been going unnoticed because the automated test that should have caught it was accepting the redirect as a success; it now requires a genuine successful response.
- [Container] **[SELFHOST]** **Self-Hosting Setup Now Matches What the Guide Describes**
  Three parts of the self-hosting guide did not match what actually happens. It had you set your database password in one setting, but the real setup uses a different one, so the bundled database could run on the example file's placeholder password instead of yours. An external, already-managed database was recommended but not actually supported; a separate configuration file for that case is now provided. And building from your own copy while following the guide's steps actually launched the published version instead of your changes; it now builds your own copy.
- [Lock] **[SELFHOST]** **Plain-HTTP Deployments Can Now Stay Signed In**
  Running the app without a secure connection, on a trusted internal network, is a documented option, but signing in never actually worked that way. The sign-in cookie was always marked as requiring a secure connection whenever the app ran in its normal production mode, and browsers refuse to keep a cookie like that over an insecure connection, so users were immediately signed back out. Eleven different places in the code set this cookie option inconsistently. They now all follow one single, correct rule, with an automated check to stop this drifting apart again.
- [Activity] **[SELFHOST]** **An Incomplete Test Run Can No Longer Pass Quietly**
  A safeguard exists to catch a test run where part of it silently failed to start, but it was only checking one portion of the tests, so a run that lost an entire section, the browser extension's tests, still looked complete. It now checks every section, so a broken test run can no longer be mistaken for a passing one.
- [Activity] **[ADMIN]** **Clear Stuck Scans From the Admin Panel**
  When a scan gets stuck past its normal time limit, the admin panel already showed a warning, but clearing it meant waiting for an automatic background sweep, restarting the server, or editing the database directly. An admin can now fail stuck scans directly from that warning, using the same safety rules as the automatic sweep, so it only touches scans old enough to be genuinely abandoned. The sweep itself was also fixed to account for large bulk scan batches, which had been wrongly treated as interrupted while still simply waiting their turn.
- [Mail] **[ADMIN]** **Resend a Verification Email From the Admin Panel**
  If someone never received their account verification email, staff previously could only mark the account as verified without actually confirming the person had access to that address, or ask the user to find the resend option themselves. The admin panel now has a Resend Verification button that sends a fresh verification link to the address on the account. This action is logged, requires the same staff permission as manual verification, and cannot be used on an address that is already verified.
- [ShieldAlert] **[ADMIN]** **The Updater Will Not Downgrade You**
  Self-hosted installs running a newer version than the latest official release, for example a build taken straight from active development, were still offered an "Update now" button. Using it would have installed the older release over the newer code, including running its setup steps and applying its database changes to a database structure it was never designed for. That button is now switched off in this situation and explains why, and the update process itself refuses to install anything older than the version already running.
- [Settings] **[SELFHOST]** **Clearer Self-Hosting Configuration**
  Several self-hosting instructions were corrected. One database security setting was documented as accepting a file path, but only the certificate's actual contents work; a path left the app unable to connect at all. Guidance on which AI models are supported understated how much context they need and pointed to models too small to meet it; the requirement and examples are now accurate. A placeholder payment key is now switched off like other credentials, and payment and captcha settings now warn that a pulled Docker image needs rebuilding before they take effect.
- [BookOpen] **[SELFHOST]** **Documentation Checked Against the Code**
  The self-hosting documentation was checked claim by claim against how the app actually behaves, and many small inaccuracies were corrected: when the app checks its database structure is up to date, exactly what each staff permission level can do, that a scan or support ticket can be shared with more than one team or teammate, how AI code review reports confidence, and how long a Discord sign-in link lasts, among others. Version numbers and similar facts are now automatically checked against the actual code so they cannot drift out of date again.
- [ShieldCheck] **[SELFHOST]** **A Release Is Only Published After It Passes Our Checks**
  Publishing a new release image never actually confirmed that the exact version of the code being released had passed our automated checks first. This meant a release tagged on a version that failed those checks, or tagged just before the checks finished running, could be built, signed and published anyway, and then offered to every self-hosted install as an update. The publishing process now waits for those checks to finish on that exact version and refuses to continue unless they passed.
- [GitMerge] **[SELFHOST]** **Our Own Testing Catches More Before a Release Ships**
  Several gaps in our own automated testing were closed. The tests were running against a different database version than the one the self-hosting setup actually uses; they now match. The browser extension gained the same check the main app has that catches a dependency file accidentally broken by being regenerated on Windows, which could otherwise break builds. New checks also make sure related facts that are recorded in more than one place, such as the app's version number, its pricing plan limits, and which payment events it listens for, stay consistent with each other.
- [Trash2] **[REMOVED]** **Checks That Could Never Report Anything Are Gone**
  Fifty checks had already been switched off in earlier releases for good reasons: duplicates, tests for things browsers no longer use, or a key meant to be public. Three more were listed but never built. All still counted toward our advertised total number of checks and had their own page in our checks catalogue, despite reporting nothing. They are now removed, and the advertised total stops counting them: with the new checks added elsewhere in this release, it stands at 860+, the number a scan actually runs. A further 111 pieces of detection code that could never run at all were also deleted, and this is now tested automatically so it cannot happen again.
- [Trash2] **[REMOVED]** **Removed Code That Nothing Used**
  About 260 lines of unused code were removed after checking that nothing in the app, its scripts, background workers or tests actually used them. This included a second, weaker copy of an internal helper function that was easy to accidentally use by mistake instead of the real one, and a helper that had been marked for removal five months earlier but still had a few callers, which now use the proper replacement instead. This is internal cleanup with no visible effect on how the product works.
- [ShieldAlert] **[CHANGED]** **Engine Version 3.5.0**
  The detection engine that powers every scan moves to version 3.5.0. Scan results may change for reasons described elsewhere in this update: pages are read the way a browser uses them, error pages are matched more accurately, checks judge the address actually reached after redirects, new certificate, DNS, mail and exposed-tool problems are reported, and checks that could never find anything are removed. Identifying codes for existing findings are unchanged, so your previous notes and automated rules still apply, with one exception: the outdated-library check now reports one finding per library instead of one per advisory, so those findings get new codes this one time. A site whose content security policy has wildcards in several places now gets one finding per place instead of a single finding that named only one of them.
- [Gauge] **[CHANGED]** **Four Findings Lowered to Low Severity**
  Four findings are now reported as low severity instead of medium, since each only shows a condition exists, not that it is exploitable: a wide-open cross-site sharing setting, which browsers already refuse to send sign-in details to anyway, published API documentation, an unusual network method being allowed, and a text-matching guess that a data-query feature might allow unauthorised access. Where the scanner can confirm the serious version, or probes the network method directly, it keeps medium severity. A pipeline set to fail on any medium finding will no longer trip on these four alone.
- [Mail] **[SECURITY]** **A Contact Reply No Longer Goes to a Hidden Second Address**
  The email address field on our contact form accepted more than an address: a sender could append instructions to it that quietly added a second, hidden recipient. Anyone on our side clicking Reply would then have sent a copy of the conversation to an address they never saw. The field now only accepts a plain email address, and anything else is shown as plain text with no working reply link.
- [Container] **[SECURITY]** **Release Images Can No Longer Be Built From Fork Code**
  The workflow that builds and signs our ARM Docker image trusted whichever run triggered it, which could have let a copy of the project supply the code that gets published as an official update if a later change opened that door. It now confirms the trigger came from a real push to our own repository first. There is no evidence this ever happened; the gap is closed.
- [Container] **[SELFHOST]** **Docker Setup No Longer Points at an Unpublished Image**
  The self-hosting guide downloaded its Docker Compose file from our development branch, which can name a version of the image we have not published yet. Anyone following the guide during that window got an immediate and confusing "manifest unknown" error. The guide now downloads the file from the release it belongs to, so the image it names always exists.
- [Database] **[SELFHOST]** **Manual Database Setup Now Works on Current PostgreSQL**
  The self-hosting guide's manual database steps failed on PostgreSQL 15 and later with a permission error, because newer versions changed who is allowed to create tables by default. The steps now create the database already owned by the application's own user, which works on every PostgreSQL version we support.
- [Key] **[ENGINE]** **Weak Certificate Keys Are Rated by How Weak They Are**
  Every certificate key under the modern minimum got the same warning and the same wording, whether it was small enough to be broken in practice or merely outdated. Keys small enough to be broken are now reported as critical. The rest stay high severity with accurate wording: out of date and no longer issued, but not known to be breakable.
- [MailOpen] **[ENGINE]** **Mail Servers Offering Encryption Are Not Reported as Plaintext**
  A mail server was reported as sending everything unencrypted, at high severity, purely because of the kind of address it was, even when it actually offered the standard encrypted upgrade. That false warning is gone. Findings about a mail, remote-login or database server now only appear once the scanner has connected and seen the real behaviour, rather than being assumed from the address.
- [Crosshair] **[ENGINE]** **The Cross-Site Scripting Probe Stops Confirming Safe Echoes**
  Our optional active probe reported a confirmed critical cross-site scripting vulnerability whenever its test marker appeared anywhere in the response, including inside a text box, a quoted value or the page title, where a browser would never run it. It now only confirms a finding when the marker lands somewhere it could actually execute, removing a real source of false criticals.
- [Package] **[CHANGED]** **Dependency Updates**
  Routine updates to the software the app is built on: the interface framework (React), the payment, email and data-validation libraries, the AI provider integrations, the icon set, code-quality tools, and the browser extension's build tools. This keeps the app's foundations current.

---

## v3.9.1 - September 8, 2026
**Handed the Whole Book, Remembering None of It**

The assistant kept forgetting the changelog seconds after being handed it, and the reason was that we were handing it too much. Loading /changelog sent the complete release history, every description of every change since the first version, in a single message: half a megabyte, about 107,000 tokens, for one slash command. Nothing rejected it, which is why it went unnoticed for two releases. It simply crowded out everything else, and the request went out twice because a stale copy of the previous load was still in the array beside the fresh one. That command now sends a compact index instead, with the recent releases in full and every older one still listed, and the full history stays behind the retrieval that pulls in whatever an actual question matches. A test now measures the real files against the real budget, so the next one to outgrow it fails a build rather than quietly costing somebody the context they just loaded. The chat sheet on a phone also stopped being a desktop panel stretched to fit.

### Changes
- [Bot] **[FIXED]** **The Chat Assistant Forgot The Changelog Instantly**
  Typing /changelog in the AI chat used to load the entire release history into the conversation at once, which was so much text that the assistant could not actually use it and answered as if it had never seen the changelog. It now loads a short index instead: full detail for recent releases, titles only for older ones, so every release is still listed and asking about an older one still pulls in its full details.
- [Layers] **[FIXED]** **Every Loaded Command Was Sent Twice**
  Content you loaded into the AI chat, like a command's reference material, was being sent to the assistant twice, because of a bug that let a broken check silently pass. With the changelog grown very large, sending it twice could push a single request over the size limit, so the assistant would silently lose part of what it had been given. Both places that build these messages now share one corrected check.
- [Gauge] **[ADDED]** **An Out Of Date Limit On What The AI Chat Could Load**
  The AI chat splits its capacity between your conversation and any reference material you load, like the changelog or documentation, and silently drops anything past that limit. The limit was based on rough, outdated estimates, so loading the changelog alongside other material could push earlier content out with no warning. This is now checked automatically, and anything too large is marked as cut off instead of silently disappearing.
- [Smartphone] **[FIXED]** **The Mobile Chat Sheet Was Sized For Desktop**
  On a phone, the AI chat opens as a full-screen sheet, but everything inside it, replies, code snippets, and the quick-start buttons under the greeting, was sized for the much smaller desktop panel, making text hard to read and buttons hard to tap. Text and buttons are now sized up on phones, the send and menu buttons are easier to tap, and a disclaimer strip tucks away while the on-screen keyboard is open so the reply has room to show.
- [CalendarClock] **[FIXED]** **A Generated File Recorded The Day It Was Made**
  Some files the product generates automatically, used for search and documentation, included the exact date they were built, so rebuilding them on a different day made them look different even though nothing had actually changed, which could wrongly fail automated build checks around midnight. These files no longer include the build date, so generating them twice now produces identical results.

---

## Earlier releases: change titles

Descriptions omitted. Ask about any of these by version and the full
entry is retrieved.

---

## v3.9.0 - September 8, 2026 **(highlights)**
**Things That Fail Without Saying So**

- [FIXED] The Chat Answer Arrived All At Once
- [FIXED] A Heading That Changed Size While You Watched
- [FIXED] Four Pages Had Each Built The Same Error Box
- [SECURITY] A Production Backup Was Being Copied Into Every Build
- [ADDED] Automatic Checks Against Two Kinds Of Data Leaks
- [FIXED] A Few Small Inconsistencies Fixed Across The App
- [ADDED] Who Blocked This Domain
- [CHANGED] Reverse Proxy Setup Mistakes That Give No Error
- [FIXED] Every Payment Record Was Storing A Blank Reference
- [FIXED] Report Export Was Broken In The Chrome Extension
- [FIXED] The Command Line Tool's Data Output Was Broken
- [FIXED] Database Updates Could Run Without A Backup
- [FIXED] A Safeguard For Our Own Testing Process
- [CHANGED] The Emails Were White
- [FIXED] One DNS Security Fact, Reported Once
- [FIXED] Four Security Headers That Were Not Real Findings
- [FIXED] A Security Check Was Looking For The Wrong Thing
- [FIXED] Several Checks Were Flagging Ordinary Text
- [FIXED] An Outdated Vulnerability Flagged On Every Grafana Scan
- [SECURITY] Anyone Could Rewrite Someone Else's Chat History
- [FIXED] Plan Limits That Two Clicks Could Get Around
- [ADDED] Announcement Emails Used To Start From A Blank Box
- [SECURITY] A Security Gap In New Announcement Email Templates
- [ADDED] Fourteen New Security Checks Added
- [ADDED] A Security Contact File Check Now Actually Checks It
- [FIXED] VulnRadar Scanned By VulnRadar
- [ADDED] Links To Other Security Tools Added To Reports
- [SECURITY] An Admin Safety Check That Could Be Bypassed
- [SECURITY] Support Staff Could Read Every Customer's Webhook Secrets
- [SECURITY] The Lockout Message Told You Whether An Account Existed
- [FIXED] Two Ways To Pay Us And Get Nothing
- [FIXED] A Database Backup Could Restore With Duplicate Rows
- [FIXED] A New Security Check Could Freeze On A Bad Page
- [FIXED] Turning On Every Check In The Extension Disabled One
- [FIXED] Fixing The Command Line Tool's Timeout Handling
- [FIXED] A Build Check That Could Have Shipped A Broken Extension
- [FIXED] Scan History Was Capped At One Hundred Scans
- [SECURITY] A Tiny Page Could Freeze The Whole Server
- [SECURITY] A Block Button That Blocked Nobody
- [FIXED] The Admin Panel Asked For A Password And Then Said No
- [FIXED] A Timed-Out Scan Said Three Checks Came Back Clean
- [SECURITY] A Public Page Could Publish The Link You Actually Scanned
- [FIXED] The Daily Scan Limit Failed Open During Database Trouble
- [FIXED] The Alarm Switched Itself Off At The Moment It Went Off
- [FIXED] The Weekly Summary Could Arrive Every Six Hours
- [FIXED] A Scan That Was Never Saved Still Showed You A Report
- [FIXED] Download My Data Left Out Two Thirds Of Your Data
- [SECURITY] Deleted Accounts' Messages Could Live On A Shared Ticket
- [ADDED] A Way To Follow Along, Once, Without Being Asked Twice
- [SECURITY] A Shared Report Published More Than The Report
- [SECURITY] A Site Score Chart Had No Limit On Repeated Loads
- [FIXED] Badges Did Not Load Outside GitHub
- [FIXED] Revoked Share Links Kept Showing Old Previews In Chat
- [SECURITY] The Demo Scanner Returned A Site's Own Login Data
- [ADDED] Webhook Secret Rotation And History Are Now On The Website
- [FIXED] Stuck Scans Now Clear Automatically, Not Only At Restart
- [FIXED] A Failed Scheduled Scan Could Block A Slot Forever
- [FIXED] Scheduled Scans Could Run And Charge You Twice
- [FIXED] Two Background Checks Reported Healthy When They Weren't
- [FIXED] Automatic Backups Could Silently Stop Working
- [FIXED] A Cancelled Subscription Could Cancel The Wrong One
- [FIXED] Late-Arriving Payment Notices Could Undo A Payment
- [FIXED] Changing Plans Could Bill You Twice
- [FIXED] A Slow Response From Stripe Could Downgrade You
- [FIXED] Failed Payments Could Wrongly Mark Your Account Past Due
- [FIXED] An Unfinished Checkout Could Cancel Your Active Plan
- [FIXED] A Contact Form Message Could Be Sent And Then Lost
- [ADDED] You Can Now Turn A Badge Off Yourself
- [FIXED] The Demo Scan Showed Untested Sections As Clean
- [FIXED] Pricing Page Wrongly Promised More History On Paid Plans
- [FIXED] Landing Page Overstated The Free Bulk Scan Limit
- [FIXED] Around 770 Pages Had FAQ Content Nobody Could See
- [FIXED] Prices And Limits Were Typed By Hand, Not Kept In Sync
- [FIXED] Link Previews Named No Account On Social Media
- [FIXED] Two Pages Wrongly Said Scans Run In Your Browser
- [FIXED] Some Staff Roles Could Not Use Their Own Permissions
- [ADDED] Two-Factor Lockout Had No Way Back
- [SECURITY] Staff Actions During Impersonation Were Logged As Yours
- [SECURITY] Two Admin Actions Affected Everyone With No Record Kept
- [SECURITY] Staff Invitations Had No Limit On Attempts
- [FIXED] Social Login Admins Wrongly Told Their Password Was Wrong
- [FIXED] The Extension Applied One Page's Result To The Whole Site
- [FIXED] Five Admin Actions Gave No Real Confirmation Message
- [SECURITY] Impersonation Could Change A User's Password And Email
- [FIXED] Resuming A Paused Scan Ran It Immediately
- [FIXED] Resending An Announcement Could Email Everyone Twice
- [ADDED] Every Social Link Now Goes Through Our Own Website
- [FIXED] The Footer Email Button Went To An Error Page
- [CHANGED] Managing A Domain Now Opens Its Own Page
- [FIXED] Admin Tables Could Shrink Down To Almost Nothing
- [FIXED] Shared Items Showed Buttons Teammates Could Not Use
- [FIXED] Admin Panel Links Briefly Loaded The Wrong Section
- [FIXED] Admin Screens Jumped Around As Their Data Loaded
- [FIXED] A Health Summary Card Grew Every Time It Loaded
- [FIXED] Screen Readers Heard Nothing While Admin Pages Loaded
- [FIXED] A Leftover Line Appeared Over Pinned Table Headers
- [FIXED] A Warning Icon Was Misaligned With Its Own Text
- [FIXED] Every Email Link On The Site Works Again

---

## v3.8.5 - September 6, 2026
**Whose Domain Is It**

- [ADDED] Control Scans Other People Run Against Your Domain
- [FIXED] Chat Assistant Now Identifies Itself Correctly
- [FIXED] Fixed AI Code Reviews Silently Failing on Some Setups
- [FIXED] AI Code Review Now Skips Guesses Instead of Reporting Them
- [FIXED] Icons Next to Text Now Line Up Properly
- [FIXED] Fixed Chat Box Hidden Behind Phone Browser Bars
- [FIXED] Repository List Redesigned to Match the Scan History List
- [FIXED] Requesting an Extra Scan Option Could Cancel Your Whole Scan
- [FIXED] Several Admin Settings Were Quietly Ignored
- [ADDED] We Can Now Test Whether AI Verdicts Are Improving
- [SECURITY] Extra Safeguard Against a Database Backup Being Published
- [CHANGED] Removed an Outdated Security Header We No Longer Needed
- [FIXED] Cleaned Up an Unnecessary Step in Our Release Process

---

## v3.8.4 - September 6, 2026
**The AI Was Answering Without Thinking**

- [FIXED] AI Now Reasons Carefully With Any AI Provider You Use
- [FIXED] Fixed Wrong AI Request Format for Some AI Connections
- [ADDED] More AI Models Available, and the List Is Up to Date
- [FIXED] AI Was Wrongly Dismissing Some Real Security Findings
- [FIXED] AI Features Were Timing Out With Slower, More Careful Models
- [CHANGED] Self-Hosting: Raise Your Timeout for AI Scans
- [FIXED] Broken Two-Factor Backup Codes Were Reported as Working
- [FIXED] Fixed Errors When a Scan Was Deleted During AI Verification

---

## v3.8.3 - September 5, 2026
**The Scanner Reported a Zone It Could Not Actually Walk**

- [FIXED] Fixed a False Alarm About Guessing a Site's Subdomains
- [CHANGED] AI Could Not Flag DNS or Certificate Findings as Wrong
- [CHANGED] A Security Tip Told You to Fix Something You Couldn't
- [CHANGED] Moved a Security Check From Your Website to Your Mail Server
- [CHANGED] Fixed a False Alarm About a Header Almost No Site Needs

---

## v3.8.2 - September 5, 2026
**The Updater Stopped Refusing Installs It Had Always Updated**

- [FIXED] Fixed the Update Button Wrongly Disabled on Some Self-Hosts
- [CHANGED] Self-Host Updates No Longer Install Files You Don't Need
- [SECURITY] An Encrypted Backup Was Accidentally Published
- [FIXED] Fixed Our Setup File Pointing to an Older Version

---

## v3.8.1 - September 5, 2026
**A Scanned Page Can No Longer Stall the Server**

- [SECURITY] Making a Scan Private Did Not Actually Cancel Its Share Link
- [SECURITY] Fixed a Paid Feature That Could Be Used for Free
- [FIXED] Fixed a Search Engine Confusion About Our Homepage Address
- [FIXED] Fixed a Meaningless Version Number Shown at Startup
- [SECURITY] Fixed Two Weaknesses in Our Automated Release Process
- [SECURITY] A Page With Deeply Nested Code Could Crash Our Scanner
- [SECURITY] Certain Page Content Could Make Two Checks Run for Minutes
- [FIXED] Added Tests to Catch This Kind of Slowdown Automatically
- [FIXED] Following Our Own Setup Guide Could Lock You Out
- [SECURITY] You Could Join a Team by Claiming an Email You Did Not Own
- [SECURITY] A Scan That Timed Out Behind a Login Could Show as Clean
- [FIXED] Login Scans Were Not Counted Against Your Usage Limits
- [FIXED] A Batch of False-Alarm Fixes Based on Your Feedback
- [ADDED] Better Internal Tools for Improving Scan Accuracy
- [ADDED] Findings Now Show Their Proof, Reports Are More Consistent
- [FIXED] Fixed the Live Browser Viewer Showing the Wrong Size
- [CHANGED] The AI Chat Assistant Panel Redesigned
- [FIXED] Fixed Text Showing Through Admin Table Headers
- [CHANGED] All of VulnRadar's Emails Redesigned
- [FIXED] Backup Count in the Admin Panel Was Showing Double
- [FIXED] Fixed Misleading Errors When Restoring a Backup Failed
- [ADDED] New Admin Controls to Pause the Service During an Incident
- [FIXED] Some Kinds of Scans Never Sent Any Notifications
- [ADDED] Webhook Alerts Now Include What Actually Changed
- [SECURITY] More Pages Found That Could Freeze Scanning for Everyone
- [FIXED] Improved Automated Tests to Catch Future Slowdowns Earlier

---

## v3.8.0 - September 3, 2026 **(highlights)**
**Self-Hosting Works, Scans Tell the Truth, and Nothing Runs Free**

- [FIXED] Self-Hosted Setup No Longer Fails on First Run
- [FIXED] Self-Hosted Settings Now Actually Take Effect
- [FIXED] No Lockout When Self-Hosting Without Email Set Up
- [SECURITY] Release Checks Now Test the Real Self-Hosted Setup
- [ADDED] Self-Hosting Now Works on More Types of Hardware
- [FIXED] Database Setup No Longer Leaves Pieces Missing
- [SECURITY] Backups and Security Keys No Longer Fail Silently
- [FIXED] An Incomplete Scan Is Never Shown as All Clear
- [SECURITY] Security Checks No Longer Stop at the First Result
- [FIXED] Eight Scan Results Corrected to Say the Right Thing
- [SECURITY] A Malicious Page Can No Longer Freeze the Scanner
- [SECURITY] More Protection Against the Scanner Being Misdirected
- [PERFORMANCE] Scans Are Faster and Lighter on the Site Scanned
- [FIXED] Scans No Longer Get Stuck or Wrongly Marked Failed
- [FIXED] Deep Scan Options Are Actually Applied Now
- [FIXED] Five Ways Scans Could Dodge Your Usage Limit
- [FIXED] Billing Bugs That Could Downgrade a Paying Account
- [ADDED] One Page Shows All Your Credit Balances
- [CHANGED] The Pricing Page Now Explains What You Get
- [SECURITY] Sign-In and Two-Factor Security Strengthened
- [SECURITY] Closed Several Gaps With No Usage Limit at All
- [SECURITY] Gaps in Staff Access Controls Closed
- [SECURITY] Private Scans Can No Longer Start Out Public
- [FIXED] Shared Report Links Now Show a Proper Preview
- [SECURITY] Webhook Signing Secrets Are Now Encrypted
- [CHANGED] The Overall Verdict Now Leads Every Report
- [FIXED] Filtering and Sorting a Report Is Now Instant
- [FIXED] Scan History Now Shows Accurate Numbers
- [FIXED] A Failed Load No Longer Reads as an Empty Account
- [FIXED] Actions That Failed in Silence Now Say So
- [ADDED] You Can Scan Your Own Site Without an Account
- [FIXED] Team Scan Sharing Actually Works
- [FIXED] Support Tickets Read Like a Conversation on Both Sides
- [CHANGED] The Admin Panel Opens on a Health Check
- [FIXED] Sixteen Admin Panel Bugs
- [FIXED] Admin Settings That Saved and Then Did Nothing
- [FIXED] Light Mode Is Readable
- [FIXED] Keyboard Focus Is Now Visible, and Skip Links Work
- [FIXED] Every Dialog Behaves Like a Dialog
- [FIXED] Nothing Scrolls Sideways on a Phone Any More
- [FIXED] Loading Screens Match the Page That Arrives
- [FIXED] One Consistent Navbar, and Links That Actually Work
- [FIXED] Badges Now Show an A+ to F Grade
- [PERFORMANCE] Several Pages Got Much Faster to Load
- [PERFORMANCE] The App Sends Far Less Code on First Load
- [FIXED] The Changelog Page Stopped Downloading Every Release
- [FIXED] Email Fixes: Unsubscribe, Expiry Times, No Duplicates
- [FIXED] PDF and CSV Reports Render What You Actually Wrote
- [FIXED] The API Reference Documents the API That Exists
- [FIXED] Documentation Rewritten Where It Was Wrong
- [CHANGED] Documentation You Can Skim
- [FIXED] The Landing Page Says Who It Is For
- [FIXED] Check Pages Get Search, Filters, and Unique Titles
- [SECURITY] The Browser Extension Can Now Point at Your Own Server
- [FIXED] The AI Assistant Answers From the Whole Document

---

## v3.7.2 - August 26, 2026
**The AI Assistant Stops Forgetting Loaded Context**

- [FIXED] The Assistant Keeps the Context You Load

---

## v3.7.1 - August 26, 2026
**History Overflow, Dashboard Layout, Discord Sign-In, Staff 2FA**

- [FIXED] Long URLs No Longer Overflow the History List
- [FIXED] Recent Scans Fills the Dashboard Card
- [FIXED] Admin Panel Shows Discord Sign-In Links
- [FIXED] Staff 2FA Enforcement Covers Every Admin Route

---

## v3.7.0 - August 26, 2026 **(highlights)**
**Support Tickets, Report Exports, Attack Surface, GitHub Scanner**

- [ADDED] In-App Support Tickets for Every Plan
- [ADDED] Pull Any Scan's Report Straight from the API
- [ADDED] Compliance Reports Add HIPAA and GDPR
- [ADDED] Attack Surface Portfolio
- [ADDED] Browse Every Public Host, Not Just Your Own
- [CHANGED] Deeper Tech-Stack Detection with Real Brand Icons
- [ADDED] File Findings to GitHub as an Issue
- [ADDED] Cookie Notice
- [FIXED] The Notification Bell Shows on Every Signed-In Page
- [CHANGED] Support Tickets Are a Contact Option, Not a Separate Panel
- [SECURITY] New Support Tickets Pass a Captcha
- [SECURITY] Dropped a Retired Live-Chat Vendor From the Security Policy
- [ADDED] Code of Conduct, Discussions, and a Wiki
- [PERFORMANCE] More of the Project Is Verified in CI
- [FIXED] Session and Device Rows Always Show a Real IP
- [ADDED] See a Usable IPv4 for IPv6 Sign-Ins
- [CHANGED] Redesigned the Sign-In and Account Screens
- [FIXED] Admin Panel Denies Non-Staff Instantly
- [ADDED] Create a Team With Invites, and Act on Invitations In-App
- [FIXED] Open Popovers Close When You Scroll, Everywhere
- [ADDED] Remediation Gets Due Dates and a Teammate Assignee
- [ADDED] Set Remediation on Many Findings at Once
- [ADDED] GitLab CI Scan Gate
- [ADDED] Machine-Readable OpenAPI Spec
- [ADDED] Scan From the Command Line
- [ADDED] Social Preview Link on Scan Results
- [ADDED] Import an API Spec to Find Scan Targets
- [ADDED] API Playground: Try Calls and Copy Them as Code
- [ADDED] Documentation Now Covers the Whole Product
- [FIXED] Unlimited Scan Tiers No Longer Lock Themselves Out
- [ADDED] Skip-to-Main-Content Link
- [CHANGED] Privacy Policy Accuracy Pass
- [SECURITY] Two-Factor Codes Can No Longer Be Replayed Within Their Window
- [SECURITY] Per-Account Login Lockout Against Distributed Brute-Force
- [FIXED] Concurrent-Scan and Crawl-Quota Races Closed
- [SECURITY] Active Probes Pinned Against DNS Rebinding
- [FIXED] Changing Your Email Sends a Verification Link Right Away
- [SECURITY] Credit Grants Verify the Amount Paid
- [FIXED] PDF Reports Stay Valid With Non-ASCII Content
- [SECURITY] Staff-Only Notices Stay Staff-Only
- [SECURITY] Stronger Password and Session Hygiene on Profile Changes
- [SECURITY] Safer Links Throughout the App
- [FIXED] AI Chat Conversation Saves Are Rate-Limited
- [FIXED] Readiness Check No Longer Leaks a Database Connection on a Slow Probe
- [FIXED] Landing-Page Contact Form Works Without a Captcha Configured
- [FIXED] GitHub-Review Credits Are Now Spendable on the Free Plan
- [FIXED] AI Chat No Longer Spends Your Purchased AI Credits
- [FIXED] Credit Purchases Can No Longer Be Lost to a Mid-Write Crash
- [FIXED] A Free GitHub Review That Produces Nothing Is Refunded
- [FIXED] Rejected Scans No Longer Count Against Your Daily Limit
- [SECURITY] Cross-Tenant Team Admin Tightened to Admins
- [CHANGED] Demo Page Rebuilt on the Real Result View
- [CHANGED] Regression Tests Around the Anti-SSRF Fetch Guard
- [FIXED] A Stuck Scan Can No Longer Crash the Server
- [SECURITY] Demo Subdomain Discovery Is Cache-Only
- [FIXED] Browserbase Credit Grants Made Crash-Safe Too
- [FIXED] API-Key Scans Count Against the Daily Scan Limit
- [SECURITY] Admins Can No Longer Act on Peer Admins
- [SECURITY] Tighter Gates on Cross-Tenant Admin Reads
- [FIXED] Blocked-Domain Deletion Can't Over-Match
- [FIXED] Disconnecting a Sign-In Method Is Now Race-Safe
- [FIXED] AI Chat Requests Are Size-Bounded
- [PERFORMANCE] Faster Email Two-Factor Verification

---

## v3.6.1 - August 22, 2026 **(highlights)**
**Billing Correctness, Discoverability, Mobile Live Viewer**

- [FIXED] Staff Plan Changes No Longer Open a Stripe Checkout
- [SECURITY] Refunds and Chargebacks Reverse One-Time Credits
- [FIXED] Admin MRR No Longer Overstates Annual Plans
- [FIXED] Stripe Webhook Registers Every Event It Handles
- [ADDED] Search and AI Answer Engines See the Full Capability Set
- [FIXED] Canonical URLs Always Point at the Production Domain
- [FIXED] Live Browser Viewer Works on Phones
- [ADDED] Scanner Warns Before Scanning a Page It Cannot Reach
- [FIXED] Extension: Onboarding, Keyboard Access, Instant First Paint (0.1.8)
- [FIXED] Background Worker Escalation Survives Restarts
- [FIXED] Admin Broadcasts Dedupe Recipients and Confirm Delivery

---

## v3.6.0 - August 21, 2026 **(highlights)**
**Security and Detection Hardening, Live Browser Redesign**

- [SECURITY] Closed a Daily Scan Quota Bypass
- [FIXED] API Scans No Longer Billed Twice
- [SECURITY] Sign-In Is Bound to the Browser That Started It
- [SECURITY] Team Roles Cannot Be Escalated Past Your Own
- [SECURITY] Scanner Hardened Against Pages Built to Hang It
- [FIXED] Detection Correctness: Cookies, SPF, DMARC, CSP, TLS, MTA-STS
- [ADDED] Live Browser Session Viewer, Rebuilt
- [ADDED] Open the Extension in a Full Tab
- [FIXED] Scan Duration Now Matches the Wait
- [SECURITY] Bulk API Scans Honor 'Private by Default'
- [FIXED] Account Deletion, Contact Form, Team Webhooks, Session Cleanup
- [FIXED] History View Polish

---

## v3.5.1 - August 20, 2026
**Updater Stale-File Cleanup, Build Warning Fix**

- [FIXED] Updater Now Removes Stale and Unneeded Files
- [FIXED] No More Tailwind Config Build Warning

---

## v3.5.0 - August 20, 2026 **(highlights)**
**Domain Verification, Live-Browser Metering, Quota Bypass Fixes**

- [ADDED] SSL/TLS Letter Grade
- [ADDED] Full DNS Records on Every Result
- [CHANGED] Subdomains Are Discovered Automatically
- [CHANGED] More Subdomain Discovery Sources
- [CHANGED] Deeper Crawls With Sitemap Discovery and Higher Page Limits
- [CHANGED] Active Probes Are Now Nine Separate Toggles
- [ADDED] Markdown Report Export
- [CHANGED] Every Email Redesigned
- [ADDED] Billing and Account Emails You Were Missing
- [SECURITY] Scan History Links Are No Longer Sequential
- [FIXED] Service Probes Now Report on Every Scan
- [CHANGED] Every Scan Option Explains Itself
- [FIXED] Database Backups in the Admin Panel
- [ADDED] A Fix Guide for Every Check
- [ADDED] Domain Ownership Verification
- [SECURITY] Three Active Probes Ran on Every Scan, Not Just When You Opted In
- [ADDED] Two New Active Probes: Command Injection & Open Redirect
- [ADDED] Live Dependency Scanning via OSV.dev
- [ADDED] Live-Browser Sessions Now Have an Account-Wide Concurrency Queue
- [ADDED] Live-Browser Minutes Are a Real, Metered Plan Limit
- [ADDED] Concurrent-Scan Capacity Limit
- [SECURITY] Periodic Domain Re-Verification
- [ADDED] Adaptive Confidence Scoring
- [FIXED] Domain Verification Crashed on Every Failed Attempt
- [FIXED] Bulk-Scan URL Limit Ignored Your Actual Plan
- [FIXED] A Rejected Scan Could Still Burn a Daily Quota Slot
- [SECURITY] Daily Scan Quota Was Bypassable via API Key, Unenforced on Crawls
- [FIXED] Account Deletion Was Completely Broken
- [CHANGED] Active Probing Reorganized Into Modules
- [ADDED] Multi-Source Threat Reputation on Every Scan
- [ADDED] Opt-In Page Screenshots
- [ADDED] Curated Open-Port Sweep
- [ADDED] Software Inventory With CVE Correlation
- [ADDED] Remediation Status That Survives Rescans
- [ADDED] Compliance Mapping Reports
- [ADDED] Authenticated Scanning and Crawling
- [ADDED] Refresh DNS, Ports, Subdomains and Screenshots on Demand
- [CHANGED] Every Result Surface Shows the Same Panels
- [FIXED] Mobile Fixes for Notifications and Screenshots
- [FIXED] Dashboard Recent Scans and Result Links
- [SECURITY] Screenshot Links Use the Opaque Scan Id
- [CHANGED] Uploaded Avatars Moved Into the Database
- [FIXED] Backups Encrypt by Default and Fail Loudly Without pg_dump
- [CHANGED] Engine Version 3.3.0

---

## v3.4.0 - August 16, 2026 **(highlights)**
**Team-Scoped Resources, Admin Security Hardening**

- [ADDED] Team-Scoped Scans, Webhooks & Schedules
- [ADDED] Formal Super-Admin Protection (god_mode)
- [FIXED] Admin Team Management Skipped 2FA Enforcement
- [SECURITY] Removed Bulk User Actions
- [FIXED] Admin Panel Showed a Generic Error When 2FA Was the Real Reason
- [FIXED] Super Admin's Role Displayed as "User" on the Edit Screen
- [ADDED] This App Now Redirects Plain HTTP to HTTPS Itself, Not Just the Proxy
- [FIXED] Scanner Options Panel Closed the Instant You Tried to Scroll It
- [FIXED] Impersonate User, Finished
- [FIXED] Confirm Dialogs and Action Buttons Could Show Success on a Rejected Action
- [FIXED] Copy Buttons Could Show "Copied" When Nothing Was Copied
- [FIXED] Subscription Checkout Could Show Success Before the Plan Actually Changed
- [FIXED] Mass-Email Preview Showed Escaped HTML Instead of the Real Formatting
- [FIXED] A Few Displayed Values Had Drifted From Their Own Source of Truth
- [FIXED] Checkout Pages Could Redirect to a Dead Route on a Network Blip
- [ADDED] Admin Password Resets Now Go Out By Email
- [ADDED] CVSS 3.1 Scoring on Every Finding
- [ADDED] Active Probing: SQL Injection & Template Injection
- [ADDED] GitHub Actions Scan Gate
- [ADDED] Extension: Live on the Chrome Web Store
- [ADDED] Site Notifications Support a Second Action Button
- [FIXED] Extension: Auto-Scan URL Filters Could Be Resized Away
- [ADDED] Try It Live on the API Reference
- [ADDED] AI Verification and Summaries Now Work With an API Key
- [FIXED] Detection Engine v3.2.1: False-Positive Hunt at Scale
- [FIXED] Any Hardcoded-Secret Finding Could Push a Scan to 10/10 Risk
- [FIXED] Marking a Finding False Positive Didn't Refresh the Risk Score On Screen
- [FIXED] Five of Our Own Pages Were Wrongly Gated Behind Login
- [CHANGED] Self-Updater No Longer Builds or Restarts For You
- [ADDED] Database Is Backed Up Automatically Before Every Migration
- [FIXED] Silent Background & Billing Failures Now Reach the Admin Panel
- [ADDED] Extension: Live on Firefox Add-ons
- [CHANGED] Email Logs: Simpler List, Real Preview

---

## v3.3.2 - August 13, 2026
**Badge List Deduping, Stray Focus Ring on Menus**

- [FIXED] Badge Page Listed the Same URL as Multiple Entries
- [FIXED] Stray Focus Ring Around the First Menu Item

---

## v3.3.1 - August 13, 2026
**Self-Updating Badges, False-Positive Risk Scoring**

- [ADDED] Self-Updating Embed Badge
- [FIXED] Marking a Finding False Positive Now Lowers the Risk Score
- [FIXED] AI Verification Timing Out on Large Scans
- [FIXED] Credit Card Pattern Check Flagged Published Test Card Numbers
- [FIXED] Hardcoded Credentials Checks Flagged Ordinary Frontend Code

---

## v3.3.0 - August 13, 2026 **(highlights)**
**Scanner Accuracy Overhaul, ~40 New Checks, One Trust Verdict Everywhere**

- [FIXED] Full Accuracy Audit Across Every Existing Check
- [ADDED] ~40 New Checks Across Auth, Headers, Supply Chain, and More
- [FIXED] One Trust Verdict, Computed Once, Shown Everywhere
- [SECURITY] Admins Can No Longer Reset a User's 2FA
- [ADDED] Admin Can See a User's Connected Discord, Google, and GitHub
- [FIXED] Fixed Landing, Login, and Signup Page Animations Running Instantly
- [CHANGED] Scan History Now Kept Forever, On Every Plan
- [ADDED] 52 More Settings Moved Into Admin Config

---

## v3.2.2 - August 12, 2026
**AI Chat and Verify Fixes, Focus Ring Cleanup, Self-Updater Port Fix**

- [FIXED] AI Verify Findings No Longer Cut Off Mid-Word
- [FIXED] Fixed AI Scan Summaries Failing With a 502
- [ADDED] AI Verify Now Pre-Fills "Mark This Result"
- [FIXED] AI Chat No Longer Swallows Unrecognized Commands
- [FIXED] Fixed a Two-Tone Focus Ring Left Over on Buttons and Links
- [FIXED] Self-Updater No Longer Wipes a Custom Start Port

---

## v3.2.1 - August 12, 2026
**Auto-Tag Quality Fixes, Severity Badge Colors, Admin Self-Actions**

- [FIXED] AI-Suggested Tags Could Read as Garbled Sentence Fragments
- [FIXED] AI-Suggested Tags Couldn't Be Dismissed
- [FIXED] Info-Only Scans No Longer Tagged Needs Hardening
- [FIXED] Every Severity Level Gets a Colored Badge Now
- [FIXED] Super Admin Can Modify Their Own Account
- [FIXED] Firefox Add-on Fixed for AMO's New Data-Collection Disclosure

---

## v3.2.0 - August 12, 2026
**Threat Reputation, Active Probing, Host & Share Management, Super Admin**

- [ADDED] Admin: Browse and Manage Hosts & Shares
- [ADDED] Super Admin Now Auto-Detected
- [CHANGED] Extension: A Quieter Reputation Card
- [FIXED] Fixed a Layout Bug That Could Hit Any Grid on Mobile
- [CHANGED] Modals No Longer Auto-Focus Anything
- [FIXED] Fixed a Cloudflare False Positive Blocking Authenticated Scans
- [FIXED] Scan History Now Shows Where a Redirect Actually Landed
- [ADDED] Docs: Browser Extension Page
- [FIXED] Fixed the Self-Updater Failing on npm ci
- [FIXED] AI Tag Suggestions Were Silently Failing to Save
- [FIXED] Generic Cloudflare/Vercel Server Header No Longer Flagged
- [FIXED] A Few More Production Header Findings Fixed
- [ADDED] AI Chat Knows More About VulnRadar Itself
- [FIXED] "Back to Scanner" Button Actually Works Now
- [FIXED] Fixed a False "Message Too Long" Error in AI Chat
- [CHANGED] Docs Section Headers No Longer Have Icons
- [ADDED] New Check Category: Threat Reputation
- [ADDED] New, Opt-In Check: Reflected XSS via Active Probing

---

## v3.1.1 - August 12, 2026
**GitHub Review Credits, Host Report Parity, a Duplicated Header Fixed**

- [ADDED] Buy More GitHub Review Credits
- [ADDED] Public Host Reports Get Auto-Tags Too
- [CHANGED] Host Report Header Matches the Shared Page
- [FIXED] Cross-Origin-Embedder-Policy Was Being Sent Twice on Every Response
- [FIXED] Robots.txt Sensitive-Path Check Could Double-Count the Same Path
- [FIXED] DKIM Check Only Knew 7 Generic Selector Names
- [FIXED] API Key Rotation Email Could Crash and Silently Fail to Send
- [FIXED] Admin Save Confirmation Snapped Back to the Form Right After Saving
- [FIXED] Admin System Refresh Button Had No Visible Feedback

---

## v3.1.0 - August 12, 2026 **(highlights)**
**In-App Self-Updater, Auto-Tagged Scans, and a Blue Rebrand**

- [ADDED] Admin > System Can Update VulnRadar From the App
- [CHANGED] AI Finding Verification Gets a Real Usage Quota
- [ADDED] Scans Get Tagged Automatically
- [ADDED] Admin > System > Error Logs
- [ADDED] Public Scans Directory
- [ADDED] Admin: Engine Feedback Dashboard
- [SECURITY] Public Scans, Sitemap, and robots.txt Were Silently Unreachable
- [CHANGED] Primary Color: Cyan to Blue
- [CHANGED] Mobile Pass Across the App
- [CHANGED] Light Mode, Less Stark
- [CHANGED] Changelog Redesigned
- [CHANGED] AI Chat: 500 to 2,000 Characters
- [CHANGED] Staff Accounts Get a Real Plan, Not Blanket Access
- [CHANGED] Modal Close Buttons Are Actually Visible Now
- [CHANGED] Share Modal Discloses the Public Directory
- [CHANGED] Terms Modal, Onboarding Tour, and Legal Pages Redesigned
- [FIXED] Scanner: Fewer False Positives From Framework Noise
- [FIXED] Social Previews No Longer Show Stale Metadata
- [FIXED] Extension: No Longer Renders Broken on a Raw File
- [FIXED] Extension: Scan This Link Shows Something's Happening
- [FIXED] Admin Password Re-Auth Actually Prompts Now
- [FIXED] Fixed a Contrast Issue From the Color Rebrand
- [FIXED] Admin Delete Account Actually Reports Success Now
- [FIXED] Auto-Tags: Two Bugs That Could Leave a Scan Untagged
- [FIXED] Admin Updater: No More Stuck "Running," No More Double-Runs
- [FIXED] Free GitHub Review Trial Couldn't Be Used Twice by Racing the Request
- [SECURITY] Error Logs Redact Secrets Before They Reach the Admin Viewer
- [FIXED] Rotating an API Key No Longer Resets Its Usage Count
- [FIXED] Extension: A Host You Just Scanned No Longer Shows as Unscanned on Refresh
- [FIXED] Focus Ring No Longer Bleeds Past Rounded Menus and Dropdowns
- [CHANGED] Shared Scan Page: Tags Moved Into the Header, Less Duplication

---

## v3.0.1 - August 11, 2026 **(highlights)**
**SSRF Fix, Admin App URL Finally Works, AI and Extension Fixes**

- [SECURITY] SSRF Gap Closed in Four Scanner Checks
- [FIXED] The App Now Actually Uses the URL You Set in Admin
- [FIXED] A Finding Could Silently Disappear From an Alert
- [FIXED] Bulk Scans Could Miscount Results on a Duplicate URL
- [FIXED] AI Summary No Longer Gets Cut Off
- [ADDED] Ask the AI Chat About a Summary
- [FIXED] Closing an AI Check Now Actually Cancels It
- [FIXED] Fixed a Broken Social Preview Image
- [FIXED] Extension: Notification Sound Actually Plays
- [ADDED] Extension: Service Probes Settings Are Reachable
- [ADDED] Extension: Shows Its Own Version and VulnRadar's
- [FIXED] Extension: Pointed at the Right Server
- [CHANGED] Docker Healthcheck Actually Checks the Database Now

---

## v3.0.0 - August 10, 2026 **(highlights)**
**Ephemeral Authenticated Scanning, Background Scan Jobs, Deep-Parse Detection**

- [SECURITY] Webhooks Are Now Signed and Logged
- [SECURITY] API Keys Can Be Scoped to Exactly What They're Allowed to Do
- [CHANGED] Critical/High Alerts Now Only Fire on Genuinely New Findings
- [FIXED] Every Admin Setting Is Now Actually Wired Up
- [ADDED] Extension: Snooze Site Alerts, Move the Popup
- [SECURITY] Authenticated Scanning Is Now Fully Ephemeral
- [ADDED] Real Browser Login, Honest About Bot Protection
- [CHANGED] authReport on Every Authenticated Scan Response
- [CHANGED] Scans Are Background Jobs With Real Per-Category Progress
- [ADDED] Cancel a Running Scan
- [ADDED] Scanner Engine: 43 New Checks That Actually Parse the Page
- [SECURITY] Sessions and API Keys Can Be Bound to Their Subnet
- [ADDED] Team Invites Land in the Notification Bell
- [CHANGED] Admin Settings Is a Real Registry-Driven UI Now
- [CHANGED] Browser Extension Rewrite: Chrome and Firefox
- [CHANGED] Database Schema: 5.0.0 Through 5.6.0
- [SECURITY] Super Admin: the First Account Can Never Be Modified From the Admin Panel
- [CHANGED] Simpler /dashboard: URL + Right-Side Service Probes
- [ADDED] Service Probes by Hostname, Not URL Scheme
- [ADDED] URL State for /dashboard (mode + probes + ports)
- [CHANGED] Detection Engine v3.0.0
- [ADDED] API: `probes` Field on /api/v3/scan
- [ADDED] Per-Family Check Toggle (12 Categories, Auto-Disable for HTTP)
- [CHANGED] API Moved to v3: v1 and v2 Removed
- [ADDED] Raw IPv4 Targets + Probe-Only Mode
- [ADDED] BrowserBase Live Browser Sessions (View Page)
- [CHANGED] Dashboard: Scanners + Probes Split + Compact Controls
- [FIXED] Dashboard No Longer Crashes on an In-Progress Scan
- [ADDED] Deep-Linkable Findings: ?finding=<id> Selects a Specific Result
- [FIXED] AI Chat Could No Longer Send at Exactly the Character Limit
- [SECURITY] Two IDOR Hardenings Moved Into the SQL Itself
- [FIXED] Admin Account-Delete Could Throw on Its Own FK Constraints
- [FIXED] ApiResponse.forbidden Was Dropping Its meta Argument
- [SECURITY] CodeQL Sweep: SSRF Probes, Duplicate HTML-Stripping, a Host-Substring Bug
- [ADDED] Signed Releases: Cosign, SBOM, SHA256SUMS
- [FIXED] A Stale security.txt Was Silently Shadowing the Real One
- [ADDED] Test Suite: 168 Files, 5,696 Tests
- [FIXED] Scanner Registry: Check-ID Collisions Now Resolve by Category, Not Load Order
- [CHANGED] Scanner Engine Rework: Real Evidence, Fix Code, and References on Every Check
- [SECURITY] Seven Internal Security Audits, 83 Findings Closed
- [ADDED] Site-Wide AI Chat Widget
- [ADDED] AI-Assisted Finding Verification
- [FIXED] Scan Results: Danger Score and Engine Confidence on the Verdict Card
- [CHANGED] Landing Page: Real Counts, Real Sample Finding
- [SECURITY] 2FA: Inline QR Code, Password Gate on Setup, Fails Closed Without Encryption
- [CHANGED] Auth Pages: Split-Panel Layout
- [CHANGED] Billing: Stripe Elements Instead of Embedded Checkout
- [FIXED] Webhook Plan-Change Fallback Could Never Resolve a Real Plan
- [ADDED] Admin: Bigger Stats Dashboard, On-Demand Cleanup Trigger
- [FIXED] Extension Follow-Ups: Bearer-Token Auth, CSRF Exemption, Firefox Fixes
- [FIXED] Signup Was Broken in Production (2.3.1/2.3.2): scrypt Memory Limit
- [PERFORMANCE] Password Hashing Moved Off the Event Loop
- [ADDED] SEO: Sitemap, Robots.txt, and Per-Page Metadata
- [FIXED] Periodic Cleanup Moved In-Process, Actually Runs Every 5 Minutes
- [PERFORMANCE] Health Check Now Actually Checks the Database
- [CHANGED] Dependency Maintenance: ~30 Dependabot Bumps, 8 Security Alerts Cleared

---

## v2.3.1 - June 23, 2026
**Tooling Hardening, Node 22 LTS, Schema Version Gate**

- [CHANGED] Scripts Restructured Into Version-Aware Framework
- [SECURITY] Schema Version Gate at App Startup
- [FIXED] Migration DDL Now Matches instrumentation.ts Exactly
- [CHANGED] Migration Always Runs, Even On Same Version
- [CHANGED] Node 22 LTS Is the New Minimum
- [CHANGED] 75 npm Packages Bumped to Latest Within Major
- [CHANGED] .npmrc Auto-Approves Native Postinstalls
- [FIXED] Detection Engine v2.4.0: False-Positive Overhaul
- [ADDED] Scanner Detection Engine: 311 → 709 Checks, 12 Categories
- [ADDED] 9 New Protocols: SSH, SFTP, SMTP, SMTPS, IMAP, IMAPS, POP3, POP3S, MongoDB
- [CHANGED] Scanner Categories UX: New Icons + Total Count Bumped
- [SECURITY] stripe/setup-products: Now Requires Admin Session
- [SECURITY] scan/discover SSRF Closed (batchHttpCheck)
- [SECURITY] Discord OAuth Callback: No More PII in URL
- [SECURITY] lib/database/db-utils: SQLi in getUserById/updateUser/batchDelete/batchUpdate Closed
- [SECURITY] safeFetch: Non-Canonical IPv6 Bypass Closed
- [SECURITY] Discord OAuth State: Bound to userId, TTL 5min → 60s
- [SECURITY] Email 2FA Code Consumption: TOCTOU Closed
- [SECURITY] Login: Open-Redirect via ?redirect= Closed
- [FIXED] Stripe Webhook: Idempotent on Retries
- [SECURITY] Admin Notifications: action_url Scheme-Validated
- [SECURITY] Mass Email Preview: HTML Injection Closed
- [SECURITY] env.ts: Stricter Validation at Startup
- [PERFORMANCE] DB Pool: statement_timeout + query_timeout + application_name
- [CHANGED] Dockerfile: Node 20 → Node 22
- [CHANGED] Removed Unused bcrypt, Pinned Caret Deps
- [SECURITY] Database Cleanup: Single Transaction, Always-Released Client
- [ADDED] Test Count: 39 → 65

---

## v2.3.0 - June 20, 2026 **(highlights)**
**Comprehensive Security Patch & Quality Update**

- [SECURITY] Database SSL Now Enforces Certificate Validation
- [FIXED] Fixed: Resend-Verification Token Hashing Regression
- [FIXED] Fixed: 'Log Out All Sessions' Cleared the Wrong Cookie
- [SECURITY] Removed All Hardcoded Fallback Secrets
- [SECURITY] Zod-Validated Environment at Startup
- [SECURITY] IP Spoofing Fix (TRUSTED_PROXY_CIDR)
- [SECURITY] Avatar Upload Hardening (XSS Prevention)
- [SECURITY] Backup Codes Bumped to 80 Bits (NIST 800-63B)
- [SECURITY] Stripe Webhook No Longer Logs Customer Email
- [CHANGED] Icon-Only Buttons Get aria-label
- [CHANGED] Form Labels Now Bound to Inputs
- [CHANGED] ConfirmDialog Migrated to Radix AlertDialog
- [ADDED] Per-Route Error Boundaries + Loading States
- [SECURITY] Typecheck and npm audit Now Block Merges
- [CHANGED] SECURITY.md Updated to v2.4.x
- [ADDED] Test Infrastructure: vitest + 39 Tests
- [SECURITY] API Key Validation is Now O(1)
- [SECURITY] Stronger Password Hashing
- [SECURITY] Signed Discord OAuth State
- [SECURITY] Strong Device Trust Cookies
- [SECURITY] Re-authentication for Sensitive Changes
- [SECURITY] 2FA Rate Limit + Timing-Safe Compare
- [SECURITY] SSRF Re-Validation
- [SECURITY] Minimal Staff Endpoint
- [SECURITY] Email & Reset Tokens Hashed at Rest
- [SECURITY] No Email Bodies in Logs
- [SECURITY] Tightened Content Security Policy
- [SECURITY] 1 MiB Request Body Cap
- [SECURITY] Per-Email Forgot-Password Rate Limit
- [SECURITY] Data Exports Never Cached
- [FIXED] Correct Rate-Limit Headers
- [CHANGED] Stripe Lazy Accessor
- [CHANGED] Single Source of Truth for Constants
- [CHANGED] Plans & Products Consolidated
- [CHANGED] Admin Role Helpers Consolidated
- [CHANGED] Notifications Source of Truth
- [CHANGED] SSRF Helpers Consolidated
- [CHANGED] SCAN_PROTOCOLS Moved to Protocols Module
- [CHANGED] Client API Helpers Promoted

---

## v2.2.3 - April 9, 2026 **(highlights)**
**HTTPS Scanning Fix & Security Stabilization**

- [FIXED] HTTPS Scanning Fix
- [SECURITY] Protocol-Specific IP Handling
- [CHANGED] Billing Verification & Configuration
- [CHANGED] Middleware Stability
- [CHANGED] Code Quality Improvements

---

## v2.2.2 - April 7, 2026
**Security Hardening & Code Quality Improvements**

- [SECURITY] SSRF Vulnerability Fixes
- [SECURITY] Enhanced DNS Validation
- [ADDED] Fetch Timeout & Abort Control
- [SECURITY] Incomplete String Escaping Fix
- [FIXED] API Key Rate Limiting Fix
- [CHANGED] Code Quality Improvements
- [CHANGED] Error Logging Enhancement
- [CHANGED] Dependency Updates

---

## v2.2.1 - April 5, 2026
**Broadcast Messaging Hotfix**

- [FIXED] Broadcast Query Fix

---

## v2.2.0 - March 31, 2026 **(highlights)**
**Backend Optimization, API Enhancements & Security Hardening**

- [PERFORMANCE] Backend Performance Optimization
- [CHANGED] API Enhancements
- [CHANGED] UI/UX Improvements
- [SECURITY] SSRF Vulnerability Patches
- [SECURITY] Enhanced Password Hashing
- [SECURITY] Input Validation & Sanitization
- [SECURITY] Additional Security Fixes

---

## v2.1.2 - March 27, 2026
**Admin Panel UX Improvements, Gift Subscriptions & Support Role Fixes**

- [ADDED] Gift Subscription System
- [FIXED] Plan Name Formatting
- [FIXED] Support Role Badge Color
- [FIXED] Modal Z-Index Fixes
- [FIXED] Notifications Manager Modal Fix
- [ADDED] Premium Badge Auto-Award
- [ADDED] Update Plan/Name/Email API
- [CHANGED] Removed Disable Button from User List
- [CHANGED] All Actions Use Confirmation Modal

---

## v2.1.1 - March 23, 2026 **(highlights)**
**Profile UI Redesign, Email Notifications for Scans & API Key Security Enhancement**

- [CHANGED] Complete Profile/Settings Redesign
- [CHANGED] Sidebar Navigation Overhaul
- [CHANGED] Standardized Icon Styling
- [FIXED] Notification Card Spacing Fix
- [CHANGED] Removed Unnecessary Product Section
- [ADDED] Email Notifications for Scan Completion
- [ADDED] Critical Findings Alert Emails
- [ADDED] Scheduled Scan Email Templates
- [SECURITY] API Key Rotation Security Enhancement
- [FIXED] Scan Notification Key Mapping Fix
- [CHANGED] Profile Header Simplification
- [FIXED] Import Fix for CheckCircle2

---

## v2.1.0 - March 21, 2026 **(highlights)**
**Complete UI/UX Redesign, Support Actions System & Admin Dashboard Overhaul**

- [CHANGED] Complete UI/UX Redesign
- [CHANGED] Dashboard Component Revamp
- [CHANGED] History Page Modernization
- [CHANGED] Scan Results Pages Update
- [CHANGED] Compare Page Redesign
- [CHANGED] Shared & Shares Pages Revamp
- [CHANGED] Teams Page Complete Redesign
- [CHANGED] Badge Page Modernization
- [CHANGED] Profile Pages Restructure
- [CHANGED] Admin Panel Complete Overhaul
- [ADDED] Support Actions System
- [ADDED] Support Action Email Notifications
- [FIXED] Staff Role Unlimited Access Fix
- [FIXED] Severity Sorting Fix
- [CHANGED] Consistent Token Loading
- [CHANGED] Form & Modal Improvements
- [FIXED] Discord Device Trust Fix
- [CHANGED] Request Body Parsing Enhancement

---

## v2.0.5 - March 17, 2026 **(highlights)**
**API Rate Limiting Complete & Enhanced Legal Documentation**

- [ADDED] Complete API Rate Limiting
- [ADDED] API Usage Tracking
- [CHANGED] Dynamic Daily Limit per API Key
- [FIXED] Source Tracking Fix for Crawl/Bulk
- [ADDED] DELETE Handler for History
- [SECURITY] Terms Acceptance Enforcement on API
- [ADDED] Comprehensive History API Rate Limiting
- [CHANGED] Rate Limit Exemption for Discovery
- [CHANGED] Enhanced Accessibility Documentation
- [CHANGED] Improved Donate Page

---

## v2.0.4 - March 16, 2026 **(highlights)**
**Comprehensive Legal Overhaul & API Route Authentication Fix**

- [CHANGED] Legal Documents Overhaul
- [ADDED] CCPA/CPRA & State Privacy Compliance
- [ADDED] Terms Re-Acceptance System
- [ADDED] New Legal Pages
- [FIXED] API Route Authentication Fix
- [ADDED] Data Breach Notification Policy
- [ADDED] Contact Form Privacy Notice
- [ADDED] Enhanced Privacy Policy
- [ADDED] Security Tool Disclaimers
- [ADDED] Mass Scanning Prevention
- [FIXED] Public Legal Pages Accessibility
- [CHANGED] Footer Legal Links Reorganization
- [CHANGED] Accessibility Improvements
- [FIXED] Layout JSON Parse Fix

---

## v2.0.3 - March 15, 2026
**310+ Security Checks, Config System Overhaul & UI Improvements**

- [ADDED] 310+ Security Checks
- [CHANGED] Config System Overhaul
- [CHANGED] Updated Documentation
- [FIXED] Modal & Toast Scrolling
- [FIXED] Bulk Scan Helper Text

---

## v2.0.2 - March 14, 2026 **(highlights)**
**Badge page 500 error fixed**

- Bug Fix

---

## v2.0.1 - March 14, 2026
**Detection Engine v2.0.1, Subdomain Caching & Share Modal**

- [CHANGED] Detection Engine v2.0.1
- [ADDED] Subdomain Discovery Caching
- [ADDED] Custom Share Modal
- [CHANGED] Admin Notifications UI Overhaul
- [ADDED] Admin User Notes
- [CHANGED] Dynamic Version System
- [FIXED] Bug Fixes

---

## v2.0.0 - March 13, 2026
**Stripe Billing, Discord Integration, Admin Notifications & Design System Overhaul**

- [ADDED] Stripe Billing Integration
- [ADDED] Discord Account Linking
- [ADDED] Admin Notification System
- [CHANGED] Design System Overhaul
- [CHANGED] API v2 Migration
- [ADDED] Enhanced Database Schema
- [ADDED] Subscription-Gated Scanning
- [ADDED] Admin Notifications Manager
- [ADDED] Multi-Type Notification Display
- [ADDED] Discord Profile Modal
- [ADDED] Billing Dashboard
- [ADDED] Stripe Webhook Automation
- [ADDED] Staff Heartbeat System
- [ADDED] Notification Audience Targeting
- [ADDED] Scheduled Notifications
- [ADDED] Unique Cookie-Based Dismiss

---

## v1.9.5-patch.1 - March 9, 2026
**API v1 routes fixed**

- [FIXED] Middleware Routing Fix

---

## v1.9.5 - March 8, 2026
**API v1 Versioning, Developer SDK Support & Finding Types Endpoint**

- [CHANGED] API v1 Versioning
- [ADDED] New Finding Types Endpoint
- [ADDED] Developer Documentation
- [CHANGED] Updated API Documentation
- [CHANGED] Scanner Engine v2.0.0

---

## v1.9.4-patch.1 - February 28, 2026
**API Key Encryption Fix, Stronger Key Entropy & Validation Overhaul**

- [SECURITY] Fixed Encrypted Key Validation
- [SECURITY] Increased API Key Entropy
- [SECURITY] Longer Deprecated Placeholders
- [CHANGED] Decrypt-and-Compare Validation
- [CHANGED] Zero Breaking Changes

---

## v1.9.4 - February 27, 2026
**UI Consistency, Docker Build-Time Vars, Discord Giveaway & Encryption-First API Keys**

- [FIXED] Unified Landing & Dashboard Fonts
- [FIXED] Docker Build-Time Environment Variable Support
- [ADDED] Discord Giveaway Notification
- [SECURITY] Encryption-First API Key Storage
- [CHANGED] Hash-Based Fallback & Conditional Lookup

---

## v1.9.3 - February 25, 2026
**Admin Version Monitoring & Enhanced Admin Controls**

- [ADDED] Automatic Admin Version Monitoring
- [ADDED] Intelligent Notification Frequency
- [ADDED] Extended Admin Management Options
- [SECURITY] Enhanced Admin Page Security

---

## v1.9.2 - February 24, 2026
**Security Hardening, GDPR Compliance & Docker Production Overhaul**

- [SECURITY] Stricter Password Strength Calculator
- [SECURITY] AES-256-GCM API Key Encryption
- [ADDED] Expanded Fix Examples for 8 Security Checks
- [CHANGED] Docker Production Overhaul
- [ADDED] GDPR Compliance & Data Request Links
- [CHANGED] Privacy Policy Updates

---

## v1.9.1 - February 23, 2026
**ToS Modal & Header Fixes**

- [CHANGED] ToS modal wording
- [FIXED] Centralized Route & API Constants

---

## v1.9.0 - February 23, 2026
**Auth-Aware Public Pages, Codebase Refactor & Performance**

- [ADDED] Auth-Aware Public Pages
- [CHANGED] Centralized Route & API Constants
- [CHANGED] Role Badge Deduplication
- [PERFORMANCE] Dynamic Imports for Heavy Components
- [CHANGED] Auth Flow UI Standardization
- [CHANGED] Landing Page Refresh
- [CHANGED] Dead Code Removal
- [CHANGED] Accessibility Improvements
- [CHANGED] Semantic Navigation in PublicPageShell

---

## Earlier releases: one line each

- **v1.8.0** (February 21, 2026) Email 2FA, Expanded Notifications & 55+ New Security Checks: 9 changes (4 added, 2 fixed, 2 changed, 1 performance)
- **v1.7.4** (February 20, 2026) Docker Production Ready, Mobile UX Overhaul & Error Pages: 6 changes (3 added, 2 changed, 1 fixed)
- **v1.7.3** (February 19, 2026) Unified Footer, Contact Upgrades & Error Pages: 5 changes (3 added, 2 changed)
- **v1.7.2** (February 19, 2026) Self-Hosted Schema & Stability Fixes: 5 changes (5 fixed)
- **v1.7.1** (February 19, 2026) Migration Tool Improvements & Documentation Overhaul: 7 changes (3 added, 2 changed, 2 fixed)
- **v1.7.0** (February 18, 2026) Deep Crawl URL Selector, IP Rate-Limited Demo & Auto Scan Notes: 9 changes (4 changed, 3 added, 1 fixed, 1 security)
- **v1.6.8** (February 17, 2026) Metadata & Social Preview Fixes: 3 changes (3 fixed)
- **v1.6.7** (February 16, 2026) Scan Notes Visibility & Team Collaboration: 4 changes (2 added, 2 changed)
- **v1.6.6** (February 16, 2026) Subdomain Discovery Depth & Deep Scan Prefix: 2 changes (2 changed)
- **v1.6.5** (February 16, 2026) Scan Depth & Performance Improvements: 3 changes (2 changed, 1 performance)
- **v1.6.4** (February 16, 2026) Subdomain Discovery & Real-Time Progress: 3 changes (2 added, 1 changed)
- **v1.6.3** (February 16, 2026) Scanner Category Visualization: 2 changes (2 added)
- **v1.6.2** (February 15, 2026) Expanded Security Coverage: 2 changes (1 added, 1 changed)
- **v1.6.1** (February 15, 2026) Export & Sharing Enhancements: 2 changes (1 added, 1 changed)
- **v1.6.0** (February 15, 2026) Deep Crawl Scanning: 3 changes (3 added)
- **v1.5.0** (February 14, 2026) Scheduled Scanning & Bulk Operations: 3 changes (3 added)
- **v1.4.0** (February 14, 2026) Team Collaboration: 3 changes (3 added)
- **v1.3.0** (February 11, 2026) API Access & Webhooks: 3 changes (3 added)
- **v1.2.0** (February 10, 2026) Comparison & History: 3 changes (3 added)
- **v1.1.2** (February 10, 2026) Safety Rating Indicator: 2 changes (2 added)
- **v1.1.1** (February 10, 2026) Metadata & Branding Polish: 3 changes (2 changed, 1 security)
- **v1.1.0** (February 10, 2026) Contact System & UI Enhancements: 8 changes (4 added, 2 changed, 1 security, 1 performance)
- **v1.0.0** (February 9, 2026) First Release: 14 changes (14 added)

---

## Quick reference

- **Total releases:** 73
- **Total changes documented:** 975
- **Latest:** v4.0.0 (Unreleased) - The Things That Were Written Down Twice
- **Earliest:** v1.0.0 (February 9, 2026) - First Release
