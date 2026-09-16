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
- [Code] **[BREAKING]** **CLI Exit Codes Now Separate a Failed Gate From a Failed Run**
  The CLI had two exit codes: 0 for a clean gate and 1 for everything else, so a pipeline could not tell a real threshold breach from an expired API key, a network timeout or a 5xx. Exit 1 now means the scan ran and a threshold was exceeded; exit 2 means the CLI could not produce a result (authentication, network, API error or bad arguments), and --help exits 0. With --json, argument errors now print a JSON document too, so a pipe into jq never receives empty input and reports a pass. Migration: scripts that only check for a non-zero exit are unaffected; scripts that treat exit 1 as "any failure" should also handle 2.
- [Webhook] **[BREAKING]** **Webhook Type Is Now Validated**
  The type field on POST /api/v3/webhooks and PATCH /api/v3/webhooks/{id} was documented as an enum and accepted anything. Delivery only recognises discord and slack, so a Discord webhook saved as "Discord" silently received plain JSON instead of an embed, with every call returning success. Values other than auto, discord, slack and generic now return 400. Migration: send one of those four, or leave type out to detect it from the URL.
- [ShieldCheck] **[SECURITY]** **Deleting a Webhook No Longer Reveals Which Ids Exist**
  DELETE /api/v3/webhooks returned 404 for a webhook that exists but belongs to someone else, and 200 for an id that matched nothing, so comparing the two told a caller which ids were in use. Both now return 404. Migration: treat a 404 on an id you already deleted as the same outcome as the 200 it used to return.
- [Lock] **[SECURITY]** **Completing a Password Reset Is Rate Limited**
  Requesting a reset was limited per IP and per email; completing one was not limited at all. Each attempt takes a database connection and a row lock before it can reject a wrong token, so an unthrottled caller could exhaust the connection pool. It now shares the existing reset budget under its own key. Reset tokens are 256 bits, so this was never a guessing risk, but it was a free way to degrade the service.
- [Lock] **[SECURITY]** **Findings No Longer Store Live Cookie Values**
  The newer cookie and token checks attached the exact Set-Cookie line as proof, and for a session cookie that line is the session. The form check quoted pre-filled input values the same way. Proof is saved with the scan, shown on the results page and in exports, and passed to the AI verifier. Cookie values are now replaced with their length and input values are masked, while the attributes each finding is actually about stay visible. A test runs every page check against a response full of secrets and fails if any of them reaches a finding.
- [ShieldCheck] **[ADDED]** **VulnRadar Scans Itself on Every Build**
  CI now boots the production image and runs every page the sitemap publishes, all 871 of them, through the same engine a scan uses. A finding fails the build unless it is listed as accepted with the reason it is not a defect, and there are three: two informational notes about inline styles that our script-locked policy permits, and the API description we publish on purpose. Nothing in the engine knows our own hostname, and no check was weakened to get there.
- [Mail] **[ADDED]** **Send a Broadcast to Yourself Before Sending It to Everyone**
  The broadcast composer had a preview and a send button and nothing in between, and the preview cannot show what Gmail or Outlook will actually do with the message. Send test to me delivers the composed message to your own inbox through the same email layout, with your own unsubscribe link. It writes nothing: no draft, no recipient records, no history entry, so an unsaved draft can be tested as often as needed. The subject is prefixed [TEST] so it cannot be confused with the real send, and it is rate limited.
- [FileText] **[ADDED]** **Save Your Own Broadcast Templates**
  The seven campaign templates were built into the app, so adding an eighth meant a code change and a release. Save as template now keeps the current subject and body as a starting point, listed under Saved here in the template picker for every admin. Saving a name that already exists updates it, regardless of capitalisation. Deleting a staff account keeps the templates that person wrote, and creating, updating and deleting a template are all recorded in the audit log.
- [Bot] **[ADDED]** **The Assistant Can See How Much of Your Limit Is Left**
  Asked why a scan would not start, the assistant could see your daily limit but not how much of it you had used, so it guessed. It now reads the same usage figure the scan routes enforce, so the number it quotes is the one that decides your next scan. When you ask about a specific scan it can also name the findings, not just count them by severity.
- [UserCheck] **[IMPROVED]** **Password Managers Recognise the Sign-In Field**
  The email field on the sign-in and sign-up forms was marked as an email address rather than as the username, which is the field password managers pair with the password. Our own scanner reported it.
- [Palette] **[IMPROVED]** **A Calmer, More Consistent Interface**
  The landing page separates sections with a change of background instead of a line under each one, using three surface steps that hold up in both light and dark themes. Every button now responds visibly to a press. Marketing calls to action are pill shaped while buttons inside the app stay rectangular. Cards dropped the stock drop shadow the rest of the app never used, and menu items, checkboxes and tabs now share the corner radius of every other control. First-time visitors get the theme their operating system asks for, with dark as the fallback.
- [Layers] **[IMPROVED]** **Every Modal Opens the Same Way**
  Modals already shared a layout but not their motion: sheets slid in, the command palette zoomed, and dialogs, alert dialogs and the custom modal shell appeared with no transition at all. They now share one entrance, so modals that are built the same finally look the same when they open.
- [ServerCrash] **[IMPROVED]** **See Which Scans Failed, Not Just How Many**
  Admin > System > Scanner Queue showed a count of failed scans with nothing behind it. The count now opens into the failures grouped by error message, so 25 identical timeouts and 25 unrelated errors no longer look the same. The rows load when opened rather than on the 45-second refresh, so customer URLs are not sent over the wire to fill a collapsed section. On Billing Overview, the past-due accounts table now has a card layout on phones instead of a wide table you had to drag sideways.
- [Target] **[FIXED]** **Icons Now Line Up With the Text Beside Them**
  An icon next to a paragraph sat about four pixels above the first line of text in 18 places across the app. The shared icon component centred itself on a shorter line than body text actually uses; it now matches the text it sits beside.
- [Smartphone] **[FIXED]** **Pages No Longer Swipe Sideways on iPhone**
  Some pages could be dragged left and right on iOS even though nothing visible was wider than the screen. The horizontal overflow rule was applied to only one of the two elements Safari can scroll, and used a value that still creates a scrollable area. Both elements now use one that cannot scroll, and at 375px wide every page measures exactly the width of the window.
- [Shield] **[FIXED]** **The Status Badge Uses the Brand Colours**
  The embeddable badge drew its caution state in a stock yellow one shade away from the product's amber, in the one surface that renders inside other people's READMEs where nothing else can correct it. It now reads the brand palette directly, and its test compares against the palette instead of a copied colour code.
- [Gauge] **[PERFORMANCE]** **Less Waiting on the Pages You Use Most**
  Three routes, including the scan detail page, loaded remediation state and then false-positive state one after the other although neither needed the other; they now load together. A bulk scan wrote one database row per URL while holding its concurrency lock and now writes the batch in one statement. Authenticated scans used an older check runner that blocked the server for about a second per scan, stalling every other request; they now use the same yielding runner as regular scans.
- [Download] **[PERFORMANCE]** **Audit Log Export Streams Instead of Loading Everything Into Memory**
  Exporting the audit log loaded up to a year of entries into server memory and then built the entire file as one string, which on a busy instance could take the site down. The export now streams in pages. It is still the complete log, and if the database fails partway through, the download aborts rather than producing a file that looks complete but is not.
- [Search] **[PERFORMANCE]** **The Public Scans Directory Has Its Own Index**
  The public scans directory had no database index for the filter it runs on every request, so each page read through scan history to find the public entries and then counted them again. A partial index now covers exactly the rows the directory can show, in the order it shows them. This page is public and crawled, so it was the listing that needed it most.
- [AlertTriangle] **[ENGINE]** **Bulk Scans No Longer Drop Targets Silently**
  The bulk scan endpoint kept its own list of six accepted protocols while the scanner supports fifteen. A batch containing an smtp, imap, pop3, ssh, sftp or mongodb target came back shorter than it was sent, with no error and no entry explaining the gap, even though each of those URLs was accepted by the single scan endpoint. Both now use one list, and the error for a genuinely unsupported protocol names all fifteen supported ones.
- [ServerCrash] **[ENGINE]** **A Scan That Could Not Be Marked Failed Now Leaves a Trace**
  When recording a scan as failed was itself rejected, usually because the database was unhealthy, seven code paths discarded the error without logging it. The scan stayed pending or running with nothing to explain why. Those paths now write the scan id, the reason and the error to the admin error log, and still never crash the server.
- [ScanSearch] **[ENGINE]** **Secret Checks Now See Inline Scripts**
  The provider-specific secret checks removed every script element before searching, so that code examples on documentation pages would not trigger them. That also removed the page's own inline scripts, which is where a leaked key usually sits, so a key assigned in a bootstrap script was never reported. They now search inline scripts too, leaving out structured data, the framework payloads that carry page text, and code examples, so documentation still does not report itself.
- [Globe] **[ENGINE]** **Checks Judge the Page That Was Actually Fetched**
  A scan of an http:// address that redirected to https judged the https page as if it had arrived over plain HTTP. The HSTS check, which only applies to HTTPS, never fired, the plain-HTTP transport finding fired at high severity against a site that does redirect, and the mixed-content and form checks were skipped. Single scans, crawls and authenticated scans now evaluate the final URL. Finding ids are still keyed on the address you asked for, so triage marks and regression baselines carry over.
- [Layers] **[ENGINE]** **One Misconfiguration, One Finding**
  Newer checks declared which older checks they duplicate, but the older checks never got the matching entry, so the two never merged. One session cookie with no attributes produced nine findings, one policy with a wildcard and an http: source produced four, and a frameable page, a target=_blank link and an http:// image were each reported two or three times. They now merge into one finding that lists the other checks that agreed. Tests fail on a merge rule naming a check that does not exist or a group with a single member, which is how seven rules had quietly stopped doing anything. GraphQL introspection, reported by two keyword checks and the live query that confirms it, is one finding too, and the confirmed result is the one kept.
- [ShieldCheck] **[ENGINE]** **Content Security Policy Is Read From Both Places It Can Be Set**
  Eleven policy checks read only the response header, so a site delivering its policy in a meta tag was told it had no object-src, no upgrade-insecure-requests, and so on. They now read both, and directives a meta policy is not allowed to set, such as frame-ancestors and sandbox, stay header-only. Also corrected: a missing frame-src is not reported when child-src or default-src covers it, a directive written in capitals is recognised, sha384 and sha512 hashes count as hashes, a bare https: source in script-src is reported as the wildcard it is, and an HSTS header with an invalid max-age is treated as absent, because browsers ignore it.
- [FileSearch] **[ENGINE]** **Writing About a Vulnerability No Longer Scores as Having One**
  Scanning our own site with our own engine raised about 120 checks, a dozen at critical, almost all on the check catalog and the documentation: PHP create_function() at critical, an HMAC compared with === at high, a site reading session cookies and opening the camera. Those pages run none of that code. They name it, the way every security blog and framework tutorial does, so every customer with a documentation site was getting the same report. Removing code blocks was not enough, because the same words sit in headings, paragraphs, link text, data attributes, the meta description and, on a Next.js site, a second copy of the page's text inside a script tag. Checks that look for a code pattern now read the page as a browser acts on it: tags, the attributes that do something, and the page's own scripts, without the prose. Checks whose evidence is text, such as a stack trace or an error page, still read the text. A test pins both halves: a page quoting eighteen dangerous snippets every way a page can reports nothing a blank page would not, and a page that really runs them still fires.
- [ShieldAlert] **[ENGINE]** **A Certificate for the Wrong Site Is Now a Finding**
  A certificate that did not cover the scanned hostname, or that chained to an untrusted root, dropped the TLS grade to F with no finding explaining why, because only expired and self-signed certificates had one. Both are reported at high severity now, and the hostname case lists the names the certificate does cover. SPF records were also counted short: bare a, mx and ptr mechanisms each cost one of the ten allowed DNS lookups and were not counted, so the common v=spf1 a mx include: record could exceed the limit unreported. A record ending in ?all, which publishes no policy, is reported instead of passing.
- [CheckCheck] **[ENGINE]** **Wrong Verdicts Corrected**
  Sites enforcing Trusted Types were told they were not, because the check searched the policy for the JavaScript API's name instead of the directive. Algolia's public search key, which Algolia's own documentation names ApiKey, was reported as a leaked admin key at critical. One check stated that jsonwebtoken accepts any algorithm when none is specified, which version 9 does not, and reported every verify call without one as critical; only an explicit none is reported now. Hardening guides that mention /.git/config were reported as exposing it. In the other direction: postMessage calls with a transfer list were missed, one Secure cookie hid every insecure cookie in the same response, a library pinned as jquery@1.12.4 the way jsDelivr and unpkg load it was never matched, Docker Hub organization tokens were not recognised, and neither was the /swagger-ui path.
- [ScanSearch] **[ENGINE]** **Error Pages Are Recognised by Their Own Markup**
  A default error page is evidence because of its text, so these checks cannot simply ignore text; they matched a sentence describing the page instead of the page. Each now looks for what the real page renders: nginx's centred version footer, Apache's address signature, S3's error code element, the ASP.NET yellow screen's section labels, the .NET Core exception page's stack tab, Jenkins' head attributes and Grafana's boot data. A subdomain takeover fingerprint only counts on a short page, since an unclaimed-domain response is a sentence or two. Several plain bugs went with them: the GraphQL checks treated /graphql-introspection as a GraphQL endpoint, the Swagger check matched any path starting /swagger and a link to a vendor's API docs, two secret checks fired on their own name in a link, and the hidden password field check read Tailwind's outline-hidden class as a hidden field, so every styled sign-in form was flagged.
- [AlertTriangle] **[ENGINE]** **A Check That Breaks No Longer Reads as a Clean Scan**
  When one of the checks that read a page threw an error instead of reaching a verdict, the scan counted it and moved on, and a scan with no findings still said every enabled check ran and none fired. That area was never checked. It is now reported the way a timed-out section already was: the result says the scan did not finish, the confidence figure drops, and the scan record names the checks that failed, for whoever investigates. The warning also stopped blaming the time budget for every unfinished area, since a timeout is only one of the reasons.
- [Database] **[API]** **Pagination Parameters Can No Longer Break a Request**
  Seven routes each parsed page and limit on their own, and three got an edge case wrong: page=0 produced a negative offset and a 500 error, a non-numeric limit reached the database as NaN, and a value like 1e21 passed validation and overflowed. Every route now uses one parser that handles each of those cases.
- [FileText] **[API]** **The OpenAPI Spec Lists Everything the Scan Endpoints Accept**
  The OpenAPI document is what generated clients and the API playground are built from. It listed three of the seven fields POST /api/v3/scan accepts (isPublic, captureScreenshot, teamId and teamIds were missing), reused that schema for crawls so the page selection and login fields appeared nowhere, and described the auth block as a single shape when it is three. All of that is now accurate, and the playground no longer pre-fills a request body that would fail validation.
- [BookOpen] **[API]** **API Reference Corrections**
  The API reference was checked line by line against the routes. The most important correction: crawls were documented as costing one quota unit when run with an API key, but every scanned page costs one, for every authentication method. Also corrected: POST /scan/authenticated does run the page-content checks; the response shape of POST /scan/discover; DELETE /history/{id} returns only success, takes the scan's opaque id, and is allowed for teammates with scan management rights; and the subdomain cache lasts 4 hours by default, not 24. Newly documented: GET /browser/sessions/logs, the bound_ip field on GET /keys, rate limiting on POST /keys, and team sharing on the scan endpoints.
- [Puzzle] **[EXTENSION]** **The Extension's Permission List Matches Its Manifests**
  The extension documentation listed activeTab and scripting, which neither the Chrome nor the Firefox manifest requests, and omitted contextMenus and downloads, which both request and use for right-click scanning and report export. For a security tool, claiming permissions it does not ask for is as misleading as hiding ones it does. The list now matches the manifests exactly. The extension's build toolchain was also updated, and its TypeScript version can no longer move a major version away from the app's without a deliberate change.
- [Wrench] **[CLI]** **The CLI Can Choose Scanners, Visibility and Teams**
  The command-line tool started every scan with nothing but the URL, whatever the web app or the API allowed. It now takes --scanners to run only the categories a pipeline cares about, --public or --private to decide whether the result is listed in the public directory, and --team-id, repeatable, to share the result with the teams that need it. A rate-limited start waits for the time the server asks and tries again instead of failing the build, every request identifies itself as the CLI, and --version prints the version. Its tests now check what the tool sends, not only how it reacts to the reply.
- [Wrench] **[CLI]** **CI Templates Match the CLI**
  The GitHub Action and the GitLab template now behave like the CLI where they had drifted from it. One failed status poll no longer fails the build: five in a row do. They exit 1 only when a threshold was exceeded and 2 when the scan could not run, so a pipeline can let an outage through while findings still block. The GitLab template's timeout follows the scan instead of a flat five minutes that failed crawls the server was still running, and both build the request body with a JSON encoder, so a URL containing a quote no longer breaks the request.
- [Eye] **[EXTENSION]** **The Extension's Privacy Statements Match What It Sends**
  The browser extension's Site Alerts are on by default and look up every site you open, sending its hostname and page URL at most once every 45 seconds per site. Its own Privacy settings said the extension sent a URL only when you scanned, and the privacy policy described page lookups as an optional feature you had to turn on and said page titles were sent, which they are not. All three now say what happens, including that the lookup reads existing scans without storing the address and how to switch it off. A test keeps the policy's interval in step with the extension.
- [Keyboard] **[ACCESSIBILITY]** **Everything Draggable Now Works From the Keyboard**
  The profile picture cropper could only be repositioned by dragging, and the assistant panel's resize handles were mouse-only elements with no name and no focus. The cropper now moves with the arrow keys (hold Shift for larger steps). The resize handles are focusable, labelled separators that respond to the arrow keys, Home and End.
- [Eye] **[ACCESSIBILITY]** **Menus That Claimed to Hide the Page Behind Them Now Do**
  The admin and documentation mobile menus told screen readers the rest of the page was unavailable, but never actually made it so, and a swipe could still reach it. The page behind an open menu is now inert, matching every other modal. Two touch targets smaller than 24 pixels were also enlarged.
- [Container] **[SELFHOST]** **Copying .env.example No Longer Breaks Signup**
  The example environment file shipped a Turnstile site key placeholder uncommented. The captcha switches on when that variable is present, but its secret was still unset, so on a fresh install copied exactly as the README instructs, signup, password reset and the contact form all failed. It is commented out like every other credential. The quick-start also told you to run a database initialisation script that actually creates a second, unused database; the schema already creates itself on first start, and that step is gone.
- [Activity] **[SELFHOST]** **Container Health Checks Pass**
  The app redirects plain-HTTP requests to https, and it applied that to every direct request, because the server fills in the forwarded-protocol header itself when no proxy has. The image's health check calls the health endpoint over plain HTTP from inside the container, followed the redirect to a port that does not speak TLS, and failed, so every Docker and docker-compose install reported unhealthy. The health endpoint is never redirected now. The CI smoke test had passed throughout, because the tool it used counts a redirect as success; it now requires a real 200 and runs the image's own health check.
- [Lock] **[SELFHOST]** **Plain-HTTP Deployments Can Stay Signed In**
  ALLOW_INSECURE_HTTP=1 is the documented way to run with no TLS on a trusted network, and signing in never worked with it. The session cookie, and every other sign-in cookie, was marked Secure whenever the app ran in production, and a browser discards a Secure cookie that arrives over plain HTTP. Eleven places set those cookies and decided the attribute in two different ways, neither of which read the flag. They share one rule now, with a test that fails if a cookie option decides it on its own again.
- [Activity] **[SELFHOST]** **An Incomplete Test Run Cannot Pass Quietly**
  The guard that fails a test run when a worker never started counted only the main test folder, so a run that lost the browser extension's suites still matched the number on disk. It now counts every folder the runner collects.
- [Activity] **[ADMIN]** **Clear Stuck Scans From the Admin Panel**
  The scanner queue card already flagged a scan stuck past every timeout, and clearing it still meant waiting for the background sweep, restarting the server, or editing the database. An admin can now fail stuck scans from the card. It runs the same sweep the timer runs, so it only touches scans old enough that no healthy run could still own them, and it says so when nothing qualifies. That sweep also ignored the bulk scan budget: an operator who raised it had the tail of a long bulk batch marked as interrupted by a restart while those scans were still waiting their turn. The budget now counts.
- [Mail] **[ADMIN]** **Resend a Verification Email From the Admin Panel**
  When someone never received their verification email, staff could only mark the address verified without knowing it worked, or ask the user to find the resend link themselves. The user's page in the admin panel now has Resend Verification, which sends the same fresh single-use link as the public resend flow to the address already on the account. It is audit-logged, uses the same permission as manual verification, and refuses an address that is already verified.
- [ShieldAlert] **[ADMIN]** **The Updater Will Not Downgrade You**
  An install newer than the latest published release, such as a build from the main branch, was offered Update now, and taking it would have installed the older release over the newer code, run its dependency install and applied its migrations to a schema they did not write. The button is off in that state and says why, and the update job itself refuses any release older than the running version, whichever way it is started.
- [Settings] **[SELFHOST]** **Clearer Self-Hosting Configuration**
  DATABASE_SSL_CA was documented as accepting a file path, but only the certificate contents work; a path left the app unable to connect at startup. The AI model guidance said 200K tokens of context and then recommended 128K models; the real requirement is about 300K, and the examples now show which models meet it. The placeholder Stripe publishable key is commented out, and the Stripe and Turnstile client keys now warn that a pulled Docker image must be rebuilt with docker compose build app to use them. MIGRATION_BACKUP_RETENTION_DAYS is documented for the first time.
- [BookOpen] **[SELFHOST]** **Documentation Checked Against the Code**
  The documentation was verified claim by claim. Corrected: when the schema version check runs (at startup, not on the first scan), which permissions each staff role holds (two listed capabilities do not exist), that a scan can be shared with several teams, that a support ticket can be shared with several teammates, how AI code review scores confidence, the number of report formats, the Node and test runner version requirements, Dependabot's auto-merge rules, how long a Discord sign-in link lasts, the GitLab CI template's crawl page limit (25 to 250 by plan, not 15), and the extension's TypeScript version. The version and toolchain numbers are now checked against the code by tests.
- [ShieldCheck] **[SELFHOST]** **A Release Is Only Published From a Commit That Passed CI**
  Publishing a release image never checked that the commit being released had passed CI, and branch protection could not help because a tag is not a merge. A tag pushed on a failing commit, or pushed a few seconds after its commit while CI was still running, built, signed and published an image that every instance's updater would then offer. The publish workflow now waits for CI on that exact commit and stops unless it passed.
- [GitMerge] **[SELFHOST]** **CI Catches More Before It Ships**
  Integration tests ran against a different Postgres version than docker-compose installs, so they verified a database no self-hoster runs; they now match. The extension gained the same lockfile check the app has, which catches a lockfile regenerated on Windows before it breaks a Linux build. New tests keep facts that live in more than one place in agreement: the app version across package.json, the config and docker-compose; all 52 plan limits between billing and enforcement; the Stripe webhook events the app subscribes to and the ones it handles; and a single list of the database upserts both schema checks allow.
- [Trash2] **[REMOVED]** **Checks That Could Never Report Anything**
  Fifty checks had been retired over earlier releases, each for a sound reason: a duplicate of another check, a header browsers no longer use, a key that is public by design. Three more were described in the catalog and never implemented, one of them recommending forensic DMARC reports that most receivers no longer send. The retired detectors were reduced to returning nothing, but the checks stayed defined, so they were still counted in the advertised total and still had a page in the checks catalog, a few with titles admitting they were disabled duplicates. They are gone, and the count moves from 905+ to 855+, the number a scan actually runs. Three pages that stated a different severity from the finding a scan produces now state the same one. Separately, 111 detectors that could not run at all were deleted: 38 had no definition, and 73 were second or third copies of a check implemented in another file, some with tests that passed while the code they tested never ran. Tests now fail on all three.
- [Trash2] **[REMOVED]** **Code Nothing Used**
  About 260 lines removed after checking every import, script, worker and test. Eight of the animation module's thirteen exports had no users, including a second, weaker copy of the class-name helper that was easy to import by mistake. A deprecated IP address helper still had three callers five months after its deprecation; those now call the real function and the wrapper is gone. Several other unused exports and types went with them.
- [ShieldAlert] **[CHANGED]** **Engine Version 3.4.0**
  The detection engine moves from 3.3.2 to 3.4.0. Scan results change for the reasons in the Engine & Checks section: pages are read the way a browser acts on them, error pages are matched by their own markup, two new certificate findings, and fifty retired checks leave the catalog. Finding identifiers for the checks that remain are unchanged, so triage marks and regression baselines carry over.
- [Gauge] **[CHANGED]** **Four Findings Lowered to Low Severity**
  Access-Control-Allow-Origin: * (browsers never send credentials to a wildcard), published Swagger or OpenAPI documentation, TRACE listed in an Allow header, and GraphQL introspection text found by keyword. Each overstated what the check can observe. The confirmed versions, from the active HTTP method probe and the live introspection query, keep medium severity. A CI gate set to fail on medium no longer trips on these four.
- [Package] **[CHANGED]** **Dependency Updates**
  React 19.3, the Stripe SDKs, jose, nodemailer and zod, the Anthropic and OpenAI AI SDK providers, lucide-react, the TypeScript ESLint packages, and the browser extension's build toolchain.

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
- **Total changes documented:** 914
- **Latest:** v4.0.0 (Unreleased) - The Things That Were Written Down Twice
- **Earliest:** v1.0.0 (February 9, 2026) - First Release
