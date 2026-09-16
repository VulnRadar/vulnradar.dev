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
  Every change to VulnRadar is now checked by scanning our own site, all 871 of its pages, with the same scanner customers use. If that scan finds a real problem, the change is stopped until it is fixed. Three known, harmless items are allowed through: two notes about a styling choice we made deliberately, and the description of our own API, which we publish on purpose. Everything else must come back clean, and the scanner is given no special treatment for being pointed at our own site.
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
  An outdated code library, such as an old jQuery, used to be reported as up to six separate findings, with anything past the fifth silently dropped. It is now one finding, listing every issue worst first and naming the one upgrade that fixes them all. The backup list used when the outside database is unreachable had its own problems: some versions were wrongly cleared, others blamed for issues already fixed, and every issue was rated high regardless of severity. The two systems that detect a site's libraries have also been merged into one fuller list.
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
- [Lock] **[ENGINE]** **Fewer Repeated Requests to Your Site**
  Checking your site's security certificate used to involve four separate connections to your server, one per certificate-related check. If your site sits behind a service that can route different connections to different servers, the four checks could see four different certificates, and the report then described several at once. They now share a single connection, so every certificate finding describes the certificate your visitors actually see. The check that deliberately tests old, insecure connection versions still connects separately, since it must offer only those versions. Three other checks that each downloaded your page again, to look for outdated code libraries, open storage buckets and a reused security code, now share a single download as well.
- [Filter] **[ENGINE]** **Five Page Checks Stop Flagging Ordinary Pages**
  Five checks were producing false alarms on ordinary pages: a source-code download link was flagged as an exposed sensitive file; a field was flagged just because its name contained letters like "tax", like a checkout page's tax rate, and now needs a real card, ID or tax number filled in; a common code-loading technique was mistaken for a riskier one; an article merely mentioning a debugging address, without linking to it, was wrongly flagged; and an insecure setting was marked high severity even where nothing changed. All five now need real evidence before reporting a problem.
- [ShieldCheck] **[SECURITY]** **A Page Designed to Freeze the Scanner No Longer Can**
  Before reading a page, the scanner first checks whether it is looking at a real web page at all. A page could be deliberately built to make that first check run almost forever, and while it did, every other scan running on the same server had to wait behind it. The check now takes an amount of time based only on the size of the page, not what is in it. A similar slowdown in the admin tool that converts a broadcast email into plain text was fixed the same way. Both were caught by automated security scanning of our own code.
- [ShieldAlert] **[ENGINE]** **A Security Code That Never Changes Is Reported**
  Some sites protect their pages with a one-time code, called a nonce, that tells the browser which scripts are genuine. It only works if the code is new on every visit. When it stays the same, for example because a page was cached with it, anyone can read it and use it to slip their own script in. The scanner now loads such a page twice and reports a code that did not change, without printing the code itself.
- [Wrench] **[ADMIN]** **Grant Credits From the Admin Panel**
  Staff can now see a user's AI, GitHub review and browser session credit balances in the admin panel and add credits directly, for example to make up for a problem, without touching the database. Each grant needs a reason and the staff member's own password, is recorded in the audit log, has a sensible maximum, and staff cannot grant credits to their own account. Only admins and the billing role can do this.
- [ShieldAlert] **[API]** **A Misspelled Check Name No Longer Gives a Clean Result**
  When a scan is started from the API, the command-line tool or a pipeline, it can be limited to certain kinds of checks by name. A misspelled name used to match nothing, so the scan quietly ran no checks at all and reported no problems, which looked exactly like a clean site. A name the scanner does not recognise is now refused straight away, with the list of names it does accept.
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
  Fifty checks had already been switched off in earlier releases for good reasons: duplicates, tests for things browsers no longer use, or a key meant to be public. Three more were listed but never built. All still counted toward our advertised total number of checks and had their own page in our checks catalogue, despite reporting nothing. They are now removed, and the advertised total moves from 905+ to 855+, the number a scan actually runs. A further 111 pieces of detection code that could never run at all were also deleted, and this is now tested automatically so it cannot happen again.
- [Trash2] **[REMOVED]** **Removed Code That Nothing Used**
  About 260 lines of unused code were removed after checking that nothing in the app, its scripts, background workers or tests actually used them. This included a second, weaker copy of an internal helper function that was easy to accidentally use by mistake instead of the real one, and a helper that had been marked for removal five months earlier but still had a few callers, which now use the proper replacement instead. This is internal cleanup with no visible effect on how the product works.
- [ShieldAlert] **[CHANGED]** **Engine Version 3.4.0**
  The detection engine that powers every scan moves to version 3.4.0. Scan results may change for reasons described elsewhere in this update: pages are read the way a browser uses them, error pages are matched more accurately, two new certificate problems are reported, and checks that could never find anything are removed. Identifying codes for existing findings are unchanged, so your previous notes and automated rules still apply, with one exception: the outdated-library check now reports one finding per library instead of one per advisory, so those findings get new codes this one time.
- [Gauge] **[CHANGED]** **Four Findings Lowered to Low Severity**
  Four findings are now reported as low severity instead of medium, since each only shows a condition exists, not that it is exploitable: a wide-open cross-site sharing setting, which browsers already refuse to send sign-in details to anyway, published API documentation, an unusual network method being allowed, and a text-matching guess that a data-query feature might allow unauthorised access. Where the scanner can confirm the serious version, or probes the network method directly, it keeps medium severity. A pipeline set to fail on any medium finding will no longer trip on these four alone.
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

## v3.9.0 - September 8, 2026 **(highlights)**
**Things That Fail Without Saying So**

Ninety-eight changes, and the thread running through nearly all of them is the same: something that failed without saying so. An alert that marked itself as sent before trying, and so went quiet for the rest of the outage. A weekly email that could arrive every six hours. A scan that answered with a full report it had never saved. Workers that recorded a healthy pass when every item in it had failed. A daily limit that stopped applying the moment the database struggled, and a scan that reported four sections as clear without running them. Seventeen of the entries are security: a share link that republished the address somebody else had typed, complete with the token in it; impersonation that could change an account's email and password and leave no trace; subscription events keyed on the customer rather than the subscription, so an abandoned plan could cancel a live one; and a data export that promised everything it held on you and named a third of it. The admin panel had a header that let rows paint through it, placeholders that drew a different shape from the thing arriving, and roles that could not use the permissions they were given. Every contact link on the site went to an error page, and the fix was to stop putting addresses in the page at all. Along the way the scanner learned fourteen new checks, our own accounts got short links on our own domain, and verified domains got a page of their own.

### Changes
- [Bot] **[FIXED]** **The Chat Answer Arrived All At Once**
  The AI assistant normally types its answer out gradually as it writes, but for anyone self-hosting VulnRadar behind their own reverse proxy, a common way to run a website, the proxy was holding the whole reply back and releasing it in one lump once the assistant had finished. It looked like the assistant had frozen for twenty seconds and then pasted a finished answer. The reply now tells the proxy not to hold it back, so self-hosted setups stream properly with no extra configuration needed.
- [Crosshair] **[FIXED]** **A Heading That Changed Size While You Watched**
  The email verification page shows a loading message and then swaps to a result: verified, expired, already verified, or failed. The loading heading was a different size to the result headings, so on a phone the text visibly grew or shrank the moment the answer arrived, on an otherwise still screen. The heading now stays the same size throughout. The staff invitation page had copied the same mistake and was fixed too.
- [Layers] **[FIXED]** **Four Pages Had Each Built The Same Error Box**
  Several pages, Assets, History, Repos and Shares, had each built their own slightly different error message for when a list fails to load, instead of sharing one, and announced it to screen readers inconsistently. They now share a single, consistent, properly announced error message. Also fixed: a too-small show or hide password button on several forms, a few badges and buttons using colours that clashed with the app's light or dark theme, and an admin error screen that had drifted from the shared design.
- [Shield] **[SECURITY]** **A Production Backup Was Being Copied Into Every Build**
  A configuration file meant to exclude sensitive files from the build process was excluding a folder that does not exist instead of the one that actually holds backups. As a result, an encrypted production database backup, the file holding its decryption details, and a large source archive were being pulled into every release build. None of this reached the software actually published to users, since only specifically listed files make it into the final release, but it should never have been included at all. The setup is now fixed in both places it needed to be.
- [Eye] **[ADDED]** **Automatic Checks Against Two Kinds Of Data Leaks**
  Our own documentation and source code have twice accidentally included information that should not have been public: a real server address left in an example configuration for several releases, a minor risk since the address itself held nothing sensitive, and separately, backup database files that ended up somewhere they should not have. Automatic checks now scan our documentation for real-looking addresses and passwords, and scan the codebase for anything shaped like a database backup, catching both kinds of mistake before they can happen again.
- [Settings] **[FIXED]** **A Few Small Inconsistencies Fixed Across The App**
  Several small inconsistencies were cleaned up. Scan tags had three different maximum lengths enforced in different places, so a suggested tag could pass one check and then fail to save. The same severity level showed as Info in one place and Informational in another for the same finding. A list of publicly accessible pages was written out by hand rather than generated automatically, which risked accidentally locking visitors out of pages that should stay public the next time the product's version number changes. All of these are now fixed.
- [UserCog] **[ADDED]** **Who Blocked This Domain**
  Domain owners can now switch scanning off for their own domain, using the same list staff use to block domains during an incident. Previously the admin list did not show who created a block, so there was no way to tell whether a domain had been blocked by our staff or opted out by its own owner, or who to ask before removing the block. The list now shows who blocked each domain, and still shows that information even if the staff member who did it has since left.
- [Container] **[CHANGED]** **Reverse Proxy Setup Mistakes That Give No Error**
  For anyone self-hosting VulnRadar behind a reverse proxy, the layer in front of the server that routes web traffic, the setup guide now documents four silent mistakes: a duplicated header, an unnecessary setting removed since the product does not need it, a default one-minute time limit that can cut off a long AI check the app cannot control, and a proxy setup that can leave the server reachable directly from the internet. Two errors in the guide itself were also corrected.
- [CreditCard] **[FIXED]** **Every Payment Record Was Storing A Blank Reference**
  Our payment processor changed how it structures some of its data, and a coding flaw let this slip through unnoticed, so every payment recorded since then was missing the reference number that links it back to the processor. Nothing looked broken to customers, but it meant a refund or a lookup in our admin tools had no way to trace back to the original transaction. This is now fixed, with a safeguard against the same kind of silent failure happening again. A related bug could also have shown a successful subscription cancellation as failed; that is fixed too.
- [Puzzle] **[FIXED]** **Report Export Was Broken In The Chrome Extension**
  In the Chrome version of the browser extension, exporting a scan report as a PDF, SARIF, Markdown or JSON file failed immediately, due to a Chrome-specific coding mistake; Firefox was unaffected. Four related bugs were fixed alongside it: clicking a scan in Recent Scans opened the wrong page, opening the extension's popup could use up a daily scan allowance for no reason, turning every check category off actually ran every category instead of none, and an unfinished scan was shown as clean rather than incomplete.
- [Keyboard] **[FIXED]** **The Command Line Tool's Data Output Was Broken**
  VulnRadar's command-line tool can print results in a structured format meant for other programs to read automatically, but ordinary status messages were being mixed in with that data, so anything reading it would fail. Status messages are now kept separate from the structured output. Several confusing error messages when using the wrong combination of options were also cleaned up, and the tool no longer accepts a wait time of zero, which used to report a timeout without checking anything.
- [Database] **[FIXED]** **Database Updates Could Run Without A Backup**
  Before applying a database update, VulnRadar first tries to take a backup. On certain hosting setups, that backup step could fail quietly and the update would proceed anyway, including changes that permanently alter or remove data, with no backup to fall back on. There is now always a working backup method available, so an update can no longer proceed without one. Two related repair scripts that could wrongly report success even though they had failed, or had not run at all, were also fixed.
- [CheckCheck] **[FIXED]** **A Safeguard For Our Own Testing Process**
  This is an internal fix with no direct effect on how VulnRadar works for you. Our automated testing system has a safeguard that catches cases where test files are accidentally skipped during a run, but that safeguard itself could theoretically be silently disabled by a future update to the testing tools we rely on. It is now anchored more reliably, so it cannot quietly stop working without being noticed.
- [Mail] **[CHANGED]** **The Emails Were White**
  Every email VulnRadar sends, like scan alerts and account notices, used to render as a plain white card, even though the product itself uses a dark theme everywhere else, so emails looked like they came from a different company. Emails are now dark to match the rest of the product, with extra care taken so email apps like Gmail, Apple Mail and Outlook.com display the dark colours correctly instead of auto-inverting or overriding them.
- [Radar] **[FIXED]** **One DNS Security Fact, Reported Once**
  A domain that had simply never turned on DNSSEC, an extra layer of protection against forged DNS answers, used to get three separate findings repeating the same underlying fact, burying the one plain-language note under two more alarming-looking ones. Checks are now precise: no DNSSEC gets one clear note, and a half-finished DNSSEC setup, which can make a domain unreachable for some visitors while looking fine to its owner, now gets its own specific warning instead of being lumped in.
- [ShieldCheck] **[FIXED]** **Four Security Headers That Were Not Real Findings**
  Four checks used to flag things that were not real problems. A missing Referrer-Policy header was flagged as leaking page addresses, but browsers have prevented that by default since 2020 regardless of the header. Another flagged header re-enables an old browser protection that has since been removed for having its own security bugs. Two more protected things that no longer matter: a discontinued browser plug-in, and a setting that only works somewhere else. All four are gone from reports now, so scans produce fewer irrelevant warnings.
- [Bug] **[FIXED]** **A Security Check Was Looking For The Wrong Thing**
  A check for cross-site scripting, a common attack where malicious code runs in a visitor's browser, was flagging a harmless, twenty-year-old coding pattern that appears on a huge share of websites and does nothing dangerous, wrongly scoring those sites as high risk. A correctly written version of the same check existed but was never actually the one running, due to a mix-up. The correct version now runs, and only flags this pattern when it is genuinely being used to read cookies or page data.
- [FileSearch] **[FIXED]** **Several Checks Were Flagging Ordinary Text**
  Several checks were flagging things that were not real problems, because they searched for certain words anywhere on the page instead of checking how they were used: an article mentioning a weak encryption method scored worse than a page using it, and a harmless phrase like password reset form triggered a warning meant for exposed secrets. A separate check meant to catch missing input validation had never once correctly fired, because its search terms also matched common, unrelated code, so it always wrongly assumed validation was present. All of these now look for the real thing.
- [AlertTriangle] **[FIXED]** **An Outdated Vulnerability Flagged On Every Grafana Scan**
  A check that detects the Grafana dashboard tool used to cite a serious, publicly known vulnerability from 2021 on every site running Grafana, regardless of version, even though that vulnerability was fixed years ago in current versions. A fully up-to-date, current Grafana installation was being told it had a critical flaw it was never exposed to, the kind of wrong result that makes a report harder to trust. The check now compares the actual version found against the versions that were genuinely affected before citing the vulnerability.
- [MessageSquare] **[SECURITY]** **Anyone Could Rewrite Someone Else's Chat History**
  The support chat widget saves each conversation under an identifier chosen by your browser, but saving had no check confirming you actually owned that conversation. Anyone who learned another person's conversation identifier could overwrite their chat history with their own messages, which would still appear to be from that person, including to support staff reviewing it. Saving is now restricted to the account that owns the conversation, while still letting someone who starts chatting before signing in keep that conversation once they log in.
- [Users] **[FIXED]** **Plan Limits That Two Clicks Could Get Around**
  Creating an API key, a webhook, a team, or a team invitation checked your plan's limit and then saved the new item as a separate step. Two such requests sent at nearly the same moment could both pass the check before either was saved, letting an account end up over its plan's limit with nothing catching it afterwards. The limit is now enforced at the moment of saving, not just checked beforehand. A related issue, where clicking the same team invitation link twice showed a generic error instead of you already accepted this, was fixed too.
- [MailOpen] **[ADDED]** **Announcement Emails Used To Start From A Blank Box**
  Emails VulnRadar sends automatically, like scan alerts, are built from carefully reviewed templates. Emails written by a person, like announcements to every registered user, were not: the tool for writing them was just an empty box, so what reached your inbox depended entirely on whoever wrote it that day. There are now seven ready-made templates for common announcements, and each one automatically limits who receives it based on their notification preferences, so an announcement only reaches people who actually opted in to that type of email.
- [ShieldAlert] **[SECURITY]** **A Security Gap In New Announcement Email Templates**
  While building the new announcement email templates described above, a security gap was found: two of the templates let the person writing the email choose the text on a button, and that text was not being safely handled before being placed into the email's underlying code, meaning specially crafted text could have injected unwanted content into an email sent to every registered user. This was caught by a newly written test before it caused any actual problem. The text is now safely handled, and any link a writer chooses is restricted to a valid web address.
- [ScanSearch] **[ADDED]** **Fourteen New Security Checks Added**
  Fourteen new checks were added, focused on real problems rather than box-ticking. Several check whether a site's script-blocking policy actually works rather than just existing on paper, including a security setting left as an unfilled placeholder. Others catch credentials accidentally exposed on a page, such as temporary cloud storage access links and passwords typed into a web address, a caching mistake that could hand one visitor's login session to another, and exposed configuration or status files that reveal more than they should.
- [FileSearch] **[ADDED]** **A Security Contact File Check Now Actually Checks It**
  Many sites publish a security.txt file that tells researchers who to contact if they find a vulnerability, and it is meant to include an expiry date so the contact details do not go stale. The check for this file only confirmed it existed, without checking whether it had actually expired, so a years-old, outdated contact file passed silently. It now checks for both a missing file and an expired one, and a few outdated-library detection rules were also improved, including one that could mistake an unrelated library for a well-known one because of a similar name.
- [Radar] **[FIXED]** **VulnRadar Scanned By VulnRadar**
  Our own documentation pages, which explain each check with example vulnerable code, were failing our own scan, because of a bug affecting any site with a documentation page: simply writing about a vulnerability, for example naming a risky function, could make the scanner think the page was actually using it. Separately, a rule meant to quiet warnings on API documentation pages was too broad, silently switching off checks for leaked secrets, including a critical one, on almost any page with a few common words, so a genuinely leaked key there would never have been reported. Both are fixed.
- [Globe] **[ADDED]** **Links To Other Security Tools Added To Reports**
  Scan results now include links to fourteen other security and reputation services for the same site: whether anyone has flagged it as malicious, what else is hosted alongside it, and independent tools that run their own grading tests. These are plain links, not automatic lookups, which would mean paying to check other people's sites and sending them to a third party without their knowledge. Links to services that visit the site themselves are marked, since clicking one leaves a trace in that service's logs, and none appear at all for a private or internal address.
- [ShieldAlert] **[SECURITY]** **An Admin Safety Check That Could Be Bypassed**
  Deleting an account permanently in the admin panel is meant to always require re-entering the administrator's password, as a safeguard against a stolen admin session. The check only recognised one of three ways the delete could be triggered, so a stolen session could delete an account another way without ever being asked for the password. This is fixed. Two related gaps were closed too: enabling two-factor authentication used to leave existing sessions active instead of ending them, and an access key created from a stolen session kept working even after a password reset.
- [Eye] **[SECURITY]** **Support Staff Could Read Every Customer's Webhook Secrets**
  Webhooks let VulnRadar notify another service automatically, like a Slack or Discord channel, and the address it posts to is itself a secret: anyone holding it can post into that channel. Opening a customer's account in the admin panel showed those addresses in full to any staff member with basic account access, even our lowest support tier with no ability to change anything, so a broad group of staff could collect every customer's webhook secrets just by browsing the user list. The panel now shows only which service each webhook points to, not the full address.
- [Lock] **[SECURITY]** **The Lockout Message Told You Whether An Account Existed**
  Everything about signing in is deliberately designed to never confirm whether a given email address has an account with us, since that information is useful to an attacker building a target list. One place broke that rule: the message shown after too many failed login attempts only appeared for an email that really did have an account, so repeatedly guessing wrong passwords was a reliable way to find out if an address was registered. This is fixed: the same message and behaviour now appears regardless, giving nothing away either way.
- [CreditCard] **[FIXED]** **Two Ways To Pay Us And Get Nothing**
  Buying add-on credits, for extra code review or browser scanning minutes, was confirmed in your browser, with a backup meant to catch a dropped connection before that confirmation completed. That backup did not actually work for two of the three credit types, so a dropped connection at the wrong moment could charge you with no credits added and no record of it. This is fixed. Separately, two features meant to be free were mistakenly charging your paid balance by default, including one that runs automatically with nothing on screen showing it happened. Both now default to not charging.
- [Database] **[FIXED]** **A Database Backup Could Restore With Duplicate Rows**
  The tool that produces a full database backup had a subtle bug in how it paged through large tables, which could cause it to skip some rows entirely and duplicate others, without any error appearing during the backup itself. The problem only became visible later, when someone tried to restore that backup and it failed because of the duplicated rows, which looks like a restore problem rather than what it actually was: a broken backup. This is now fixed, and backups produced going forward are reliable again.
- [Timer] **[FIXED]** **A New Security Check Could Freeze On A Bad Page**
  One of the credential-detection checks added earlier the same day had a coding pattern that could take an extremely long time to process on a page constructed in a particular way, nine seconds on a small test page. Since VulnRadar scans pages chosen by whoever submits a scan, a page crafted specifically to trigger this could have tied up server resources on demand. This was caught and fixed the same day: the check now runs quickly on any input, and an automated safeguard tests every new check against a batch of deliberately awkward pages before it ships.
- [Puzzle] **[FIXED]** **Turning On Every Check In The Extension Disabled One**
  In the browser extension, ticking every single check category in Options actually switched off Active Probing, one specific check type, due to a mismatch in how everything selected was read by the scanning engine. The settings screen showed everything on, Active Probing included, but it silently never ran. This is fixed. Two related bugs were fixed too: the extension's popup could get stuck on a loading spinner forever after a scan technically succeeded, and pasting an invalid or revoked API key could still show as Connected with no indication it had been rejected.
- [Timer] **[FIXED]** **Fixing The Command Line Tool's Timeout Handling**
  VulnRadar's command-line tool, often used in automated build pipelines, had a timeout setting that did not actually work: a request that was accepted but never answered could hang indefinitely, forcing the whole automated job to be killed externally. At the same time it gave up too quickly in the other direction, failing an entire run after a single temporary network hiccup, even though the scan itself was completing successfully. Temporary failures are now retried automatically, while genuine errors like a wrong access key still fail immediately.
- [GitMerge] **[FIXED]** **A Build Check That Could Have Shipped A Broken Extension**
  This is a fix to how we build and test the browser extension internally, with no direct impact on what shipped to users. The command used to package the extension for release was broken, but our automated checks were not actually testing that command, so this could have gone unnoticed until an attempted release failed or shipped stale content. The checks now test the real packaging step, and the extension's own test suite, previously not running anywhere at all due to a separate setup mistake, is now included too.
- [List] **[FIXED]** **Scan History Was Capped At One Hundred Scans**
  Your scan history only ever loaded the hundred most recent scans, so anyone with more than that could not reach their older scans at all, no matter how they searched or filtered. There is now a button to load more, so history keeps growing as you use it. Two smaller bugs were fixed alongside: changing your email address always failed because the form never actually asked for the password it has always required, and two scan options, screenshot and port checks, appeared selected on a sign-in scan but were silently ignored, since that scan type does not support them.
- [ShieldAlert] **[SECURITY]** **A Tiny Page Could Freeze The Whole Server**
  Three of the patterns our scanner uses to search page content had a flaw that could make them take an extremely long time on a specifically crafted page, in the worst case thirty-eight seconds for a page of only a few dozen meaningful bytes, and this needed no account to trigger. Because the check ran as one uninterruptible step, this could stall the server for every other user at the same time, not just the person who triggered it. All three are now fast regardless of the page's content, and a safeguard now checks for the same weakness elsewhere in the scanner.
- [ShieldAlert] **[SECURITY]** **A Block Button That Blocked Nobody**
  In the security alerts panel, a button offered to block the account an alert was raised against, but clicking it only recorded a label saying the account had been blocked, without actually blocking it or ending its sessions. The audit log then showed the account as blocked, so anyone reviewing the incident later would wrongly believe it had been handled. The button now genuinely blocks the account, and the log only records that once it has happened. A related mix-up, where one moderator action also revoked a customer's API keys under a permission only meant to end sessions, was fixed too.
- [UserCog] **[FIXED]** **The Admin Panel Asked For A Password And Then Said No**
  Several action buttons on the admin user page did not check whether a staff member's role actually allowed that action, so a lower-permission staff member could type in their password to confirm something, only to be told afterwards they were not allowed to do it, undermining the whole point of asking for a password. Permission checks now live in one shared place, so a button and what the server allows can no longer disagree. A couple of related display bugs, where one failed section could take down an entire admin tab or wrongly claim a feature was unavailable, were fixed too.
- [ShieldAlert] **[FIXED]** **A Timed-Out Scan Said Three Checks Came Back Clean**
  When part of a scan runs out of time before finishing, the report is supposed to mark whichever sections did not complete so they do not look like a clean result they never actually earned. That marking only covered three of the six sections that could be cut short, so the other three, including Active Probing, one of the more thorough and slower checks, would be reported as having run and found nothing, when really they never ran at all. All sections that were cut short are now correctly marked as incomplete rather than clean.
- [Eye] **[SECURITY]** **A Public Page Could Publish The Link You Actually Scanned**
  Public scan report pages, which need no account to view, were including your scan's full internal data rather than just the specific fields meant to be shown. One of those extra fields records the original address you typed in before any redirect happened, so if you scanned a link that redirects, like an invitation or password reset link, the original link, including any private token in it, could end up published on a page anyone can view. This is fixed: the public page now only ever includes a specific, intended list of fields, closing this gap.
- [Gauge] **[FIXED]** **The Daily Scan Limit Failed Open During Database Trouble**
  Checking how many scans you had already used today was meant to compare that count against your plan's daily limit, but if the database had trouble answering, the system treated the error as zero scans used, meaning the daily limit stopped being enforced during any database slowdown, for every kind of scan. This now fails the other way: if the count cannot be confirmed, the scan is blocked with an honest error instead of silently being let through. On the billing page, an unreadable count now shows as nothing rather than a misleading zero.
- [BellRing] **[FIXED]** **The Alarm Switched Itself Off At The Moment It Went Off**
  This is an internal reliability fix. Our background systems are monitored so that a repeated failure triggers an alert to our team, but the alert was being marked as sent before actually confirming it went through, and a failed delivery, for example a broken notification link, was never noticed or retried. So if the very first alert attempt failed, our team could go the rest of an outage with no further warning. Alerts now only count as sent once delivery is confirmed, so a failed one keeps trying, which helps us catch and fix problems faster.
- [MailOpen] **[FIXED]** **The Weekly Summary Could Arrive Every Six Hours**
  The weekly security summary records that it was sent in a separate step after actually sending it, so anything going wrong between those two steps left your account still marked as due. Since the job that sends these runs several times a day, the same weekly summary could go out again on the next run, and again, instead of only once a week. The record is now made before the email is sent, as one combined step that also double-checks you are genuinely due, so a failure now costs one skipped week at worst rather than repeated duplicates.
- [Database] **[FIXED]** **A Scan That Was Never Saved Still Showed You A Report**
  If a signed-in scan failed to save to your history, it still completed and showed you the full report as normal, but with no record behind it, and that silently skipped everything depending on a saved scan: auto-tagging, the scan-complete email, critical-findings alerts, and any webhook notifications you had configured. If you had an integration listening for scan results, it would have received nothing, with no indication anything had gone wrong. The response now clearly states whether the scan was actually saved, and explains why when it was not.
- [FileDown] **[FIXED]** **Download My Data Left Out Two Thirds Of Your Data**
  The download my data export is meant to gather everything we hold about your account, but it had fallen behind: it only pulled from 25 of the 65 places in our database that can hold your information, missing categories added over the following two years, including your support conversations, credit purchases, verified domains, and usage records. All of that is now included, and the export now explains what is deliberately left out and why, such as active password-reset links, since returning a working credential in a downloadable file would be a security risk, not a privacy benefit.
- [Trash2] **[SECURITY]** **Deleted Accounts' Messages Could Live On A Shared Ticket**
  Deleting your account is meant to remove or anonymise everything you wrote, which had already been fixed once for notes on individual scan findings. The same gap was still open for support tickets: a ticket you opened yourself is deleted with your account, but a reply you wrote on someone else's shared ticket was not, so your message and name could remain visible on their ticket after your account no longer existed. This is now fixed, along with an automated check that catches this kind of gap for any new database field added in future.
- [Share2] **[ADDED]** **A Way To Follow Along, Once, Without Being Asked Twice**
  The landing page now has a gentle invitation to follow the project on social media, deliberately built to be as unobtrusive as possible: it is not a pop-up that blocks the page, it only appears once you have scrolled partway down, it can be dismissed with the Escape key, and it does not animate if your device is set to reduce motion. Once you dismiss it, it will not appear again on that browser. A self-hosted copy with no social accounts configured shows nothing at all.
- [Share2] **[SECURITY]** **A Shared Report Published More Than The Report**
  A shared scan report link was returning the scan's entire internal data record instead of just the fields an actual report needs. Most of that was harmless, but not all: when a scanned page redirects, we keep the originally typed address so the report can note it. Combined with a site badge that tracks whoever scanned a URL most recently, that could have republished a link somebody else had typed, including a private token in an invitation or password-reset link. The response is now built from a specific, named list of fields, closing this gap.
- [BarChart3] **[SECURITY]** **A Site Score Chart Had No Limit On Repeated Loads**
  The chart on a site's page that shows its risk score over time had to search through every public scan we hold, rather than looking it up directly, which made it slow to run and easy to overuse. A similar page nearby already limited how often one visitor could load it, but this chart never had that limit, so anyone could hit it repeatedly and strain our busiest database. It now has its own separate limit, so viewing a site's page once only uses up one allowance, not two.
- [ShieldCheck] **[FIXED]** **Badges Did Not Load Outside GitHub**
  Every page and image we send includes a setting that stops browsers loading it on another website, which is right for normal pages but wrong for a badge, which exists to be embedded elsewhere. Badges kept working on GitHub because GitHub loads images through its own servers rather than showing them directly, so the one place everyone tested was the one place unaffected. Pasted onto your own site, a badge simply would not appear. Badge images can now be loaded anywhere. The two badge features that need you to be signed in still cannot be, to protect your account.
- [Link2] **[FIXED]** **Revoked Share Links Kept Showing Old Previews In Chat**
  When you paste a report link into Slack or Discord, those apps show a preview card with the site name and number of findings. We told them to store that preview for a year without checking again, so revoking the link stopped the report itself immediately, but the preview card kept showing the old information anywhere it had already appeared. A card for a site's report had the same issue after the scan behind it was made private. Both now expire after five minutes, which is still long enough to cover the burst of previews right after a link is pasted.
- [Eye] **[SECURITY]** **The Demo Scanner Returned A Site's Own Login Data**
  When a scan result is saved, we remove any login information and cookies from the response before storing it, since a saved record can be looked at long after the scan finishes. The free demo scanner, the only one you can run without an account, skipped that step and showed the target site's session cookies and login headers exactly as it received them. It now removes the same information as every other scan. The security checks themselves still read the real data while scanning, so what the scanner detects has not changed.
- [Webhook] **[ADDED]** **Webhook Secret Rotation And History Are Now On The Website**
  Webhooks let VulnRadar notify another system, like Slack or your own server, when something happens on your account. Two features already existed in our API but needed code to use: replacing a webhook's secret code, and viewing what was actually sent and received. Both are now buttons on the Webhooks page. History shows recent delivery attempts, including ones that got no response. Replacing the secret code asks you to confirm first, since it takes effect immediately, and shows the new code once; afterwards it is stored encrypted and cannot be shown again.
- [Timer] **[FIXED]** **Stuck Scans Now Clear Automatically, Not Only At Restart**
  A background task clears out scans that got stuck partway through, but it only ran when our server restarted, so a scan that got stuck at any other time stayed stuck until the next update. While it sat there, it still counted against the number of scans you are allowed to run at once, so a single stuck scan could quietly cost you a slot for days. This task now also runs every five minutes, not just at startup, and it still waits well past any scan's normal time limit before touching anything, so a scan that is genuinely still working is never cut short.
- [CalendarClock] **[FIXED]** **A Failed Scheduled Scan Could Block A Slot Forever**
  If a scheduled scan was created but something went wrong just before it actually started, nothing ever closed it out properly. It sat on your dashboard as a scan that never finishes, and it held one of your allowed concurrent scan slots until the server was restarted. Every other type of scan already handled this correctly; scheduled scans were the exception. Such a scan is now marked as failed with the real reason, so your slot is freed immediately and you can see what went wrong.
- [RefreshCw] **[FIXED]** **Scheduled Scans Could Run And Charge You Twice**
  When a lot of scheduled scans came due at once, we processed them in small batches, but the lock that stops a schedule being picked up twice was only held long enough for one scan, not the whole batch. Schedules near the back of a large batch had that lock expire while still waiting, so they ran again, scanned the site twice, and used two scans from your daily allowance instead of one. The lock is now extended as the batch works through, and its length is based on your actual scan time limit rather than a fixed fifteen minutes, so raising that limit cannot bring the problem back.
- [BellRing] **[FIXED]** **Two Background Checks Reported Healthy When They Weren't**
  Two automatic background jobs, domain re-verification and the weekly security summary, are meant to raise an alert after a run of failures. Both counted a run as successful as long as it did not crash outright, even when every item inside it failed, because each one quietly catches its own errors and moves on. A completely broken run therefore looked identical to a healthy one, the failure counter never increased, and the alert built for exactly this situation could never fire. A run that had work to do and finished none of it now correctly counts as a failure.
- [Database] **[FIXED]** **Automatic Backups Could Silently Stop Working**
  Only one backup can run at a time, but the lock holding that slot was not released if the backup process failed to start at all, as opposed to failing partway through. Every backup after that, whether scheduled or started by hand, was then turned away because one was supposedly already running, and each of those refusals was recorded as a successful night rather than a failure. Backups stopped happening and nothing told us. A failed start now releases the lock and is recorded as a failed backup, so the next attempt can run and an alert is raised.
- [CreditCard] **[FIXED]** **A Cancelled Subscription Could Cancel The Wrong One**
  If your billing record had ever ended up with two subscriptions attached, an old abandoned one alongside the one you were paying for, anything that happened to the old one was wrongly applied to your account. The clearest case was the abandoned subscription ending and taking your paid plan and supporter badge down with it. Every subscription update now checks which subscription it is about before making a change, and one you are not on is left alone. A genuinely lapsed account can still be picked up by a new subscription, so resubscribing is unaffected.
- [Gauge] **[FIXED]** **Late-Arriving Payment Notices Could Undo A Payment**
  Our payment provider, Stripe, does not guarantee that its notifications arrive in the order things actually happened, and it sometimes resends one if a delivery was uncertain. A notice saying your subscription had just been created could arrive after you had already paid, carrying an outdated snapshot from before the payment, and it would wrongly reset your account back to the free plan and remove your supporter badge. That notice is now treated as the oldest thing we can know about a subscription, so it can no longer overwrite anything newer.
- [CreditCard] **[FIXED]** **Changing Plans Could Bill You Twice**
  When you switched plans, we first asked Stripe about your existing subscription so we could move it to the new price instead of creating a second one. If that question failed, including from a timeout, we wrongly treated it as meaning you had no subscription and created a second one alongside the first, so you were billed for both every month with nothing in the app showing it. A failure now stops the plan change so you can try again, and a subscription is only treated as gone if Stripe genuinely confirms it. A few related billing checks had the same flaw and are fixed the same way.
- [ShieldAlert] **[FIXED]** **A Slow Response From Stripe Could Downgrade You**
  Looking up which plan a subscription belongs to would quietly swallow any error and answer as if there were no plan, which our system reads as the free plan. A single slow response from Stripe was therefore enough to drop a paying subscriber to the free plan and remove their supporter badge, on an event that was then marked as successfully handled. Errors are now passed through properly, so a failed lookup is retried instead of being treated as an answer, and we now distinguish between Stripe genuinely having nothing to report and Stripe simply being unreachable.
- [Wrench] **[FIXED]** **Failed Payments Could Wrongly Mark Your Account Past Due**
  A failed payment marked your whole account as past due even when it had nothing to do with your subscription: a one-off charge, an abandoned checkout's first invoice, or a retry on an account already cancelled. None of those has a later subscription payment to clear the warning, so it stayed on your billing page, and you could be emailed about a subscription you did not have. Past due is now only set when a renewal of your actual subscription fails, and clears once that renewal succeeds. A related bug that could erase a pending cancellation from your billing page was fixed the same way.
- [CreditCard] **[FIXED]** **An Unfinished Checkout Could Cancel Your Active Plan**
  Opening a second checkout to change plans, then not finishing it, still sends us a notice marked unpaid. We recorded that notice without checking which subscription you were actually on, so it wrongly reset your plan to free, marked your account incomplete, and pointed it at the checkout you had abandoned, even though the plan you were paying for was still active at Stripe the whole time. An unpaid checkout can no longer change an account that is on a different, still-active subscription. Your first purchase is unaffected, since there is nothing to protect at that point.
- [LifeBuoy] **[FIXED]** **A Contact Form Message Could Be Sent And Then Lost**
  Both contact forms sent two emails and told you we would get back to you, with the email being the only record your message existed. If our mail server was unreachable, a password had expired on our end, or the message bounced or hit a spam filter, it was lost: you were told it had arrived, and nobody here knew it existed. This matters most for the Security Issue category and the front-page form, used mainly by people with no account. Your message is now saved before sending, and you are told if it failed to send, so you can try again or email us directly.
- [ShieldCheck] **[ADDED]** **You Can Now Turn A Badge Off Yourself**
  A site badge could be created and its scope changed, and the ability to switch one off has technically existed since badges launched, but nothing in the product offered it to you. If you had embedded a badge on a site you no longer run, contacting us was the only option. There is now a Turn this badge off control on the Badge page. It asks you to confirm first, and it warns you that generating a new badge for that site afterwards gives it a new address, so any badge already placed elsewhere stays off rather than quietly coming back.
- [ScanSearch] **[FIXED]** **The Demo Scan Showed Untested Sections As Clean**
  A scan result is supposed to mark any part that did not finish, so it never looks like a clean result it did not earn. The free demo on our front page, the only scan you can run without an account, did not do this. When its checks ran out of time they came back as an empty pass rather than unfinished, so things like DNS records, certificates, reputation and exposed-file checks could be shown as run and clear when they had not completed. This was the same mistake already fixed elsewhere in this release; the demo was a leftover copy of it, and the report now names which checks ran short.
- [CreditCard] **[FIXED]** **Pricing Page Wrongly Promised More History On Paid Plans**
  Three places on the pricing page said paid plans keep your scan history for longer: the main heading, the explainer text, and the frequently asked questions section, which also feeds search engines and put the claim into search results too. None of it was true: scan history is unlimited on every plan, including the free one. The same wrong claim was already removed from the plan comparison cards in an earlier release, but these three copies survived that fix. All of them now show the real setting instead of a fixed number, the same way the cards and comparison table already did.
- [Layers] **[FIXED]** **Landing Page Overstated The Free Bulk Scan Limit**
  Two spots on the landing page advertised being able to scan up to 100 URLs in one go. That number is actually the top paid plan's limit, while a free account can only submit five at once, so following the advice on a free account got you a refusal instead of a scan. Both spots now state the free plan's real number alongside the top limit, pulled from the same source our system actually enforces.
- [FileSearch] **[FIXED]** **Around 770 Pages Had FAQ Content Nobody Could See**
  Around 770 pages, including the checks index, individual fix guides, category pages and two tool pages, published questions and answers meant for search engine results, but that content never appeared on the page itself. Search engines require this kind of content to be visible to visitors, and one part of the site already did it correctly. On the fix guides it was worse: the questions held answers that were never shown, so nobody could ever read them. That content now displays on every page, so the reasoning behind each check is actually readable, not just readable by search engines.
- [Wrench] **[FIXED]** **Prices And Limits Were Typed By Hand, Not Kept In Sync**
  The pricing page title, four pages comparing us to competitors, and our rate-limit documentation each had plan prices and daily limits typed in by hand, in some cases right next to a sentence explaining that those numbers actually come from our central pricing settings. All of them now pull from that source, so a price or limit change can no longer leave a page showing an outdated figure.
- [Share2] **[FIXED]** **Link Previews Named No Account On Social Media**
  When a VulnRadar link was shared on X (formerly Twitter), the preview card had no account attached, with a note in the code saying to fill it in once we had an account there, even though we already did: it is in the footer, on the landing page and in the site's own metadata. The preview card now reads the same account from that same source, so it, the footer and the site metadata cannot ever name different accounts, and anyone running their own copy of VulnRadar with a different account gets their own answer, not ours.
- [Globe] **[FIXED]** **Two Pages Wrongly Said Scans Run In Your Browser**
  The category pages and the API scanner page said that scans run inside your browser and that there is no extension to install. Neither is true: scans run on our servers, which is the whole reason the result matches what any stranger on the internet would see, and there is an optional browser extension available. Both pages now describe what actually happens.
- [UserCog] **[FIXED]** **Some Staff Roles Could Not Use Their Own Permissions**
  The staff account screen decided whether to show its Support and Danger Zone sections using one permission that had nothing to do with what those sections actually need. A billing role saw view-only access on the very screen holding the actions their role exists for, and the same flaw hid session revocation from security staff and hid chat bans from content staff. The underlying actions still worked if triggered directly; only the buttons to reach them were hidden. Each section now appears whenever staff can do at least one thing inside it, and every control still checks its own permission.
- [Key] **[ADDED]** **Two-Factor Lockout Had No Way Back**
  If you lost both your authenticator app and your backup codes, your account was locked out permanently: every way to turn off two-factor authentication needs you already signed in, and staff could not reset it by design. The only fix was editing our database by hand. Staff can now issue a one-time recovery code instead. It does not disable two-factor authentication: the code is emailed only to your verified address, is never shown to the staff who issued it, and getting back in still needs your password, email and a staff decision. It only works if your email was verified, and is logged.
- [Fingerprint] **[SECURITY]** **Staff Actions During Impersonation Were Logged As Yours**
  When a staff member signs in as you to help fix a problem, anything they did during that session used to be recorded in our activity log as you acting on your own account. The staff member's name appeared nowhere, and the only way to guess it happened was comparing timestamps against when the impersonation started, which failed if they closed the tab instead of clicking Stop. That information was always available to us internally; the log simply was not using it. The activity log now correctly records the staff member's name and which account they were acting on behalf of.
- [FileText] **[SECURITY]** **Two Admin Actions Affected Everyone With No Record Kept**
  Turning an AI-suggested label into a permanent scanning rule changes how every future scan for every user gets labelled, and doing so left no entry in our internal activity log. Redoing it over an existing rule silently rewrote it while still showing the original author's name, so a second edit left no trace at all. Forcing a database cleanup had the same gap, despite deleting rows across roughly fifteen tables, including the activity log itself. Both actions now record who ran them and what changed.
- [Lock] **[SECURITY]** **Staff Invitations Had No Limit On Attempts**
  The feature that emails someone an invitation to a staff role, including admin, had no limit on how often it could be used. The password an admin has to re-enter to send one could be guessed at endlessly, and every successful guess would email a role-granting link to whatever address was given. It now uses the same per-admin limit already used elsewhere in the admin panel for password prompts, and that limit is checked before the password, so a wrong guess still counts against it.
- [UserCheck] **[FIXED]** **Social Login Admins Wrongly Told Their Password Was Wrong**
  Two admin actions, sending a staff invitation and installing an update, each had their own separate password re-entry check, compared against a stored password directly. An account created by signing in with Google, GitHub or Discord has no stored password, so the check always came back wrong: those admins could never send an invite or install an update, and were told their password was incorrect every time. Both actions now use the same shared check the rest of the app relies on, which accepts an already signed-in session as confirmation when there is no password to check.
- [Puzzle] **[FIXED]** **The Extension Applied One Page's Result To The Whole Site**
  When you open a website, our browser extension asks us whether it has been scanned before. That question can be answered about the exact page, or fall back to the whole site, and our server always preferred the exact page, assuming the extension sent it, since it knows which tab is open. It never actually did. So scanning one page of a large site, like a single repository on GitHub, got reported as the standing of the entire site. The extension now sends the exact address, and a result is remembered against that specific page rather than the whole site.
- [MessageSquare] **[FIXED]** **Five Admin Actions Gave No Real Confirmation Message**
  Every action on a user's admin page is meant to confirm what it did with a specific message. Five actions had no message written for them and fell back to a generic Action completed, including the two that delete every webhook or every scheduled scan on an account, where that message was the only confirmation of what had just been destroyed. All five now say exactly what happened, and our own internal test now fails if a new action is added without one.
- [Fingerprint] **[SECURITY]** **Impersonation Could Change A User's Password And Email**
  When staff sign in as you to help with a problem, the rest of the app treats them as an ordinary signed-in customer, which is the point of the feature. That also meant six things were reachable that never should have been: changing your email or password, turning two-factor authentication off or on, regenerating backup codes, and deleting the account, none of it logged. Changing email is the most serious, since it redirects future password resets. All six are now blocked during impersonation, pointing staff to the correct admin action, which needs a password and is logged.
- [CalendarClock] **[FIXED]** **Resuming A Paused Scan Ran It Immediately**
  A scheduled scan remembers when it is next due, and pausing it did not stop that clock running. So a weekly scan paused for a month came back due four weeks ago, and resuming it triggered an immediate scan, using up one from that day's allowance, instead of waiting for the next time it was actually meant to run. Resuming now recalculates the next run from your chosen frequency and preferred time. Turning on a schedule that was never paused is unaffected, so this cannot be used to push a due scan further away.
- [Mail] **[FIXED]** **Resending An Announcement Could Email Everyone Twice**
  Sending an announcement is protected against being sent twice: it only works on a draft, and sending uses up the draft. Resending an already-sent announcement used the same check against a status that resending itself does not change, so it always passed and had no limit of its own. Every call re-delivered the announcement to every subscriber, so a double-click sent it to everyone twice, with nothing but someone noticing stopping a third. Resending now locks itself in as it records the attempt, with a minimum wait built in, so resending too soon is refused and tells you when it was last sent.
- [Globe] **[ADDED]** **Every Social Link Now Goes Through Our Own Website**
  Links to our accounts on other platforms used to be pasted in directly wherever they appeared, so when an account moved or was renamed, every copy of the old link broke, with no list of where they all were. Each one now has a short link on our own site, such as /discord for our Discord server and /github for our repository, which redirects to the real destination. Updating a link is now one setting, not a search across the site. The one place still naming the real profile is the metadata telling search engines which accounts are genuinely ours, a statement of identity, not a clickable link.
- [Mail] **[FIXED]** **The Footer Email Button Went To An Error Page**
  Clicking the mail icon in the footer led to a Cloudflare error page instead of opening your email app. Cloudflare hides email addresses from spam bots by replacing them and using a small script to restore them in your browser, but our pages only allow scripts we have explicitly approved for security reasons, so that script never ran and the link stayed broken. The mail icon now goes to our contact page instead, which cannot break this way and records what you send rather than depending on an email reaching us. Addresses on our legal pages are still shown as real ones.
- [Globe] **[CHANGED]** **Managing A Domain Now Opens Its Own Page**
  Verifying a domain unlocks controls over what other people's scans of it can show: every published scan, the option to unpublish one or cancel its share link, and a switch that stops it being scanned at all. Those controls used to open inline inside the row, pushing everything below down by a full page's height. Each verified domain now has its own page, reached by a Manage button. An unverified domain still opens in place, since that is one DNS record to add. A domain that is not yours gets the same response as an address that is not a domain, so the page never reveals which case it is.
- [Table2] **[FIXED]** **Admin Tables Could Shrink Down To Almost Nothing**
  Every table in the admin panel limits its own height to a portion of the browser window, so a long list scrolls inside the table instead of running down the whole page. That portion was measured against the whole window without accounting for the browser's own toolbars or how far down the page the table starts. On a short window, this worked out to barely more than the header row, leaving a thin strip of one row visible with the rest hidden below. The height can no longer shrink below a size that fits several rows, though it remains only a cap, so a table with two rows stays two rows tall.
- [Users] **[FIXED]** **Shared Items Showed Buttons Teammates Could Not Use**
  The webhooks list mixes ones you made with any a teammate shared into your team, and it showed every control on all of them regardless of who could use it. Someone with view-only access saw pause, edit, test, rotate and delete buttons on a webhook they could not touch, and each simply failed when clicked. Rotating the secret code was even shown to teammates who could otherwise edit the webhook, though that stays with whoever created it. Each row now shows only what you are actually allowed to do, and the same fix applies to scheduled scans and verified domains shared with your team.
- [Layout] **[FIXED]** **Admin Panel Links Briefly Loaded The Wrong Section**
  Opening a link straight to a specific admin section showed the overview section's loading placeholder first, then swapped it for the section you actually asked for, because the placeholder was fixed to always show the overview regardless of where you were headed. Every admin section now shows its own placeholder shape, so what you see in that first moment matches what is arriving. The one placeholder that genuinely cannot know which section is coming, shown before the page has finished loading, now shows only the shared header instead of guessing.
- [Table2] **[FIXED]** **Admin Screens Jumped Around As Their Data Loaded**
  Eleven admin screens showed their loading placeholder inside a padded, bordered box, while the real table sits flush against the screen with no border, so the layout jumped the moment data loaded. Four more screens, including broadcasts, security alerts, site notices and blocked rules, showed a placeholder with a header bar and round avatar icons for a list that has neither. Every placeholder now matches the shape of what it stands in for, and the screen header now stacks correctly on a phone screen from the start, instead of shifting down once data arrives.
- [Activity] **[FIXED]** **A Health Summary Card Grew Every Time It Loaded**
  The system health card reserved space for six rows while it actually shows eight, so the card visibly grew each time the real data arrived, and the placeholder shown before the page even loaded did not match the card's own count either. The row count is now calculated from the same logic that builds the actual list, so adding a new health check updates both the placeholder and the real card together instead of letting them drift apart.
- [Bell] **[FIXED]** **Screen Readers Heard Nothing While Admin Pages Loaded**
  Between clicking an admin section and its content arriving, screen readers announced nothing at all, leaving a blind or low-vision user with no idea anything was happening. Each loading placeholder now sits in a region that announces the destination's name, taken directly from the navigation menu rather than typed out separately. The email preview also stopped pulsing for anyone whose device is set to reduce motion.
- [Table2] **[FIXED]** **A Leftover Line Appeared Over Pinned Table Headers**
  Scrolling any table in the admin panel left a thin sliver of the row that had just scrolled past showing above the pinned column headers, in an area the table should not have been able to draw into at all. This turned out to be a browser bug in how a scrolling box clips content when a table pins its header, and switching to a different table border style fixed it without changing the layout. It was tracked down by testing directly against the running page: hiding the rows made the sliver disappear, proving it was real content rather than a screenshot glitch.
- [Wrench] **[FIXED]** **A Warning Icon Was Misaligned With Its Own Text**
  The security warning icon on the Updater page floated visibly above the line of text it belonged next to. Every block of text in the app is given a fixed line height regardless of its font size, and this particular notice used smaller text than usual without its own matching line height, so the text ran on a taller line than the icon beside it expected. Icons can now be told to match the line height of the text next to them automatically, which is the correct fix whenever an icon sits inside a line of text rather than beside a fixed-size block.
- [Mail] **[FIXED]** **Every Email Link On The Site Works Again**
  Sixteen contact links, on the legal pages, security page, contact page and several error screens, led to a Cloudflare error page instead of opening your email app. Cloudflare hides addresses from spam bots with a script restoring them in your browser, but that script is blocked here for security reasons, so every link stayed broken. Our fix: the address is no longer put on the page. Each link points to our contact form and becomes a real email link once the page loads, so scanning the page for addresses finds a form and nothing else. The link works with scripts off too, not dead.

---

## Earlier releases: change titles

Descriptions omitted. Ask about any of these by version and the full
entry is retrieved.

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

## v1.8.0 - February 21, 2026
**Email 2FA, Expanded Notifications & 55+ New Security Checks**

- [ADDED] Email-Based Two-Factor Authentication
- [ADDED] 18 Granular Notification Preferences
- [FIXED] Accurate Notification Routing
- [ADDED] 55+ New Security Checks (175+ Total)
- [CHANGED] Notification Bell in Header
- [ADDED] Scanner Category Selector
- [PERFORMANCE] Major Performance Improvements
- [FIXED] Fixed /shared Page Auth Detection
- [CHANGED] Engine Version 2.0.0

---

## v1.7.4 - February 20, 2026
**Docker Production Ready, Mobile UX Overhaul & Error Pages**

- [FIXED] Docker Production Ready
- [CHANGED] Mobile Menu Overlay
- [CHANGED] Icon-Only Buttons on Mobile
- [ADDED] Editable Team Names
- [ADDED] Team Member Avatars
- [ADDED] Custom Error Page

---

## v1.7.3 - February 19, 2026
**Unified Footer, Contact Upgrades & Error Pages**

- [CHANGED] Version Check via GitHub Releases
- [CHANGED] Unified Footer Across All Pages
- [ADDED] Contact Email Auto-Fill
- [ADDED] Staff Application via Contact Form
- [ADDED] Error Pages

---

## v1.7.2 - February 19, 2026
**Self-Hosted Schema & Stability Fixes**

- [FIXED] Scan History Save Fix
- [FIXED] Bulk Scan Notes
- [FIXED] Silent Catch Logging
- [FIXED] Notification Preferences Cleanup
- [FIXED] Docs Column Name Fixes

---

## v1.7.1 - February 19, 2026
**Migration Tool Improvements & Documentation Overhaul**

- [ADDED] Table & Column Rename Detection
- [CHANGED] Smarter Migration Prompts
- [FIXED] Migration Parser Rewrite
- [ADDED] Extra Table Detection
- [CHANGED] Documentation Overhaul
- [ADDED] Startup Version Check
- [FIXED] Exact Hostname Crawl Fix

---

## v1.7.0 - February 18, 2026
**Deep Crawl URL Selector, IP Rate-Limited Demo & Auto Scan Notes**

- [ADDED] Deep Crawl URL Selector
- [ADDED] Smart Crawl URL Filtering
- [FIXED] Same-Domain Redirect Handling
- [CHANGED] Crawl Results Separated by Page
- [SECURITY] IP-Based Demo Rate Limiting
- [ADDED] Auto Scan Notes
- [CHANGED] Full URL Display in History
- [CHANGED] Demo Subdomain Auth Message
- [CHANGED] Code Cleanup

---

## v1.6.8 - February 17, 2026
**Metadata & Social Preview Fixes**

- [FIXED] Page Metadata Fixed
- [FIXED] Consistent OG Images
- [FIXED] Canonical & Meta Tags

---

## v1.6.7 - February 16, 2026
**Scan Notes Visibility & Team Collaboration**

- [ADDED] Notes Visible to Team Members
- [CHANGED] Owner-Only Edit Permissions
- [ADDED] Notes on Shared Scans
- [CHANGED] Empty State Messaging

---

## v1.6.6 - February 16, 2026
**Subdomain Discovery Depth & Deep Scan Prefix**

- [CHANGED] Increased Subdomain Discovery Depth
- [CHANGED] Deep Scan URL Prefix

---

## v1.6.5 - February 16, 2026
**Scan Depth & Performance Improvements**

- [CHANGED] Deeper Crawl Limit
- [PERFORMANCE] Parallel Fetch with Concurrency Limit
- [CHANGED] Consistent Fetch Timeout

---

## v1.6.4 - February 16, 2026
**Subdomain Discovery & Real-Time Progress**

- [ADDED] Subdomain Discovery
- [ADDED] Real-Time Scan Progress
- [CHANGED] Accurate Progress Tracking

---

## v1.6.3 - February 16, 2026
**Scanner Category Visualization**

- [ADDED] Category Breakdown Chart
- [ADDED] Category Filtering

---

## v1.6.2 - February 15, 2026
**Expanded Security Coverage**

- [ADDED] 15+ New Security Checks
- [CHANGED] Improved Severity Ratings

---

## v1.6.1 - February 15, 2026
**Export & Sharing Enhancements**

- [ADDED] CSV Export
- [CHANGED] Enhanced PDF Reports

---

## v1.6.0 - February 15, 2026
**Deep Crawl Scanning**

- [ADDED] Deep Crawl Mode
- [ADDED] Aggregated Findings
- [ADDED] Link Discovery

---

## v1.5.0 - February 14, 2026
**Scheduled Scanning & Bulk Operations**

- [ADDED] Scheduled Scans
- [ADDED] Bulk Scanning
- [ADDED] Scan Tags

---

## v1.4.0 - February 14, 2026
**Team Collaboration**

- [ADDED] Teams & Organizations
- [ADDED] Role-Based Access
- [ADDED] Team Invitations

---

## v1.3.0 - February 11, 2026
**API Access & Webhooks**

- [ADDED] API Keys
- [ADDED] Webhooks
- [ADDED] Rate Limiting

---

## v1.2.0 - February 10, 2026
**Comparison & History**

- [ADDED] Scan Comparison
- [ADDED] Full Scan History
- [ADDED] Shareable Links

---

## v1.1.2 - February 10, 2026
**Safety Rating Indicator**

- [ADDED] Website Safety Rating
- [ADDED] PDF Report Safety Rating

---

## v1.1.1 - February 10, 2026
**Metadata & Branding Polish**

- [CHANGED] Consistent Social Cards
- [CHANGED] Unified Page Titles
- [SECURITY] Enhanced Security Headers

---

## v1.1.0 - February 10, 2026
**Contact System & UI Enhancements**

- [ADDED] Enhanced Contact Form
- [SECURITY] CAPTCHA Protection
- [ADDED] Team Collaboration
- [ADDED] Team Invite Emails
- [ADDED] Professional Email Templates
- [PERFORMANCE] Instant Response Times
- [CHANGED] Smart Email Routing
- [CHANGED] Improved Scanner UI

---

## v1.0.0 - February 9, 2026
**First Release**

- [ADDED] 65+ Security Checks
- [ADDED] User Accounts & Auth
- [ADDED] Admin Dashboard
- [ADDED] Webhooks & Notifications
- [ADDED] Scheduled & Bulk Scanning
- [ADDED] Scan Comparison & Sharing
- [ADDED] Scan Tags & History
- [ADDED] PDF Export
- [ADDED] Teams & Organizations
- [ADDED] API Keys & Rate Limiting
- [ADDED] Contact & Support
- [ADDED] Self-Scan Demo
- [ADDED] Onboarding Tour
- [ADDED] Documentation

---


---

## Quick reference

- **Total releases:** 73
- **Total changes documented:** 931
- **Latest:** v4.0.0 (Unreleased) - The Things That Were Written Down Twice
- **Earliest:** v1.0.0 (February 9, 2026) - First Release
