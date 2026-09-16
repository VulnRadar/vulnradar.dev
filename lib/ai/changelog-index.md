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
- [Lock] **[ENGINE]** **Faster, More Consistent Certificate Checks**
  Checking your site's security certificate used to involve four separate connections to your server, one per certificate-related check. If your site sits behind a service that can route different connections to different servers, the four checks could see four different certificates, and the report then described several at once. They now share a single connection, so every certificate finding describes the certificate your visitors actually see. The check that deliberately tests old, insecure connection versions still connects separately, since it must offer only those versions.
- [Filter] **[ENGINE]** **Five Page Checks Stop Flagging Ordinary Pages**
  Five checks were producing false alarms on ordinary pages: a source-code download link was flagged as an exposed sensitive file; a field was flagged just because its name contained letters like "tax", like a checkout page's tax rate, and now needs a real card, ID or tax number filled in; a common code-loading technique was mistaken for a riskier one; an article merely mentioning a debugging address, without linking to it, was wrongly flagged; and an insecure setting was marked high severity even where nothing changed. All five now need real evidence before reporting a problem.
- [ShieldCheck] **[SECURITY]** **A Page Designed to Freeze the Scanner No Longer Can**
  Before reading a page, the scanner first checks whether it is looking at a real web page at all. A page could be deliberately built to make that first check run almost forever, and while it did, every other scan running on the same server had to wait behind it. The check now takes an amount of time based only on the size of the page, not what is in it. A similar slowdown in the admin tool that converts a broadcast email into plain text was fixed the same way. Both were caught by automated security scanning of our own code.
- [ShieldAlert] **[ENGINE]** **A Security Code That Never Changes Is Reported**
  Some sites protect their pages with a one-time code, called a nonce, that tells the browser which scripts are genuine. It only works if the code is new on every visit. When it stays the same, for example because a page was cached with it, anyone can read it and use it to slip their own script in. The scanner now loads such a page twice and reports a code that did not change, without printing the code itself.
- [Wrench] **[ADMIN]** **Grant Credits From the Admin Panel**
  Staff can now see a user's AI, GitHub review and browser session credit balances in the admin panel and add credits directly, for example to make up for a problem, without touching the database. Each grant needs a reason and is recorded in the audit log, has a sensible maximum, and staff cannot grant credits to their own account. Only admins and the billing role can do this.
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
- [Bot] **[FIXED]** **The Assistant Forgot the Changelog Seconds After Being Handed It**
  Typing /changelog loaded the entire release history into the conversation: every change of every version, 506 KB, about 107,000 tokens measured against the model, in one message. It had grown there one release at a time, and the last one added ninety-eight entries. Nothing errored. The request was accepted, the reply came back, and the assistant answered as though it had never seen a changelog, which is the worst way for this to fail because there is nothing to look at. The command now sends an index: the newest releases with every description intact, then change titles for the ones behind them, then a line each for the rest, so every release we have ever shipped is still named and the recent detail is still there in full. The complete history stays on disk as the retrieval corpus, so asking about a release from six months ago still pulls that entire entry in beside the question. Same trick /checks has used since it outgrew a single message, applied to the file that outgrew it next.
- [Layers] **[FIXED]** **Every Loaded Command Was Sent Twice**
  Both places that build the message list for the AI appended the freshly loaded context by hand, because React had not yet applied the state update that put it there, and neither removed the previous copy sitting in the array they were appending to. So each loaded command went over the wire twice. There was a deduplication step meant to prevent exactly this, and it tested a field that nothing in the codebase ever sets: a leftover from a context pill that was removed when commands were made to load silently, still read in six places, always undefined, so the guard that asks whether a command is already loaded always answered no and reloaded it. With the changelog at half a megabyte that made a request over a megabyte, which is also the default body limit of nginx, and the chat route then dropped one of the two for exceeding its context budget. Both send paths now go through one function that keeps the newest block per command, and the dead field and the pill it belonged to are gone.
- [Gauge] **[ADDED]** **A Budget Whose Comment Was Two Releases Out of Date**
  The chat route splits its input allowance between conversation turns and the knowledge the slash commands load, and it skips anything over the larger budget. The number was chosen to fit every command loaded at once, and the comment beside it listed their sizes: changelog around 250k, docs around 100k. The changelog was 506k by then, and the five of them together no longer fit, so loading a second command silently cost you the first. The sizes were in a comment because nothing measured them. Now a test does, against the constant itself, and it fails with the actual file sizes and the instruction to serve the biggest one from an index rather than to raise the number. It also fails if a single command ever exceeds 200 KB on its own, and if either command with an index is ever changed to read the full file first. And the loader itself now refuses to return more than a message can carry: past that it cuts the content and says in the content that it was cut, so a gap the model can report replaces a block that silently never arrived.
- [Smartphone] **[FIXED]** **The Chat Sheet on a Phone Was a Desktop Panel Stretched to Fit**
  The panel is a 420-pixel widget beside the page on a desktop and a full-screen sheet on a phone, and every size in it was picked for the first one. Replies were 14px, smaller than any other body text in the app, on a surface that on a phone is the whole screen. Code blocks and tables inside those replies were 11px, and the reasoning block 10px. The three context shortcuts under the greeting, the first thing the assistant shows anyone, were 10px type in a chip twenty pixels tall: too small to read and under half the width a thumb reliably hits. The send and slash buttons were 36px squares. All of it now steps up below the desktop breakpoint and is untouched above it, the two composer buttons grow their touch target past the box rather than growing the box, and the disclaimer strip folds away while the keyboard is up, which is exactly when the sheet has no room to spare and the reply being waited on is what should be on screen.
- [CalendarClock] **[FIXED]** **A Generated File Recorded the Day It Was Generated**
  All six knowledge compilers stamped the build date into their output, and CI regenerates every one of them and fails on any difference. That was survivable for the markdown, because the drift check ignores lines matching "compiled from" and the date sat on such a line. It was not survivable for the search index built from those files: that is one unsplittable line of JSON, the ignore rule cannot reach inside it, and the date came in anyway as indexed text. So any commit made near midnight UTC was one CI run away from failing on a diff nobody wrote, and the comment in that file already claimed it was a pure function of its inputs. The date is gone from all six. Running the compilers twice now produces byte-identical output, which is the only property the check was ever asking for.

---

## Earlier releases: change titles

Descriptions omitted. Ask about any of these by version and the full
entry is retrieved.

---

## v3.9.0 - September 8, 2026 **(highlights)**
**Things That Fail Without Saying So**

- [FIXED] The Chat Answer Arrived All At Once
- [FIXED] A Heading That Changed Size While You Watched
- [FIXED] Four Pages Had Each Built the Same Error Box
- [SECURITY] A Production Backup Was Being Copied Into Every Docker Build
- [ADDED] Guards for the Two Ways This Repository Has Leaked
- [FIXED] One Column Had Three Different Maximum Lengths
- [ADDED] Who Blocked This Domain
- [CHANGED] The Reverse Proxy Mistakes That Give No Error
- [FIXED] Every Payment Record Has Been Storing a Blank Payment Reference
- [FIXED] Report Export Was Broken in Every Chrome Build of the Extension
- [FIXED] The CLI's JSON Output Was Not JSON
- [FIXED] A Migration Could Run Its Destructive Steps With No Backup
- [FIXED] The Guard Against Silent Test Loss Could Itself Fail Silently
- [CHANGED] The Emails Were White
- [FIXED] One Fact, Reported Once
- [FIXED] Four Headers That Were Not Findings
- [FIXED] The XSS Check Was Looking For The Wrong String
- [FIXED] Checks That Fired On Prose, And One That Never Fired At All
- [FIXED] A 2021 CVE Cited At Every Grafana Ever Scanned
- [SECURITY] Anyone Could Rewrite Someone Else's Chat History
- [FIXED] Plan Limits That Two Clicks Could Walk Past
- [ADDED] Broadcasts Started From A Blank Textarea
- [SECURITY] A Button Label Was The One String Nobody Escaped
- [ADDED] Fourteen New Checks, Weighted Toward What Actually Goes Wrong
- [ADDED] The security.txt Check Fetched The File And Never Read It
- [FIXED] VulnRadar Scanned By VulnRadar
- [ADDED] Look This Up Somewhere Else
- [SECURITY] An Admin Delete That Answered To Three Names And Checked One
- [SECURITY] Support Staff Could Read Every Customer's Webhook Secrets
- [SECURITY] The Lockout Message Told You Whether An Account Existed
- [FIXED] Two Ways To Pay Us And Get Nothing
- [FIXED] A Backup That Restored With Duplicate Rows
- [FIXED] A Check We Shipped This Morning Could Be Hung By The Page It Read
- [FIXED] The Extension's Most Complete Setting Was The One That Scanned Least
- [FIXED] The CLI Could Not Be Stopped, And Gave Up Too Easily
- [FIXED] The Extension Build Was Broken And CI Ran Around It
- [FIXED] Your Hundred And First Scan
- [SECURITY] Anyone Could Freeze The Whole Server With A Four Kilobyte Page
- [SECURITY] A Block Button That Blocked Nobody
- [FIXED] The Admin Panel Asked For A Password And Then Said No
- [FIXED] A Scan That Ran Out Of Time Said Three Checks Came Back Clean
- [SECURITY] A Public Page Could Publish The Link You Actually Scanned
- [FIXED] The Daily Scan Limit Stopped Being Enforced When The Database Struggled
- [FIXED] The Alarm Switched Itself Off At The Moment It Went Off
- [FIXED] The Weekly Summary Could Arrive Every Six Hours
- [FIXED] A Scan That Was Never Saved Still Answered With A Report
- [FIXED] Download My Data Left Out Two Thirds Of Your Data
- [SECURITY] A Reply On A Shared Ticket Outlived The Account That Wrote It
- [ADDED] A Way To Follow Along, Once, Without Being Asked Twice
- [SECURITY] A Shared Report Published More Than The Report
- [SECURITY] Anyone Could Make The Host Score Chart Read Every Public Scan
- [FIXED] Badges Did Not Load Outside GitHub
- [FIXED] Revoked Share Links Kept Unfurling In Chat
- [SECURITY] The Demo Scanner Handed Back A Site's Own Cookies
- [ADDED] Two Webhook Controls That Only Existed Over The API
- [FIXED] Scans Stuck On Running Are Now Cleaned Up While The Server Runs
- [FIXED] A Scheduled Scan That Failed To Start Sat There Forever
- [FIXED] Scheduled Scans Could Run Twice And Charge Twice
- [FIXED] Two Workers Reported A Healthy Pass With Nothing Working
- [FIXED] Automatic Backups Went Quiet After A Failed Start
- [FIXED] A Cancelled Subscription Could Cancel The Wrong One
- [FIXED] Out Of Order Stripe Events Could Undo A Successful Payment
- [FIXED] Changing Plans Could Bill You Twice
- [FIXED] A Stripe Hiccup Could Downgrade An Active Subscriber
- [FIXED] Payment Retries Left Accounts Stuck On Past Due
- [FIXED] An Abandoned Checkout Could Cancel The Plan You Were Already On
- [FIXED] A Message Sent Through The Contact Form Could Vanish
- [ADDED] There Was No Way To Turn A Badge Off
- [FIXED] The Demo Scan Called Four Sections Clean Without Running Them
- [FIXED] The Pricing Page Sold A Longer History That No Plan Buys
- [FIXED] The Landing Page Quoted The Top Plan's Bulk Limit To Everyone
- [FIXED] Around 770 Pages Published FAQ Markup You Could Not Read
- [FIXED] Prices And Quotas Typed Into Copy Instead Of Read From The Catalogue
- [FIXED] Link Previews Carried No Account Attribution
- [FIXED] Two Pages Claimed Scans Run In Your Browser
- [FIXED] Billing And Specialist Staff Roles Could Not Use Their Own Permissions
- [ADDED] Two-Factor Lockout Had No Way Back
- [SECURITY] Staff Actions Taken While Impersonating Were Filed Against The User
- [SECURITY] Two Admin Actions Changed Everyone's Data Without Leaving A Record
- [SECURITY] Staff Invites Could Be Sent Without Limit
- [FIXED] Admins Who Signed Up With Google, GitHub Or Discord Were Told Their Password Was Wrong
- [FIXED] The Extension Showed One Page's Result For A Whole Site
- [FIXED] Five Admin Actions Confirmed Themselves With Nothing In Particular
- [SECURITY] Impersonation Could Change The Password And Email Of The Account It Was Impersonating
- [FIXED] Resuming A Paused Scan Ran It Immediately
- [FIXED] Resend Could Mail The Whole User Base Twice From One Double Click
- [ADDED] Every Social Link Is Now An Address Of Ours
- [FIXED] The Email Button In The Footer Went To A Cloudflare Error Page
- [CHANGED] Managing A Domain Is A Page Instead Of A Drawer
- [FIXED] Admin Tables Could Shrink To Little More Than Their Own Header
- [FIXED] Shared Rows Offered Teammates Buttons That Always Failed
- [FIXED] Deep Links Into The Admin Panel Loaded The Wrong Section First
- [FIXED] Admin Panels Jumped When Their Data Landed
- [FIXED] The System Health Card Grew Two Rows Every Time It Loaded
- [FIXED] Screen Readers Were Told Nothing While An Admin Section Loaded
- [FIXED] Leftover Text Sat On Top Of The Pinned Header When You Scrolled An Admin Table
- [FIXED] A Warning Icon Sat Six Pixels Above Its Own Sentence
- [FIXED] Every Email Link On The Site Works Again, And The Addresses Are Better Hidden Than Before

---

## v3.8.5 - September 6, 2026
**Whose Domain Is It**

- [ADDED] You Can Finally Do Something About Scans of Your Own Domain
- [FIXED] The Assistant Was Answering to the Model's Name
- [FIXED] Repo Scans Returned Nothing on an Anthropic Endpoint
- [FIXED] The Code Review Prompt Said What to Look For and Nothing About When Not to File
- [FIXED] The Icons Were Never Quite Lined Up With the Text
- [FIXED] The Chat Window Was Drawn Underneath the Browser's Own Toolbars
- [FIXED] The Repo List Is Now the Same Table as the Scan List
- [FIXED] Asking for a Port Sweep Could Cost You the Whole Scan
- [FIXED] Four Settings Were Being Overridden by the Literal Beside Them
- [ADDED] The Verification Agent Can Now Be Measured Instead of Guessed At
- [SECURITY] A Database Dump Can No Longer Be Committed Unnoticed
- [CHANGED] Stopped Sending a Header Our Own Scanner Says Not to Bother With
- [FIXED] The Release Build Installed an Emulator It Never Used

---

## v3.8.4 - September 6, 2026
**The AI Was Answering Without Thinking**

- [FIXED] Reasoning Was Requested From Claude and Nobody Else
- [FIXED] An Anthropic-Compatible Endpoint Was Treated as an OpenAI One
- [ADDED] The Model List Went From 24 to 36
- [FIXED] The Verifier Called True Findings False Positives
- [FIXED] Every AI Timeout Was Set for a Fast Model
- [CHANGED] Self-Hosting Note: Your Reverse Proxy Has a Timeout Too
- [FIXED] Unreadable Backup Codes Were Reported as Fine
- [FIXED] Deleting a Scan Mid-Verification Filled the Log With Errors

---

## v3.8.3 - September 5, 2026
**The Scanner Reported a Zone It Could Not Actually Walk**

- [FIXED] Zone Walking Was Reported on Zones That Cannot Be Walked
- [CHANGED] The AI Verification Pass Could Not Call a DNS Finding Wrong
- [CHANGED] We Told Most of the Web to Enable Something It Cannot Enable
- [CHANGED] DANE Is Now Checked Where Anything Actually Enforces It
- [CHANGED] We Reported a Browser Default as a Missing Header

---

## v3.8.2 - September 5, 2026
**The Updater Stopped Refusing Installs It Had Always Updated**

- [FIXED] The Updater Told Panel Installs to Pull an Image They Do Not Have
- [CHANGED] Updates Stopped Installing Things a Running Copy Has No Use For
- [SECURITY] An Encrypted Database Backup Was Committed to the Repository
- [FIXED] Our Own Compose File Installed the Previous Release

---

## v3.8.1 - September 5, 2026
**A Scanned Page Can No Longer Stall the Server**

- [SECURITY] Making a Scan Private Did Not Revoke Its Share Link
- [SECURITY] Subdomain Discovery Was Sold as Paid and Guarded Only in the Browser
- [FIXED] Google Was Told Two Different Things About the Home Page
- [FIXED] The Boot Banner Named a Schema Version That Never Existed
- [SECURITY] Two Release Workflow Weaknesses, Found by Our Own Code Scanning
- [SECURITY] Nested HTML Could Exhaust Memory and Kill the Process
- [SECURITY] Two Detection Patterns Could Be Made to Run for Minutes
- [FIXED] The Performance Test Suite Now Includes the Shapes It Missed
- [FIXED] A Self-Host Following Our Own Setup Guide Could Never Log In
- [SECURITY] An Invitation Could Be Taken by Someone Who Never Owned the Address
- [SECURITY] An Authenticated Scan That Did Not Finish Showed as Clean
- [FIXED] Form Logins Opened Browser Sessions Nothing Was Paying For
- [FIXED] The Checks People Kept Marking Wrong
- [ADDED] Engine Feedback Shows What a Check Actually Fired On
- [ADDED] Findings Show Their Proof, and Triage Reaches Exports
- [FIXED] The Live Browser Viewer Was Showing the Wrong Shape
- [CHANGED] The Assistant Panel Rebuilt
- [FIXED] Admin Tables Stopped Bleeding Text Through Their Headers
- [CHANGED] Every Email Redrawn
- [FIXED] The Backup List Counted One Backup as Two
- [FIXED] A Backup That Could Not Be Read Was Blamed on Its Format
- [ADDED] Four Switches for When Something Is Going Wrong
- [FIXED] Four Ways to Run a Scan Notified Nobody
- [ADDED] Alerts That Say What Changed, Not Just How Many
- [SECURITY] Seven More Pages That Could Hold the Server Still
- [FIXED] The Speed Tests Now Measure the Whole Sweep, Not Just One Check

---

## v3.8.0 - September 3, 2026 **(highlights)**
**Self-Hosting Works, Scans Tell the Truth, and Nothing Runs Free**

- [FIXED] A Fresh Self-Host Starts on a Blank Postgres
- [FIXED] Your .env Actually Reaches the Container
- [FIXED] You Can Log In to a Self-Host Without Configuring Email First
- [SECURITY] CI Builds the Real Image, Boots It, and Waits for the Test Suite
- [ADDED] ARM64 Images, and a Latest Tag That Means the Latest Release
- [FIXED] Creating, Cloning and Upgrading a Database Stopped Skipping Tables
- [SECURITY] Backups and Encryption Keys Stopped Losing Data Quietly
- [FIXED] An Unfinished Scan Is Never Reported as Clean
- [SECURITY] Ten Checks Gave Up After the First Match on the Page
- [FIXED] Findings That Reported the Wrong Thing
- [SECURITY] A Hostile Page Can No Longer Stall the Scanner
- [SECURITY] More Internal Address Ranges Blocked, and Every Redirect Re-Checked
- [PERFORMANCE] Scans Send About Half the Requests They Used To
- [FIXED] Scans Stopped Failing and Hanging at the Edges
- [FIXED] Deep Scans Honour the Options You Picked
- [FIXED] Five Ways to Run Scans That Charged Nothing
- [FIXED] Billing Bugs That Downgraded the Wrong Account
- [ADDED] One Page for Every Credit Balance
- [CHANGED] The Pricing Page Says What You Get for the Money
- [SECURITY] Sign-In, Sessions and Two-Factor Hardened
- [SECURITY] Endpoints That Had No Rate Limit at All
- [SECURITY] Staff Permissions That Were Not Actually Enforced
- [SECURITY] A Private Scan No Longer Starts Public
- [FIXED] Shared Reports Unfurl, and the Preview Carries Your Own Branding
- [SECURITY] Webhook Secrets Are Encrypted, Rotatable, and Deliveries Are Visible
- [CHANGED] The Scan Verdict Now Leads the Report
- [FIXED] Sorting and Filtering a Report Is Instant and Survives the Back Button
- [FIXED] Scan History Tells You the Real Numbers
- [FIXED] A Failed Load No Longer Reads as an Empty Account
- [FIXED] Actions That Failed in Silence Now Say So
- [ADDED] You Can Scan Your Own Site Without an Account
- [FIXED] Team Scan Sharing Actually Works
- [FIXED] Support Tickets Read Like a Conversation on Both Sides
- [CHANGED] The Admin Panel Opens on a Health Check
- [FIXED] Sixteen Admin Panel Bugs
- [FIXED] Admin Settings That Saved and Then Did Nothing
- [FIXED] Light Mode Is Readable
- [FIXED] Keyboard Focus Is Visible and Skip Links Actually Move Focus
- [FIXED] Every Dialog Behaves Like a Dialog
- [FIXED] Nothing Scrolls Sideways on a Phone Any More
- [FIXED] Loading Screens Match the Page That Arrives
- [FIXED] One Navbar on Every Public Page, and Links That Go Where They Say
- [FIXED] Badges Now Show an A+ to F Grade
- [PERFORMANCE] Lists Stopped Loading Every Finding to Draw a Badge
- [PERFORMANCE] A Lot Less JavaScript on First Load
- [FIXED] The Changelog Page Stopped Downloading Every Release
- [FIXED] Email: One-Click Unsubscribe, Real Expiry Times, No Duplicates
- [FIXED] PDF and CSV Reports Render What You Actually Wrote
- [FIXED] The API Reference Documents the API That Exists
- [FIXED] Documentation Rewritten Where It Was Wrong
- [CHANGED] Documentation You Can Skim
- [FIXED] The Landing Page Says Who It Is For
- [FIXED] The Check Reference Got Search, Filters, and Titles That Do Not Collide
- [SECURITY] The Browser Extension Can Point at Your Own Instance
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

## Earlier releases: one line each

- **v1.9.2** (February 24, 2026) Security Hardening, GDPR Compliance & Docker Production Overhaul: 6 changes (2 security, 2 added, 2 changed)
- **v1.9.1** (February 23, 2026) ToS Modal & Header Fixes: 2 changes (1 changed, 1 fixed)
- **v1.9.0** (February 23, 2026) Auth-Aware Public Pages, Codebase Refactor & Performance: 9 changes (7 changed, 1 added, 1 performance)
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
- **Total changes documented:** 927
- **Latest:** v4.0.0 (Unreleased) - The Things That Were Written Down Twice
- **Earliest:** v1.0.0 (February 9, 2026) - First Release
