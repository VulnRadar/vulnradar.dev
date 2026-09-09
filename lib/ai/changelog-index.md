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

## v3.9.1 - September 8, 2026
**Handed the Whole Book, Remembering None of It**

The assistant kept forgetting the changelog seconds after being handed it, and the reason was that we were handing it too much. Loading /changelog sent the complete release history, every description of every change since the first version, in a single message: half a megabyte, about 107,000 tokens, for one slash command. Nothing rejected it, which is why it went unnoticed for two releases. It simply crowded out everything else, and the request went out twice because a stale copy of the previous load was still in the array beside the fresh one. That command now sends a compact index instead, with the recent releases in full and every older one still listed, and the full history stays behind the retrieval that pulls in whatever an actual question matches. A test now measures the real files against the real budget, so the next one to outgrow it fails a build rather than quietly costing somebody the context they just loaded. The chat sheet on a phone also stopped being a desktop panel stretched to fit.

### Changes
- [Bot] **[FIXED]** **The Assistant Forgot the Changelog Seconds After Being Handed It**
  Typing /changelog loaded the entire release history into the conversation: every change of every version, 506 KB, about 107,000 tokens measured against the model, in one message. It had grown there one release at a time, and the last one added ninety-eight entries. Nothing errored. The request was accepted, the reply came back, and the assistant answered as though it had never seen a changelog, which is the worst way for this to fail because there is nothing to look at. The command now sends an index: the newest releases with every description intact, then change titles for the ones behind them, then a line each for the rest, so every release we have ever shipped is still named and the recent detail is still there in full. The complete history stays on disk as the retrieval corpus, so asking about a release from six months ago still pulls that entire entry in beside the question. Same trick /checks has used since it outgrew a single message, applied to the file that outgrew it next.
- [Layers] **[FIXED]** **Every Loaded Command Was Sent Twice**
  Both places that build the message list for the AI appended the freshly loaded context by hand, because React had not yet applied the state update that put it there, and neither removed the previous copy sitting in the array they were appending to. So each loaded command went over the wire twice. There was a deduplication step meant to prevent exactly this, and it tested a field that nothing in the codebase ever sets: a leftover from a context pill that was removed when commands were made to load silently, still read in six places, always undefined, so the guard that asks whether a command is already loaded always answered no and reloaded it. With the changelog at half a megabyte that made a request over a megabyte, which is also the default body limit of nginx, and the chat route then dropped one of the two for exceeding its context budget. Both send paths now go through one function that keeps the newest block per command, and the dead field and the pill it belonged to are gone.
- [Gauge] **[ADDED]** **A Budget Whose Comment Was Two Releases Out of Date**
  The chat route splits its input allowance between conversation turns and the knowledge the slash commands load, and it skips anything over the larger budget. The number was chosen to fit every command loaded at once, and the comment beside it listed their sizes: changelog around 250k, docs around 100k. The changelog was 506k by then, and the five of them together no longer fit, so loading a second command silently cost you the first. The sizes were in a comment because nothing measured them. Now a test does, against the constant itself, and it fails with the actual file sizes and the instruction to serve the biggest one from an index rather than to raise the number. It also fails if a single command ever exceeds 200 KB on its own, and if either command with an index is ever changed to read the full file first.
- [Smartphone] **[FIXED]** **The Chat Sheet on a Phone Was a Desktop Panel Stretched to Fit**
  The panel is a 420-pixel widget beside the page on a desktop and a full-screen sheet on a phone, and every size in it was picked for the first one. Replies were 14px, smaller than any other body text in the app, on a surface that on a phone is the whole screen. Code blocks and tables inside those replies were 11px, and the reasoning block 10px. The three context shortcuts under the greeting, the first thing the assistant shows anyone, were 10px type in a chip twenty pixels tall: too small to read and under half the width a thumb reliably hits. The send and slash buttons were 36px squares. All of it now steps up below the desktop breakpoint and is untouched above it, the two composer buttons grow their touch target past the box rather than growing the box, and the disclaimer strip folds away while the keyboard is up, which is exactly when the sheet has no room to spare and the reply being waited on is what should be on screen.
- [CalendarClock] **[FIXED]** **A Generated File Recorded the Day It Was Generated**
  All six knowledge compilers stamped the build date into their output, and CI regenerates every one of them and fails on any difference. That was survivable for the markdown, because the drift check ignores lines matching "compiled from" and the date sat on such a line. It was not survivable for the search index built from those files: that is one unsplittable line of JSON, the ignore rule cannot reach inside it, and the date came in anyway as indexed text. So any commit made near midnight UTC was one CI run away from failing on a diff nobody wrote, and the comment in that file already claimed it was a pure function of its inputs. The date is gone from all six. Running the compilers twice now produces byte-identical output, which is the only property the check was ever asking for.

---

## v3.9.0 - September 8, 2026 **(highlights)**
**Things That Fail Without Saying So**

Ninety-eight changes, and the thread running through nearly all of them is the same: something that failed without saying so. An alert that marked itself as sent before trying, and so went quiet for the rest of the outage. A weekly email that could arrive every six hours. A scan that answered with a full report it had never saved. Workers that recorded a healthy pass when every item in it had failed. A daily limit that stopped applying the moment the database struggled, and a scan that reported four sections as clear without running them. Seventeen of the entries are security: a share link that republished the address somebody else had typed, complete with the token in it; impersonation that could change an account's email and password and leave no trace; subscription events keyed on the customer rather than the subscription, so an abandoned plan could cancel a live one; and a data export that promised everything it held on you and named a third of it. The admin panel had a header that let rows paint through it, placeholders that drew a different shape from the thing arriving, and roles that could not use the permissions they were given. Every contact link on the site went to an error page, and the fix was to stop putting addresses in the page at all. Along the way the scanner learned fourteen new checks, our own accounts got short links on our own domain, and verified domains got a page of their own.

### Changes
- [Bot] **[FIXED]** **The Chat Answer Arrived All At Once**
  The assistant streams its reply, and behind a reverse proxy you would never have known. nginx buffers proxied responses by default and nothing in the response told it not to, so the whole answer was held at the proxy and delivered in one lump the moment the model finished. It looked like the assistant thought in silence for twenty seconds and then pasted a finished paragraph. Nothing errors, no header is missing from the browser's point of view, and it only happens behind a proxy, which is a miserable combination to diagnose: the obvious conclusion is that the model is slow. The one streaming response now says it must not be buffered. That is a header the proxy reads and everything else ignores, so a self-hosted deployment streams properly with no proxy configuration at all, which is the difference between a fix and an instruction.
- [Crosshair] **[FIXED]** **A Heading That Changed Size While You Watched**
  Opening an email verification link shows a loading state, then swaps to verified, expired, already verified, or failed. All four of those outcomes use the shared heading size. The loading state did not: it was a third size belonging to neither of the two the design system has. On a phone that meant 24px while the word said Verifying and 20px a second later when the answer arrived, on the same screen, with nothing else moving. The shared component had already been fixed and its comment explains this exact problem; the copy sitting next to it had not. The staff invite page carried the same heading, copied from it.
- [Layers] **[FIXED]** **Four Pages Had Each Built the Same Error Box**
  Assets, History, Repos and Shares each grew their own dashed red panel for when a list fails to load, byte for byte the same in all four places. All four already imported the shared empty-state component. It simply had no error tone, so four people each looked for one, found nothing that fit, and wrote the fifth version of the thing that component exists to have ended. It has an error tone now, and it announces itself to a screen reader as part of that tone rather than per call site, because one of the four did announce and three did not. Also swept: the password reveal button on login, signup, password reset and staff invite was a 36 pixel target at every screen width on the most used form in the product, an icon parked halfway down a wrapping file path, an amber badge and a red toast button and a green heading that were raw palette colours and did not follow the theme, and the admin error screen, which was a hand-rolled copy of the shared one that had drifted on its corner radius, its muted text step and its button heights.
- [Shield] **[SECURITY]** **A Production Backup Was Being Copied Into Every Docker Build**
  The Docker ignore file excluded a directory called databases. That directory does not exist. The one that does is backups, which is where both the backup script and the admin panel write, and it was never excluded, so an encrypted production dump, the file holding its decryption parameters, and a 25 MB source archive were copied into the build context and the builder layer on every image build. It never reached the published image, since the final stage copies named paths only, but the context transfer and the build cache are not nothing. The notable part is how it survived: the git ignore file documents closing this exact gap, in these exact words, and the fix landed there and was never mirrored across. Two ignore files and one edit is the shape of this, so the comment now says to change both.
- [Eye] **[ADDED]** **Guards for the Two Ways This Repository Has Leaked**
  Both already happened once and neither was deliberate. A real server address sat in a worked nginx example in the security documentation for several releases, which is still in git history and in every release tarball cut from it. It is not a credential and the port answered from the internet anyway, so the damage was small, but it got there the way these always do: someone pasted a config that worked on the real machine into a document about configuring one. A test now reads the documentation and fails on any routable address, allowing the reserved and documentation ranges that belong there, plus a second check for a connection string carrying a real password. A separate test reads the git index and fails on any tracked file shaped like a database dump, which catches one added with a force flag, one landing outside the ignored directories because the backup path was configured elsewhere, and one arriving on a branch whose ignore rules predate the fix. Widening an ignore file cannot do that, because git ignores nothing it is already tracking.
- [Settings] **[FIXED]** **One Column Had Three Different Maximum Lengths**
  A second pass for values typed twice. Scan tags are capped at one length by the route that creates them, a different one by the AI that suggests them, and a third by the admin route that promotes them, so a suggestion in the gap passed validation and then failed the insert, and the admin's error message quoted a number that was not enforced anywhere. The public-path allowlist spelled out the API version by hand in twenty entries, in a file whose own header says dropping that habit was the point: on the next version bump the allowlist would have kept pointing at the old prefix, every public route would have stopped being public, and anonymous visitors would have been redirected to the login page with nothing failing at build time. Severity had two label tables that agreed on four rungs and disagreed on the fifth, so the same finding read Info on the scan page and Informational on the public pages. And three constants carried a comment asking a human to keep them equal to another constant; one of those comments was already describing a value that had changed.
- [UserCog] **[ADDED]** **Who Blocked This Domain**
  A verified domain owner can now switch scanning off for their own domain, and those rules land in the same table staff blocks do. The admin list did not return who created a rule, so the two were indistinguishable: an admin saw a domain blocked with no way to tell whether staff did it during an incident or the site's own owner opted out, and nobody to ask before lifting it. The list now says who, and a rule whose creator has since been deleted still appears rather than vanishing from the panel.
- [Container] **[CHANGED]** **The Reverse Proxy Mistakes That Give No Error**
  Four of them, all of which have bitten this deployment, and none of which logs anything: the symptom always looks like a bug somewhere else. Adding a header at the proxy appends rather than replaces, so a header the app already sends arrives twice. An unconditional connection upgrade goes out on every request rather than only on WebSocket ones, and for this app the right answer is to delete it entirely rather than make it conditional, because there are no WebSocket routes at all. The read timeout defaults to sixty seconds, which AI verification on a large scan will exceed, and that is the one layer the application cannot see or fix on the operator's behalf. And proxying to the machine's own public address requires that address to stay open to the internet, which makes the CDN in front of it optional for anyone who knows it. Two corrections to this document too, both found by an operator running a config check against it: the HTTP/2 directive it recommended does not exist before nginx 1.25.1 and refuses to start, and the loopback address it recommended is only correct once the app is actually bound there, which on a container platform is a panel setting rather than a config edit.
- [CreditCard] **[FIXED]** **Every Payment Record Has Been Storing a Blank Payment Reference**
  Stripe removed a field from the invoice object and moved it somewhere else. The webhook read it through a double type cast, which is the one form of assertion that survives a vendored type losing a field: an ordinary cast would have refused to compile, a double cast compiles against anything. So the build stayed green, the fallback beside it turned the missing value into a null, and every payment recorded since the SDK upgrade has stored nothing in the column that links it back to Stripe. Nothing crashed, which is why nobody found it. The cost only appears later, the first time somebody tries to reconcile a refund or open a charge from an admin screen and there is no reference to follow. The same removal had a second victim: the subscription cancel path read a period-end field that had also moved, which would have thrown after the cancellation was already committed, telling the caller it had failed when it had succeeded. A test now fails the build if that cast returns to any of the billing files, because the next SDK update will remove another field and the cast is what decides whether that is a compile error or six months of quiet data loss.
- [Puzzle] **[FIXED]** **Report Export Was Broken in Every Chrome Build of the Extension**
  The extension builds a file for download inside its background worker, using a browser function that is not available in a background worker at all. Every PDF, SARIF, Markdown and JSON export threw immediately, and the popup printed the raw error text in its export banner. Firefox was unaffected, because its extensions use a different background type that does have the function. It compiled because the extension's TypeScript config offers both environments to the whole source tree, so nothing flagged the mismatch. Four more bugs went with it. Every row in Recent Scans opened the dashboard instead of the scan, because scan ids became opaque strings and the popup still tested whether the id was greater than zero. Opening the popup spent a daily scan quota unit, and kept spending one on every open for anyone with no scans yet, because an empty result left the cache empty and the cache being empty was the thing that triggered the fetch. Turning every check family off in Options ran every check family, because the API reads an empty selection as no selection. And a scan that never finished was drawn as a clean one, since an abandoned scan and a genuinely clean scan carry the same zero counts unless you read its status.
- [Keyboard] **[FIXED]** **The CLI's JSON Output Was Not JSON**
  Piping the CLI's machine-readable mode into anything failed, because the human progress and summary lines were printed around the document rather than beside it. The evidence was sitting in the repository already: the CLI's own test could not parse its output and had to cut the JSON out by string index. Those lines go to the error stream now when JSON is requested, and the test parses the whole thing. Flag handling was rebuilt around the same theme: passing one flag where another expected a value silently ate both and produced an authentication failure with nothing to connect it to, a trailing value-flag told you to supply the flag you had just supplied, an unknown flag printed bare usage with no complaint, and only the last of several bad flags was ever mentioned. A zero timeout is now refused, since it reports a timeout without ever checking on a scan that is running perfectly well. The docs page also contradicted itself about how to install, in two paragraphs on the same screen.
- [Database] **[FIXED]** **A Migration Could Run Its Destructive Steps With No Backup**
  The pre-migration backup checks for the standard Postgres dump tool and, not finding it, warned and carried on. The caller never checked, so the migration proceeded to its schema changes, including destructive ones, which are approved automatically when there is no terminal attached. The hosts that cannot install that tool, a Node-only panel egg or a minimal container, are exactly the hosts that were migrating with no safety net. The backup script already contained a pure-JavaScript dumper written for those hosts; it simply was not wired into this path. Whether the tool exists now decides how the dump is produced, not whether one is produced. Two repair scripts also exited successfully when every repair in them had failed, and exited successfully when they had refused to run at all for want of an interactive confirmation, both of which read as a clean run to anything scheduling them.
- [CheckCheck] **[FIXED]** **The Guard Against Silent Test Loss Could Itself Fail Silently**
  The suite has a reporter that fails the run when fewer test files execute than exist on disk, because the worker pool occasionally drops one and the run still reports success. That reporter is wired in by the name of a lifecycle hook, which is its own version of the same problem: a hook renamed in a future version of the test runner would stop calling it, the suite would go back to passing with files missing, and nothing would say so. It nearly happened on the last major upgrade, and survived only because someone had kept both the old and new hook names. The check is anchored to process exit as well now, which no API change can rename: if neither hook fired, the run fails and says the hook has probably been renamed.
- [Mail] **[CHANGED]** **The Emails Were White**
  Every message the product sent rendered as a white card on a pale grey canvas, while the product itself is dark on every surface a user actually looks at. Mail arrived looking like it came from a different company. The reasoning behind it was defensible and written down, that email is read on a white background more often than not, but the result was a brand that stopped at the inbox. Messages are dark now, and the part that matters is not the colours: a dark email's real failure mode is a client deciding to helpfully invert it, so the message declares its scheme in both a meta tag and its stylesheet, which is what Gmail and Apple Mail read before deciding whether to interfere. Outlook.com is the exception, since it rewrites the document instead of answering the question, so the rules that used to introduce dark colours there now put them back. Verified by rendering a real message and reading the output rather than the source: the only white left is the label on the blue button.
- [Radar] **[FIXED]** **One Fact, Reported Once**
  A domain that had simply never switched DNSSEC on came back with three findings: an informational note saying DNSSEC was not enabled, and two medium findings saying the DS and DNSKEY records were absent, which is what not enabled means. Three entries, one fact, and the two mediums outranked the note that actually explained it. Those two records answer different questions, though: DNSKEY says whether the zone signs itself and DS says whether the parent delegates trust to it, and the four combinations of those are four different situations. Each check now owns exactly one. An unsigned zone gets the note and nothing else. A signed zone whose registrar never got the DS record gets told that specifically, which is the state where all the work has been done and none of the protection is being received. And a zone whose parent publishes a DS while the zone itself publishes no keys gets the finding nothing used to distinguish: every validating resolver on the internet refuses to answer for that domain at all, while it resolves perfectly from the operator's own machine.
- [ShieldCheck] **[FIXED]** **Four Headers That Were Not Findings**
  Missing Referrer-Policy was reported as leaking the full URL on external navigation. That stopped being true in 2020: every browser since defaults to strict-origin-when-cross-origin with no header set, so the path and query a token would sit in are already not being sent. Missing X-XSS-Protection was worse than wrong, because acting on it meant re-enabling a filter that no browser still ships and that shipped its own exploitable bugs before being removed, and the same file already declined to flag the value that switches it off. Origin-Agent-Cluster is a memory hint the spec says a browser may ignore, and the identical check in another file was already stubbed for that reason. X-Permitted-Cross-Domain-Policies protected Flash, which has been gone since 2020, so its absence now authorises nothing; an explicitly permissive value is still reported, because someone set that on purpose. Four checks that fired on almost every site scanned, none of which described a defect.
- [Bug] **[FIXED]** **The XSS Check Was Looking For The Wrong String**
  A high-severity check searched the page for the text javascript:, case-insensitively, anywhere at all. href="javascript:void(0)" is a twenty-year-old placeholder idiom still sitting on an enormous share of the web and does nothing, so this reported HIGH against sites that had done nothing wrong. Its second pattern searched for dangerous calls inside script tags, in a copy of the page the script tags had already been stripped from, so it could never match. Meanwhile a correct implementation of the same check existed in another file, matching a URL-derived value written into a page-rendering sink, and it had never run once: a check resolves through the file that owns its definition, and that was not the file. The real one is now in the right place. A javascript: URI is reported only when its payload actually reads cookies or URL data.
- [FileSearch] **[FIXED]** **Checks That Fired On Prose, And One That Never Fired At All**
  Reporting a weak cipher matched the word rather than the call, so an article explaining why not to use Blowfish scored worse than a page that used MD5, and one of its five patterns was a typo that matched nothing in any language. Hardcoded IP addresses matched four-part version numbers, which have exactly the same shape. Sensitive keywords in HTML comments fired on "password reset form", a comment that labels a form and discloses nothing, which is on most login pages. And the mass-assignment check had never fired in its life: it looked for the absence of validation by searching the page for zod|joi|yup|ajv|validate|schema|safeParse|parse as raw substrings, and joi is inside .join(, parse is inside JSON.parse, and schema is inside the schema.org URL that every page with structured data carries. Something always matched, so it always concluded the code was validated. Each of these now looks for the thing itself: a call, an address in a place an address goes, a keyword attached to an actual value, and validation near the code being judged rather than anywhere in a 200KB bundle.
- [AlertTriangle] **[FIXED]** **A 2021 CVE Cited At Every Grafana Ever Scanned**
  Finding a Grafana version disclosed in a response attached CVE-2021-43798 to it, an unauthenticated file read on CISA's Known Exploited Vulnerabilities list, with no comparison against the version it had just read. A current Grafana 11 was handed a critical advisory it has not been vulnerable to for four years. That is the kind of finding that teaches a reader to stop believing the report, which costs more than the finding was ever worth. The version is right there in the evidence, so it gets compared now, and the comparison is a table rather than one bound because the fix was backported to each 8.x line separately: 8.2.7 is patched and 8.3.0, a later release, is not.
- [MessageSquare] **[SECURITY]** **Anyone Could Rewrite Someone Else's Chat History**
  The support chat stores each conversation under a session id the browser picks, and saves the whole thread back after every exchange. The save had no ownership check on it, so knowing another account's session id was enough to replace that conversation's messages outright, and because the update never touched the owner field the row kept the victim's name on it. Staff reading the conversation in the admin panel would have been reading attacker-written text attributed to a real user. Saving is now scoped to the account that owns the thread. A signed-out conversation stays adoptable, which it has to be: the widget works signed out, and someone who logs in halfway through would otherwise be locked out of their own thread one message in. Adoption only ever fills an empty owner, so signing in can never move a conversation off the account that already holds it.
- [Users] **[FIXED]** **Plan Limits That Two Clicks Could Walk Past**
  Creating an API key, a webhook, a team or a team invite each counted what you already had, compared it against your plan, and then wrote the new row as a separate step. Two requests arriving together both read the count taken before either of them wrote, so both passed the check and the account ended up over its limit, with nothing afterwards that would ever notice. Every one of these now re-applies the cap as part of the write itself, so the answer the count gave is still true at the moment the row lands. Creating a team needed more than that: it already runs in a transaction, and inside one the other request's uncommitted row is invisible, so it takes a short per-user lock the way reserving a scan slot already does. Accepting a team invitation got the same treatment for a different reason: two clicks on the same emailed link raced past the already-a-member check and collided on a uniqueness constraint, so the second click was answered with a server error instead of "you already accepted this".
- [MailOpen] **[ADDED]** **Broadcasts Started From A Blank Textarea**
  Every message this product sends on its own has a written template behind it, built from the same blocks, reviewed once and correct afterwards. The messages a person writes had none: the broadcast composer offered an empty box whose placeholder said HTML tags are supported, which is an accurate description of a blank page. So the announcement that reaches every registered account was whatever markup somebody managed that afternoon, in a product whose voice is otherwise pinned down to the paragraph. Two of the notification preference columns that gate these, product updates and tips, had existed for months with nothing behind them at all. There are seven templates now: release notes, a feature spotlight, a launch, an offer, a nudge about teams, a tip, and a note to someone who has not scanned in a long time. Picking one fills the subject, the body and the preference filter together, which is the part that matters: choosing an audience by hand is how a broadcast reaches people who switched off exactly that kind of message. The release template also fills itself from the newest changelog entry, because the changelog is the considered version of what shipped and retyping it into an email produces a worse summary every time.
- [ShieldAlert] **[SECURITY]** **A Button Label Was The One String Nobody Escaped**
  Found by the first test written against the new templates rather than by review. The email button block escapes the address it links to, because until now every template that rendered one built that address from a constant plus a server-generated token, and nothing had ever passed it a label a person typed. Two of the new templates let the writer choose the label, which made an admin-composed string the input to unescaped markup in a message that goes to every registered account. Labels are escaped and a writer-chosen path is reduced to the characters a path can hold before it is appended, so what is left can only ever be a path on this deployment.
- [ScanSearch] **[ADDED]** **Fourteen New Checks, Weighted Toward What Actually Goes Wrong**
  A gap analysis against what the scanner already covers, rather than a list of headers nobody sets. Four are about CSP, because a policy that exists and does nothing is worse than no policy: script-src that allowlists a CDN anyone can publish a package to, which is the finding Google's own CSP Evaluator exists for; a nonce that is a template placeholder the renderer never substituted, or short enough to guess, which makes the whole nonce-based policy decorative; and the two directives people put in a meta tag believing they work, frame-ancestors and X-Frame-Options, neither of which any browser honours there. Four are credentials rendered into pages: S3, Azure and Cloud Storage signed URLs, each a bearer token shaped like a link, plus the https://user:password@host form that people reach for when wiring an internal service in quickly. One is a cache defect with no attacker in it at all, a response marked shared-cacheable that also sets a session cookie, so the CDN hands the next visitor somebody else's session. And a password field rendered with a value attribute, which means the server wrote a real password into markup that is now in the browser cache and the back-button history. Three more are file probes on requests already being made: .DS_Store, verified by its magic bytes rather than by a 200 so it does not fire on every catch-all server, Apache's mod_status page, and MCP server configs, which are the new .env and carry provider tokens inline.
- [FileSearch] **[ADDED]** **The security.txt Check Fetched The File And Never Read It**
  It asked whether the response was a 200 and returned. RFC 9116 makes Expires a required field precisely so the contact details cannot rot unnoticed, and it tells researchers not to rely on an expired file, so a stale date closes the disclosure channel from their side while the file is still being served: somebody who found something in your site is now looking for another way to report it. Both cases are reported now, expired and absent, and neither costs a request, because the body was already in hand and being thrown away. Four more outdated-library ranges landed alongside, including DOMPurify, which deserved its own entry rather than another row: it is the sanitizer this product's own remediation steps recommend, so an outdated one undermines the advice attached to every XSS finding in the same report. While in that file, the Moment.js pattern was a bare match on the word and also fired on momentum.js, a different library that has never had the CVE.
- [Radar] **[FIXED]** **VulnRadar Scanned By VulnRadar**
  The homepage passes all 852 checks. Our own reference pages, the seven hundred and fifty that exist to explain each check by showing the vulnerable code, did not, and the reason turned out to be a bug that affects every customer with a documentation page. Next.js streams a server-rendered page back as data carrying the page's own prose as a JavaScript string, so any page that so much as mentions eval in a paragraph contains that text inside a script tag, and about twenty checks read it as the site calling eval. Writing about a vulnerability scored as having one. One file had carried the right filter privately for months while its siblings kept the old behaviour, which is the shape of bug this codebase keeps finding. Worse was a suppression rule meant for API documentation: it switched off all four leaked-secret checks, one of them critical, whenever a page contained the words documentation, example and api anywhere at all. That is not a documentation page, it is most websites, and a footer with two links was enough. A genuinely leaked key on such a page would never have been reported. It now asks the question per match instead of per page: a key shown inside a code block is being demonstrated, and the same key anywhere else is still a finding.
- [Globe] **[ADDED]** **Look This Up Somewhere Else**
  A scan result now carries links to fourteen third-party services for the same target: VirusTotal, urlscan, Google Safe Browsing and Cloudflare Radar for whether anyone has already flagged it; Shodan, crt.sh, DNSViz and BGP.tools for what is behind it; SSL Labs, Mozilla Observatory, Hardenize and MXToolbox for a second opinion that grades its own test; and the Wayback Machine and SecurityTrails for what the address used to be. Every one is a link and nothing else, which is the entire design rather than a shortcut around it. An API integration would mean paying per lookup for other people's targets, submitting those targets to a third party under our account with nobody having agreed to that, and caching an opinion about somebody's site that goes stale and then gets served as though it were current. A link has none of those properties and is honest about where the answer came from. Services that fetch the target themselves are marked, because opening one puts a visit in somebody else's logs that you caused. A private or internal target gets no links at all: sending an internal address to a third party as a side effect of a click that could not have answered anything is not a trade worth making.
- [ShieldAlert] **[SECURITY]** **An Admin Delete That Answered To Three Names And Checked One**
  The admin panel asks for the administrator's password again before permanently deleting an account, which is the control that contains a hijacked admin session. The handler accepted three different action names for that delete and the password gate knew only one of them, so anyone holding a stolen admin session but not the password could send a synonym and purge an account with the prompt never appearing. The suite had an exclusion list recording that those synonyms existed and that nothing sends them, which is exactly how it survived review. The handler answers to one name now, and the other two are refused before anything runs. Alongside it: enabling two-factor authentication was the one privilege change that left existing sessions standing, so the most common reaction to a suspected compromise left the attacker logged in while the account displayed 2FA enabled. And an API key minted from a stolen session outlived every credential a password reset clears, so the one thing the product tells a compromised user to do left the attacker with full API access. Both now end when they should.
- [Eye] **[SECURITY]** **Support Staff Could Read Every Customer's Webhook Secrets**
  Opening a user in the admin panel returned their webhooks in full, and for a Slack or Discord hook the URL is the credential: whoever holds it can post into that customer's channel. The neighbouring cards on that same panel had each been narrowed to their own permission in an earlier pass, with a comment explaining that scan rows are somebody's browsing history and key rows name live credentials, and the webhook and scheduled-scan reads were simply left behind on the general may-look-at-accounts permission. So the lowest staff tier, one that holds no ability to change anything at all, could walk the user list and collect the whole customer base's incoming-webhook secrets. The panel shows the host now, which is what it needed in order to say which service a hook points at, and the rest of the URL stays where it belongs.
- [Lock] **[SECURITY]** **The Lockout Message Told You Whether An Account Existed**
  Everything on the login surface is careful not to confirm whether an address is registered: one identical answer for no such account and for a wrong password, a decoy password check so the two take the same time, a fixed response from signup and from forgot-password. Then the per-account lockout, which only a real account could ever trigger, said too many failed attempts for this account. Twenty-six requests from two addresses turned that into a yes or no about any email somebody cared to test, which is worth something to whoever is assembling a list. The counter is keyed on a hash of the submitted address now instead of on the account behind it, so an address that has never been registered produces the same lockout, at the same point, with the same wording.
- [CreditCard] **[FIXED]** **Two Ways To Pay Us And Get Nothing**
  Buying GitHub review credits or Browserbase minutes went through a client-side confirmation, with a webhook as the backup for the case where the tab closes or the connection drops before that confirmation lands. The backup was unreachable. All three credit types share one webhook branch, and it opened by reading the AI credit key and returning early when it was absent, which it always is for the other two: each purchase stamps exactly one key, never two. So a purchase whose tab closed took the money and granted nothing, wrote no row, sent no receipt and logged no error. The comment three lines below the early return already said the branches were meant to be independent. Separately, and worse in a quiet way, two features documented in their own files as free and unmetered were spending the user's purchased balance. The function that records token usage took a fourth argument deciding whether to charge, and it defaulted to charging, so a scan summary and a background auto-tag guess both billed against credits bought for verification simply by not passing it. The tag guess is the one that stings: it runs on its own after a scan, with nothing on screen to say it happened. The default is now to record without charging, so a caller has to write down that it wants to spend somebody's money.
- [Database] **[FIXED]** **A Backup That Restored With Duplicate Rows**
  The database dump pages through each table by keyset, which is correct, and every column is selected cast to text, which is also correct. Together they were not. A cast keeps the column's own name as the output name, and an unqualified ORDER BY resolves against the output list before the real columns, so the query ordered by the text rendering of the id while the cursor that fetched the next page compared it as an integer. Text order runs 1, 10, 100, 1000, 2. On any table bigger than one page the two disagreed, so the dump skipped rows it never emitted and repeated rows it already had. It surfaced as a restore failing on a duplicate key, which reads as bad data rather than a bad dump, and a backup that is quietly wrong is the worst thing this code can produce. The selected columns are aliased away from their own names now, so both clauses mean the column.
- [Timer] **[FIXED]** **A Check We Shipped This Morning Could Be Hung By The Page It Read**
  One of the new credential checks matched an Azure storage URL with two open-ended runs of URL characters and a question mark between them, and a question mark is itself a URL character, so on a page repeating that parameter the engine tried every possible split: nine seconds on a quarter-megabyte page. On a scanner, which exists to fetch documents chosen by somebody else, that is not slowness, it is a denial of service with the target holding the trigger. It passed every fixture, because a fixture is a well-formed example and this only appears on input nobody would write by hand. The check now finds the URL in one pass and tests the parameters separately, and there is a guard that runs every page check against twenty-three deliberately hostile shapes and fails if any one of them takes far longer than its peers. It is measured as a ratio rather than a stopwatch, because a busy machine slows everything equally and a test that fails when the runner is loaded teaches people to re-run CI instead of reading it.
- [Puzzle] **[FIXED]** **The Extension's Most Complete Setting Was The One That Scanned Least**
  Ticking every check family switched Active Probing off. The scan builder omitted the family list whenever all of them were selected, on the reasoning that sending everything is the same as sending nothing, and it is not: the API reads a missing list as run the defaults, and the active-probe catalog reads no selection as run no active probes at all. So the Options screen read 18 of 18, Active Probing was on, and it never ran. Un-ticking any unrelated family made it start working, which is the sort of behaviour nobody reports because nobody believes it. Two more in the same surface: the popup could be left on a spinner that never cleared, because a rejected background handler answers with nothing and the reply was read outside the guard, so a successful scan whose bookkeeping failed hung the window and threw the result away. And a rejected API key was invisible to the person who needed to see it: the banner checked for a saved account before it checked for a failed test, so pasting a revoked key still read Connected as, with nothing anywhere saying it had been refused.
- [Timer] **[FIXED]** **The CLI Could Not Be Stopped, And Gave Up Too Easily**
  Neither the create call nor the status polls carried a cancellation signal, and the deadline was only consulted between polls, so a connection that was accepted and never answered was never interrupted: the timeout flag decided nothing and the process sat there until the CI runner killed the whole job. At the same time it was fatally impatient in the other direction, exiting on the first non-ok poll, and a normal scan polls about sixty times while a crawl polls closer to two hundred. One blip from a proxy failed a build for a scan that was succeeding and landing in the user's history. Transient failures are retried now; a wrong key still fails immediately, because that does not fix itself. Two more things that only bite in a pipeline: JSON mode wrote to standard output on success only, and jq exits zero on empty input, so a failed run piped into jq reported as passing unless the shell had pipefail set, which is the exact opposite of what a CI gate is for. And a captive portal or a firewall challenge page surfaced as a raw parser complaint about an unexpected angle bracket rather than as what it was.
- [GitMerge] **[FIXED]** **The Extension Build Was Broken And CI Ran Around It**
  The documented build command threw before it packaged anything: the zip library moved to named exports and the import still expected a default. CI stayed green the whole time because the extension job ran the two per-target build scripts, which skip packaging entirely, so the only step never exercised was the one that produces the file uploaded to the Chrome Web Store and to Mozilla. CI now runs the real build and then checks what came out of it: both archives present, both manifests carrying the current version. Without that second half, building one target and packaging would have zipped the other target's week-old output under today's version number, which an add-on review rejects as a duplicate. The extension's own 177 tests also ran nowhere. Its package declares a test script, but the test runner is in neither its dependencies nor its lockfile: it resolved only because the repository root happens to have a copy, so the script worked on a developer's machine and would have failed outright in CI. They are part of the main suite now, which goes from 15,064 tests to 15,241.
- [List] **[FIXED]** **Your Hundred And First Scan**
  History fetched one page of a hundred and paginated that page ten at a time, so a scan at position 101 could not be reached from the product at all. The page noticed and gave advice that could not work, telling the reader to narrow the search, when the same cap applies to the filtered set: a more precise search does not reach an older scan either. There is a button now, and it appends rather than replaces, so the severity and date filters keep working the way they do today over a set that grows. Two dead controls went with it. Changing your email address returned a permission error every time for anyone with a password, because the API has always required the current password for a change to the address an account recovers through and no field ever collected it, so the input accepted typing, showed an Unsaved badge, and failed on save. And on a scan that signs in first, the screenshot and port-sweep switches rendered normally, wrote themselves into the shareable link, and were dropped in silence, because that scan goes to an endpoint whose schema does not take them. The port one also sent people off to verify a domain for a sweep that was never going to run.
- [ShieldAlert] **[SECURITY]** **Anyone Could Freeze The Whole Server With A Four Kilobyte Page**
  Three patterns in the scanner backtracked catastrophically, and the worst of them needed no account: a page of twelve meaningful bytes followed by blank lines took thirty-eight seconds to match, growing eight times for every doubling of its size. The cause is a rule worth stating plainly, because it is easy to write by accident: in a multiline pattern the start-of-line anchor matches at every newline, and the whitespace class matches newlines too, so asking for optional whitespace at the start of a line gives the engine one place to begin per line and one way to consume from each. Put a second run of optional whitespace after it and those choices multiply again. Nothing could interrupt it either, because it is one synchronous match with no pause in it, so the scan watchdog and every timeout waited alongside the process serving everybody else. The same four kilobytes now matches in a millisecond, and so does a page sixty times larger. Two more of the same shape lived in the software fingerprinting and dependency-checking code, which parse the page but are not registered checks, so the performance guard that exists for precisely this had never measured them. They use the linear tag reader the rest of the scanner already uses, and there is now a guard covering them that also checks they still find what they are for.
- [ShieldAlert] **[SECURITY]** **A Block Button That Blocked Nobody**
  The security alerts panel offered to block the account an alert was raised against. The dialog said it would block the user, the button said Block and Resolve, and the code wrote the word block_user into a column and stopped: no account change, no sessions ended, nothing. The account carried on doing whatever raised the alert. What makes this worse than a button that does nothing is what it wrote next, because the audit log then recorded that the user had been blocked, so anyone reading the trail weeks later would conclude the incident had been handled. It blocks now, with the same three protections the user panel's disable action already applies, and it writes the same kind of audit entry so an account disabled from an alert looks identical in the log to one disabled by hand. Alongside it, an action named for ending sessions was also revoking every API key, under the permission for the first thing only. Moderators are deliberately not trusted with the second, because revoking keys breaks a customer's integrations rather than moderating anything, and this was a way around that. The two halves are now checked separately, and the audit entry, the notification email and the response all say which of them actually happened.
- [UserCog] **[FIXED]** **The Admin Panel Asked For A Password And Then Said No**
  Eleven of the action cards on a user's admin page checked whether your role could use them before offering them, and eight did not. For a moderator that meant five buttons that were always going to fail, four of which asked for the administrator password first: you typed it in, and only then were told you did not have permission. The wasted step is the smaller half. The larger half is what it teaches, because a re-authentication prompt only works if it means something, and one that appears before failures becomes noise people click through. Checking in nineteen separate places is what let eight of them drift, so the check moved into the card itself, reading the same registry the server reads. A card and the route behind it can no longer disagree, and a new card cannot be added without one, because the compiler now requires it. Separately, a whole endpoint returning an error used to take the entire panel down rather than the tab: the audit list did not check whether its request succeeded, so an error response left it holding nothing where an array belonged, and the first thing that counted the entries threw. And three lists reported a permission denial as a fact about the product, the worst being Teams, which opened for a role the API refuses and then said this deployment had no teams.
- [ShieldAlert] **[FIXED]** **A Scan That Ran Out Of Time Said Three Checks Came Back Clean**
  When the network phase of a scan hits its ceiling, the report marks the parts that did not finish so nothing reads as a clean bill of health it never earned. That list named three sections and there are six, so the three it left out, including active probing, were reported as having run and found nothing. Active probing is the worst of them to be wrong about, because it is the slowest section and therefore the usual reason the ceiling was reached at all: the moment it gets cut short is exactly the moment the report claimed it was clear. The same mistake existed in the crawl and was fixed there some time ago, citing the audit that found it; the fix never reached the ordinary scan path, which is the one nearly every scan takes. There was a second version of it one step further along, where a failure in that phase produced an empty not-finished list, which says the same thing. Both now name every section that was planned.
- [Eye] **[SECURITY]** **A Public Page Could Publish The Link You Actually Scanned**
  The public host report copied the whole of a scan's metadata into its response rather than listing the fields it meant to publish. One of those fields records the address before any redirect, and since a scan that redirects stores the destination as its URL, that record is the only surviving copy of what was typed in. So scanning an invitation or password-reset link that bounces to a sign-in page published the original link, query string and token included, from a page that needs no account. Nothing on screen changes, because the page has always picked its fields by name: the extra ones were visible only to somebody reading the API directly. The same class of exposure was already refused for signed-in callers elsewhere in the app, with a comment naming magic-login links as the reason.
- [Gauge] **[FIXED]** **The Daily Scan Limit Stopped Being Enforced When The Database Struggled**
  Counting how many scans an account had used today swallowed any database error and answered zero. Whether a scan is allowed is decided by comparing that number against the plan's limit, so an unreadable count meant nobody had used anything and every entry point let the request through: ordinary scans, authenticated scans, bulk, crawl and the scheduled worker alike. A limit that stops applying exactly when the database is under strain is the wrong way round, and the same file already contained a version written to fail the other way, with a comment saying that if it cannot reach the database it must not issue a permit, which nothing had ever called. The failure now travels. On a scan that means an honest error rather than a free pass, since a count that could not be read belongs to a database that could not have recorded the scan either. The billing page is the one place that only displays the number, so it shows nothing rather than a zero that would tell you that you had used none of your allowance.
- [BellRing] **[FIXED]** **The Alarm Switched Itself Off At The Moment It Went Off**
  Each background worker keeps a count of consecutive failures and raises an alert once that count crosses its threshold, then stays quiet so one outage does not send an alert every minute. It marked itself as having alerted before it tried to send, and threw the send's result away. That result reports whether the alert was actually delivered, and it can come back undelivered for an ordinary reason: a webhook URL with a typo in it, one that has since been revoked, or the receiving end returning an error. So if the very first attempt failed, the worker recorded that it had alerted, and sent nothing further for the rest of the outage. The count only resets on a success, and a worker that is failing does not produce one. All five workers shared the behaviour. An alert now counts only when it was delivered, so a failed send leaves the alarm armed and the next failure tries again, with the reason logged.
- [MailOpen] **[FIXED]** **The Weekly Summary Could Arrive Every Six Hours**
  The security posture digest records the send date afterwards, in a separate write. Anything that went wrong between the email leaving and that write landing left the account still marked as due, and the job runs four times a day, so the same person received the same weekly summary again on the next pass, and again, for as long as that write kept failing. Nothing else writes that date, so nothing corrected it. Two copies of the app on the same schedule had the same outcome by a different route: both selected the same accounts and both sent. The date is now claimed before the email is sent, in a single statement that re-checks the account is genuinely due, so exactly one pass can win it. A failure after that point costs one skipped week rather than an unbounded run of duplicates, which is the right direction for email to fail in.
- [Database] **[FIXED]** **A Scan That Was Never Saved Still Answered With A Report**
  The authenticated scan endpoint writes one row, and a failure on that write was logged and then dropped. The response still came back with the full report and a 200, but with no record ID, and two guards further along read that missing ID and quietly skipped everything downstream: the auto-tagging, the scan-complete email, the critical-findings alert and the webhook delivery. A pipeline listening on that webhook saw nothing at all, which reads as nothing to report rather than nothing was recorded. The response now states outright whether the scan was persisted, and carries the reason when it was not.
- [FileDown] **[FIXED]** **Download My Data Left Out Two Thirds Of Your Data**
  The export gathers your account from every table that holds it, and its own comment said so, but it named 25 of the 65 tables in the database. The other twenty-one were not a considered exclusion list: they were tables added in the two years after the export was written, by people with no reason to know that file existed. Missing were your entire support correspondence with us, your credit top-up purchases, your verified domains, the badges you generated, your remediation notes, every metered usage record, the delivery log for webhooks you configured, and the log of mail we had sent you. All of them are in it now, along with the actions staff have taken on your account and your own export history, and the file says what is deliberately left out and why: live password-reset and verification tokens, because handing a credential back in a downloadable file is the opposite of a privacy measure, and the service's own operational records, which are not yours. A test now reads the database schema, finds every table with a column naming a person, and fails the build unless each one is either exported or written down with a reason, because the version of this fix that only listed today's tables would have been wrong again by the next release.
- [Trash2] **[SECURITY]** **A Reply On A Shared Ticket Outlived The Account That Wrote It**
  Deleting your account runs a list of erasures, and the ones written out by hand exist for a specific reason: where the database is set to null the account reference rather than remove the row, whatever you typed stays behind with only your name taken off it. That was found and fixed once, for the notes you leave on individual findings. The same shape was still live on support tickets. A ticket you opened goes with you, but a reply you wrote on a ticket somebody shared with you hung off their ticket, so the message survived your deletion on a thread its owner could still open and read, along with any access you had granted on your own tickets. Both are removed now, and the same kind of test as above reads the schema and fails when a new column pointing at a person is neither cleaned up nor written down as deliberately anonymised.
- [Share2] **[ADDED]** **A Way To Follow Along, Once, Without Being Asked Twice**
  The landing page has an invitation to follow the project, and it is deliberately the least intrusive version of that we could build. It is not a modal: nothing is blocked, nothing traps your keyboard, and scrolling past it costs nothing. It waits until you are nearly halfway down the page, so it arrives after you have seen what the scanner does rather than before. Escape closes it, the close button has a real name for a screen reader, it does not animate if your system asks for less motion, and once you dismiss it your browser remembers, so a second visit is clean. It sits above the cookie bar rather than underneath it, using the height that bar already publishes for the purpose. A self-hosted copy with no social accounts configured renders nothing at all instead of an empty box.
- [Share2] **[SECURITY]** **A Shared Report Published More Than The Report**
  A share link returned the scan's whole internal metadata record rather than the fields the report is made of. Most of what rode along was harmless, but not all of it: when a scanned URL redirects, we keep the address you originally typed so the report can warn you it scanned the page it landed on instead. Combine that with a site badge set to track whoever scanned a URL last, and the badge could republish the URL somebody else had typed, which for an invite or a password-reset link means the token in it. The response is now built from a named list of fields, the per-page records inside a crawl no longer carry our internal row numbers, and a report reached through somebody else's badge no longer carries the original address at all, for the same reason it already hides that person's notes and name.
- [BarChart3] **[SECURITY]** **Anyone Could Make The Host Score Chart Read Every Public Scan**
  The risk-score history on a public host page is matched with a text pattern rather than an indexed lookup, so answering it means reading every public scan on record. The report page beside it has been capped per visitor since it shipped and this one never was, so a single anonymous client could issue that read as fast as it liked against the busiest table we have. It now shares the same allowance, counted separately so loading a host page once costs one request against each rather than two against one.
- [ShieldCheck] **[FIXED]** **Badges Did Not Load Outside GitHub**
  Every response we send carries a header telling browsers not to load it from another site, which is right for pages and wrong for the one thing built to be embedded. A badge in a README kept working because GitHub fetches images through its own proxy, so the case everyone tested was the case that did not go through a browser at all. Pasted onto your own site, the badge was downloaded and then thrown away before it drew. The badge image now says it may be loaded from anywhere. The two badge endpoints that need your account still do not.
- [Link2] **[FIXED]** **Revoked Share Links Kept Unfurling In Chat**
  The preview card that appears when a report link is pasted into Slack or Discord was sent with instructions to cache it for a year and never check again. Revoking the link stopped the report immediately, and then the card kept showing the hostname and the count of findings anywhere the card had already been seen. A host report card had the same problem after the scan behind it was made private. Both now expire in five minutes, which still absorbs the burst of previews a freshly pasted link causes.
- [Eye] **[SECURITY]** **The Demo Scanner Handed Back A Site's Own Cookies**
  Scans that get saved strip the response headers that carry credentials before storing them, because a scan record outlives the scan. The demo scanner, which is the only one you can run without an account, skipped that step and returned the target's Set-Cookie and authentication headers word for word. It now redacts the same headers as every other scan. The checks still read the real headers, so nothing we detect changes.
- [Webhook] **[ADDED]** **Two Webhook Controls That Only Existed Over The API**
  Rotating a webhook's signing secret and looking at what had actually been delivered were both real endpoints, both documented, and both reachable only with a terminal. They are on the Webhooks page now, as two buttons on each row. History opens the recent delivery attempts underneath: what was sent, what came back, and when, with an attempt that got no response at all shown differently from one that got an error, because those are different problems. Rotate asks first, since every receiver checking signatures starts rejecting deliveries the moment it lands, and then shows the new secret once, in the same panel a brand-new webhook uses. It is the only time it is ever shown: the stored copy is encrypted and nothing reads it back.
- [Timer] **[FIXED]** **Scans Stuck On Running Are Now Cleaned Up While The Server Runs**
  The sweep that clears out scans left half-finished only ever ran when the server started up, so a scan that got stuck at any point after that stayed stuck until the next deploy. While it sat there it counted against the number of scans you are allowed to run at once, which meant a single stuck scan could quietly cost you a slot for days. The sweep now runs every five minutes as well as at startup, and it still waits well past any real scan's time limit before touching anything, so a scan that is genuinely still working is never cut short. The alert it raises also says which case it was, an unclean restart or a scan that went stale while the server was up, because those are different bugs.
- [CalendarClock] **[FIXED]** **A Scheduled Scan That Failed To Start Sat There Forever**
  When a scheduled scan was created but something went wrong in the moments before it actually began, nothing ever closed the record out. It showed on your dashboard as a scan that never finishes and it held one of your concurrent scan slots until the server restarted. Every other kind of scan already handled this; the scheduled worker was the one left behind. The record is now marked failed with the real reason, so the slot comes straight back and you can see what happened.
- [RefreshCw] **[FIXED]** **Scheduled Scans Could Run Twice And Charge Twice**
  When a lot of schedules came due at once, the worker ran them a few at a time, but the reservation that stops a second pass picking up the same schedule was sized for one scan rather than for the whole queue. Schedules near the back of a large batch had their reservation lapse while they were still waiting, so they ran a second time, scanned the site twice, and took two scans from the daily allowance instead of one. The reservation is now extended as the queue works through it, and its length is derived from the configured scan time limit rather than a fixed fifteen minutes, so raising that limit no longer brings the problem back.
- [BellRing] **[FIXED]** **Two Workers Reported A Healthy Pass With Nothing Working**
  A background worker raises an alert after a run of failed passes. Two of them counted a pass as successful as long as the pass itself did not crash, and both catch their individual failures and carry on, so a pass in which every single item failed looked identical to a clean one. The counter reset every time and the alert written for exactly that situation could never fire, however long the thing had been broken. Domain re-verification and the weekly posture digest both had it. A pass that had work to do and completed none of it now counts as a failure.
- [Database] **[FIXED]** **Automatic Backups Went Quiet After A Failed Start**
  Only one backup runs at a time, and the reservation holding that slot was not released if the backup process failed to launch at all, as opposed to failing partway through. Every backup after it, scheduled or started by hand, was turned away because one was supposedly already running, and the scheduler counted each of those refusals as a healthy night. Backups stopped and nothing said so. A launch failure now releases the slot and is recorded as a failed backup, so the next attempt runs and the alert fires.
- [CreditCard] **[FIXED]** **A Cancelled Subscription Could Cancel The Wrong One**
  If your Stripe customer record had ever ended up holding two subscriptions, an abandoned one alongside the one you were paying for, then anything that happened to the abandoned one was applied to your account instead. The most visible version of that was the abandoned subscription ending and taking your paid plan and supporter badge with it. Every subscription update now checks which subscription it is about before changing anything, and one you are not on is left alone. An account that has genuinely lapsed can still be picked up by a new subscription, so coming back is unaffected.
- [Gauge] **[FIXED]** **Out Of Order Stripe Events Could Undo A Successful Payment**
  Stripe does not promise to deliver its notifications in the order things happened, and it re-sends them when a delivery is uncertain. A subscription-created notice arriving after you had already paid wrote your account back to the free plan and removed your badge, because it carried a snapshot from before the payment. That notice is now recognised as the oldest thing that can be said about a subscription, so it cannot overwrite anything newer.
- [CreditCard] **[FIXED]** **Changing Plans Could Bill You Twice**
  When you switched plans, checkout first asked Stripe about your existing subscription so it could move that one to the new price rather than starting a second. If the question failed for any reason, including a timeout, the answer was read as there being no existing subscription and a second one was created beside the first. You were then charged for both every month with nothing in the app showing it. A failure now stops the plan change so you can try again, and only a subscription Stripe genuinely no longer has is treated as gone. Four more places had the same shape against the customer record, where a blip created a duplicate customer and detached your real subscription from your account.
- [ShieldAlert] **[FIXED]** **A Stripe Hiccup Could Downgrade An Active Subscriber**
  Looking up which plan a subscription belongs to swallowed any failure and answered with an empty value, which resolves to the free plan. One slow response from Stripe was therefore enough to drop a paying subscriber to free and revoke their supporter badge, on an event that reported itself as handled. The failure now travels, so the delivery is retried instead of being applied wrongly, and the difference between Stripe not having something and Stripe not being reachable is now something the code actually tests for.
- [Wrench] **[FIXED]** **Payment Retries Left Accounts Stuck On Past Due**
  A failed payment marked your whole account past due even when the invoice had nothing to do with your subscription: a one-off charge, the first invoice of a checkout nobody completed, or a retry against an account that had already cancelled. None of those has a later subscription payment to undo it, so the warning stayed on your billing page for good and you were emailed about a subscription you did not have. Past due is now set only when a renewal of the subscription you are actually on fails, and it clears when that renewal goes through. The same scoping fixed the mirror of it: a payment event no longer marks an account fully active again when you have already scheduled a cancellation, which used to make the pending cancellation vanish from the billing page with nothing to put it back.
- [CreditCard] **[FIXED]** **An Abandoned Checkout Could Cancel The Plan You Were Already On**
  Opening a second checkout to change plans and then not finishing it still sends us a completion notice, marked unpaid. We recorded that notice against your account without checking which subscription your account was actually on, so it wrote your plan back to free, marked you incomplete and pointed your account at the checkout you had abandoned. The plan you were paying for was still live at Stripe the whole time. An unpaid checkout can no longer move an account that is on a different live subscription. A first purchase is unaffected, because there is nothing there yet to protect.
- [LifeBuoy] **[FIXED]** **A Message Sent Through The Contact Form Could Vanish**
  Both contact forms built two emails, sent them without waiting, logged any failure to the server console and then told you we would get back to you soon. The email was the only record the message ever had. So a mail server that could not be reached, an expired password on our end, a bounce or a spam filter lost the message outright, with you told it had arrived and nobody here aware it existed. One of the categories on that form is Security Issue, and the form on the front page is used mostly by people who have no account and no other way to reach us. Submissions are now written down before anything is sent, and the send reports back whether it worked, so a mail outage costs a notification rather than the message. If we cannot record it at all you are told that plainly instead of being thanked, so you can try again or email us directly. Deleting your account removes everything you sent through either form, along with any staff invitation addressed to you, which was a live grant of a role to whoever held the link.
- [ShieldCheck] **[ADDED]** **There Was No Way To Turn A Badge Off**
  A site badge could be created and its scope changed, and the endpoint that stops one resolving has existed since the badge shipped, but nothing in the product called it. If you had embedded a badge on a site you no longer run, or simply wanted it gone, asking us was the only route. There is a Turn this badge off control on the Badge page now. It confirms first and says the part that is not obvious: you can generate a badge for that site again afterwards, but it gets a new address, so an embed you have already placed stays broken rather than quietly coming back.
- [ScanSearch] **[FIXED]** **The Demo Scan Called Four Sections Clean Without Running Them**
  A report marks the parts that did not finish so nothing reads as a clean bill of health it never earned. The demo on the front page, which is the only scan you can run without an account and therefore the whole of some visitors impression of the scanner, did not do this. Its network phase resolves to an empty list when it runs out of time, and a section that threw was treated the same way, so DNS, certificates, reputation and the exposed-file probes came back reported as run and clear. It was already calling the version of that phase whose own documentation says to use the other one when you show completeness to a person. It now uses the right one, which also names the individual sections that ran short rather than only whether the phase as a whole did. The same mistake was found and fixed in the ordinary scan path earlier in this release; this was the copy left behind.
- [CreditCard] **[FIXED]** **The Pricing Page Sold A Longer History That No Plan Buys**
  Three places on the pricing page told you paid tiers raise history retention: the hero, the billing-off explainer, and the pricing-model FAQ, which also ships as structured data and so put the claim in the search result too. Scan history is unlimited on every plan including free, so none of it was true. The same mistake was removed from the plan cards in an earlier release and three siblings survived that fix. All of them now read the retention setting rather than restating it, the way the cards and the comparison table already did.
- [Layers] **[FIXED]** **The Landing Page Quoted The Top Plan's Bulk Limit To Everyone**
  The API section and the security-teams use case both advertised up to 100 URLs in one bulk request. That is the top plan's cap, and a free account is capped at five, so following either sentence produced a refusal rather than a scan. Both now name the free number and the ceiling, read from the same catalogue the API enforces against.
- [FileSearch] **[FIXED]** **Around 770 Pages Published FAQ Markup You Could Not Read**
  The checks index, every per-check fix guide, every category page and the two tool pages emitted FAQ structured data for questions that appeared nowhere on the page. Search engines require that content to be visible, and one page family here already did it correctly. On the per-check pages it was worse than an oversight: the questions had been deliberately written to hold only answers that were not on the page, which guaranteed they could never be seen. The questions are now rendered on all of them, so the severity rationale and the standards mapping are readable rather than only machine-readable.
- [Wrench] **[FIXED]** **Prices And Quotas Typed Into Copy Instead Of Read From The Catalogue**
  The pricing page title, the four competitor comparison pages and the rate-limit documentation each wrote plan prices and daily quotas out by hand, in several cases directly beside a sentence explaining that those numbers come from the billing catalogue. Every one of them now reads it, so a price or quota change cannot leave a page advertising the old figure.
- [Share2] **[FIXED]** **Link Previews Carried No Account Attribution**
  The X card handle shipped empty with a note to fill it in once the project had an account, and the account had existed the whole time: it is already in the footer, on the landing page and in the site's structured data. The handle is derived from that same profile now, so the card, the footer and the structured data cannot name different identities, and a self-hosted copy that changes or removes its own account gets its own answer rather than ours.
- [Globe] **[FIXED]** **Two Pages Claimed Scans Run In Your Browser**
  The category pages and the API scanner page said the scanner runs from the browser and that there is no extension to install. The scan runs from our servers, which is the whole reason the result matches what a stranger on the internet sees, and there is an optional browser extension. Both now say what actually happens.
- [UserCog] **[FIXED]** **Billing And Specialist Staff Roles Could Not Use Their Own Permissions**
  The user detail panel decided whether to show its Support Actions and Danger Zone cards by asking whether the caller could disable an account, which is not a permission any card in either group actually needs. A billing account was shown you have view-only access on the one screen holding the gift and revoke actions the role exists for, and the same check hid session revocation from a security analyst and notifications and AI chat bans from a content manager. The server had always accepted all of those, so the capability was reachable by hand-crafting an API call and no other way. Each card now shows when the caller can run at least one action inside it, and every individual card stays gated on its own permission, so a role that holds one action sees the rest disabled rather than live.
- [Key] **[ADDED]** **Two-Factor Lockout Had No Way Back**
  An account that lost its authenticator and its backup codes was locked out permanently. Every route that can turn two-factor authentication off needs a signed-in session, and someone stopped at the two-factor prompt does not have one yet; admin-initiated resets are refused on purpose, and password reset is refused outright for a two-factor account. The error text told operators to send the user to an account recovery flow that had never been built, and the only real answer was editing the production database by hand. Staff can now issue a one-time recovery code from the user's admin page. It does not switch the second factor off: it mints a single backup code, emails it to the account's own verified address, and never shows it to the staff member who issued it, so getting in still needs the password, the mailbox and a staff decision. It replaces any codes the account had, it is refused for an account whose address was never verified, and it is recorded in the audit log.
- [Fingerprint] **[SECURITY]** **Staff Actions Taken While Impersonating Were Filed Against The User**
  When a staff member signed in as a user to reproduce a problem, anything they did during that session was recorded in the audit log as the user acting on their own account. The staff member appeared nowhere, and the only way to guess at it was to line the timestamps up against the start of the impersonation, which failed whenever they closed the tab instead of clicking Stop. The session row had always known who was driving it. The audit log now reads that, so an action taken through an impersonation session is filed against the staff member and says which account it was performed on behalf of.
- [FileText] **[SECURITY]** **Two Admin Actions Changed Everyone's Data Without Leaving A Record**
  Promoting an AI tag suggestion into a permanent scanner rule changes what every future scan gets labelled with, for every user, and wrote nothing to the audit log. Re-promoting an existing tag quietly rewrote it while leaving the original author's name on the row, so the second person to edit a rule left no trace at all. Forcing a database cleanup run had the same gap while deleting rows across roughly fifteen tables, including the audit log itself. Both now record who ran them and what changed, and both keep working if the audit write fails, since the work is already done by that point.
- [Lock] **[SECURITY]** **Staff Invites Could Be Sent Without Limit**
  The endpoint that emails someone an invitation to a staff role, admin included, had no rate limit of any kind. The password it asks the sending admin to re-enter could be guessed at indefinitely, and every attempt that got through mailed a role-granting link to whatever address was in the request. It now uses the same per-admin throttle the rest of the admin panel puts in front of a password prompt, checked before the password so a wrong guess costs an attempt.
- [UserCheck] **[FIXED]** **Admins Who Signed Up With Google, GitHub Or Discord Were Told Their Password Was Wrong**
  Two admin actions, sending a staff invite and applying an update, each carried their own copy of the re-enter your password check, and both read the stored password directly. An account created through a social login has no stored password, which those copies read as a wrong one, so those admins could never send an invite or install an update and were told their own password was incorrect every time. Both now use the shared check the rest of the app already uses, which treats a signed-in session as the confirmation when there is no password to re-enter.
- [Puzzle] **[FIXED]** **The Extension Showed One Page's Result For A Whole Site**
  When you open a site, the extension asks us whether it has been scanned before. That lookup can answer about the exact page or fall back to the host, and the server has preferred the exact page since it was built, with a note saying the extension always sends the page address because it knows the current tab. It never sent it. So a scan of a single repository on GitHub, or one article on a large site, was reported as the standing of every other page there. The exact address is sent now, and a result about one page is remembered against that page rather than against the whole host, so the offline fallback cannot show one page's findings for another.
- [MessageSquare] **[FIXED]** **Five Admin Actions Confirmed Themselves With Nothing In Particular**
  Every action on a user's admin page reports back with a sentence saying what it did. Five had no sentence written for them and fell back to a generic Action completed, including the two that delete every webhook or every scheduled scan on an account, where that message is the only confirmation of what was just destroyed. All five say what happened now, and the panel's own test fails if a card is added without one.
- [Fingerprint] **[SECURITY]** **Impersonation Could Change The Password And Email Of The Account It Was Impersonating**
  When staff sign in as a user to reproduce a problem, every part of the app below the admin panel sees an ordinary signed-in customer. That is the point of the feature, and it also meant six things were reachable that should never have been: changing the account's email, changing its password, turning its two-factor authentication off, enrolling a new second factor, regenerating its backup codes, and deleting it outright. None of those routes wrote so much as a log line, so there was no record either. Changing the email is the worst of them, because it redirects every future password reset, which is why the admin panel already asks for a password before doing it. All six now refuse inside an impersonation session and say which admin action to use instead, each of which asks for a password and is recorded. Cosmetic changes like the display name and avatar are deliberately still allowed, since staff reproducing a problem sometimes need them. A test reads every API route, finds the ones that write a credential, and fails the build unless each is either refused or written down with a reason.
- [CalendarClock] **[FIXED]** **Resuming A Paused Scan Ran It Immediately**
  A scheduled scan remembers when it is next due, and pausing it does not stop the clock. So a weekly scan paused for a month came back with a due date four weeks in the past, and the worker picked it up within two minutes: resuming a schedule scanned the site straight away and spent a scan from that day's allowance, instead of waiting for the next occurrence of the cadence you chose. Resuming now recalculates the next run from your frequency and preferred time. Re-enabling a schedule that was never off leaves it alone, so this cannot be used to push a due scan further out.
- [Mail] **[FIXED]** **Resend Could Mail The Whole User Base Twice From One Double Click**
  Sending an announcement is protected: it only works on a draft, and sending consumes the draft, so it cannot happen twice. Resending an already-sent announcement was checked the same way, against a state that resending does not change, so the check passed every time and the route had no rate limit of its own. Every call delivered to every account again, which meant a double-clicked button sent the same email to everyone twice, and nothing but the sender noticing would stop a third. Resending now claims the announcement in the same statement that stamps it, with a minimum gap built into that statement, so two clicks arriving together cannot both win and a repeat inside the window is refused with a message saying when it was last sent.
- [Globe] **[ADDED]** **Every Social Link Is Now An Address Of Ours**
  Our accounts were linked by pasting each platform's own URL wherever the link appeared. That works until an account moves or is renamed, at which point every copy of the old address is wrong and there is no list of where they all are. Each one now has a short link on our own domain, so the Discord invite is reachable at /discord, the repository at /github, and so on for every platform configured. They redirect, so they can be printed, put in a video description, or read out loud, and where they point is one setting rather than a search. The redirect is deliberately temporary rather than permanent, because a browser caches a permanent one indefinitely and that would outlive our ability to change it. The one thing that still names the real profile is the structured data that tells search engines which accounts are ours, because that is a statement of identity and pointing it at our own redirect would only assert that we are ourselves.
- [Mail] **[FIXED]** **The Email Button In The Footer Went To A Cloudflare Error Page**
  Clicking the mail icon in the footer led to an address at /cdn-cgi/l/email-protection instead of opening a mail client. Cloudflare has a feature that hides email addresses from scrapers: it rewrites any address in the page into that placeholder and adds a small script to turn it back into the real one in your browser. Our pages only run scripts that carry a per-request token, which is what stops an injected script from executing, and the script Cloudflare adds does not carry one. So it never ran, the address was never restored, and the link stayed pointing at the placeholder on every page. The mail icon now goes to our contact page, which cannot be rewritten and which records what you send rather than depending on mail reaching us. The addresses on the legal pages are still real ones.
- [Globe] **[CHANGED]** **Managing A Domain Is A Page Instead Of A Drawer**
  Verifying a domain unlocks a set of controls over what other people's scans of it can show: every published scan of the domain, the ability to unpublish one or revoke its share link, and a switch that stops it being scanned at all. All of that opened inside the row it belonged to, so expanding it pushed everything below it down by the height of a page, and the controls that need the most deliberation were the ones hardest to read. Each verified domain has its own page now, reached by Manage. The unverified case is unchanged and still opens in place, because it is one DNS record and it belongs to adding the domain. A domain that is not yours, or an address that is not a domain at all, gets the same answer, so the page does not reveal which is which.
- [Table2] **[FIXED]** **Admin Tables Could Shrink To Little More Than Their Own Header**
  Every table in the admin panel caps its height at a fraction of the browser window, so a long list scrolls inside the table instead of running down the page. That fraction is measured against the whole window and takes no account of the browser's own toolbars above the page, or of how far down the page the table starts. On a short window it worked out barely taller than the header row itself, so the table became a pinned header with a thin line of one row visible underneath and the rest spilling past the edge of a box no longer big enough to hold them. The cap can no longer fall below a height that holds several rows. It is still only a cap, so a table with two rows in it is still two rows tall rather than padded out to a fixed height.
- [Users] **[FIXED]** **Shared Rows Offered Teammates Buttons That Always Failed**
  The webhooks list mixes the ones you made with any a teammate shared into a team you are in, and it drew every control on all of them. Someone whose team role is view-only was shown pause, edit, send test, rotate secret and delete on a webhook they cannot change, and each one answered with a refusal. Rotating the signing secret was offered even to teammates who genuinely can edit the webhook, because that one is restricted to whoever created it. Each row now shows only what the server will actually accept from you: the controls that need write access appear for the owner and for teammates whose role allows it, rotating stays with the owner, and the delivery history stays visible to everyone who can see the row, since reading what was sent is not a change. Scheduled scans and verified domains had the same gap and got the same treatment, so pausing or deleting a shared schedule, and verifying or removing a shared domain, are offered only to the people who can actually do them.
- [Layout] **[FIXED]** **Deep Links Into The Admin Panel Loaded The Wrong Section First**
  Opening a link straight to a section other than the overview drew the overview's health list first and then swapped it for whatever you had actually asked for, because the loading placeholder was fixed to one section no matter which was on its way. Every admin section now describes its own shape in one table, and the placeholder reads the section from the address, so what you see for that first moment is the thing that arrives. The one placeholder that genuinely cannot know which section is coming, the one shown before the page's own code has loaded, now draws only the header every section shares rather than guessing.
- [Table2] **[FIXED]** **Admin Panels Jumped When Their Data Landed**
  Eleven panels drew their loading table inside a padded box with a border of its own, while the table that actually arrives sits flush against the panel header with no border. Four more drew a table, complete with a header bar and a round avatar on every row, on the way to a list that has neither of those things. Broadcasts, security alerts, site notices and blocked rules were all in that group. Every placeholder is now the shape of the thing it stands in for, several panels that drew one card now draw the number they really have, and the option to draw a bordered table has been removed rather than documented, so it cannot be picked again. The panel header also stacks on a phone the way the real one does, instead of shifting everything down by a row on arrival.
- [Activity] **[FIXED]** **The System Health Card Grew Two Rows Every Time It Loaded**
  The health list reserved six rows while the panel actually produces eight, so the card grew each time the metrics arrived, and the placeholder shown before the page loaded disagreed with the card's own. The row count is now computed by running the same function that builds the list, so adding a health check moves both at once instead of leaving them to drift.
- [Bell] **[FIXED]** **Screen Readers Were Told Nothing While An Admin Section Loaded**
  Between clicking a section and its content arriving, the admin panel announced nothing at all. Each placeholder now sits in a live region named after the destination in the navigation, read from the navigation itself rather than typed out again. The email preview also stopped pulsing for anyone whose system asks for reduced motion.
- [Table2] **[FIXED]** **Leftover Text Sat On Top Of The Pinned Header When You Scrolled An Admin Table**
  Scrolling any table in the admin panel left a thin line of the row that had just gone past painting in the band above the pinned column headers, outside the area the table is supposed to be able to draw in at all. It is a browser fault in how a scrolling box is clipped when a table pins its header and uses the merged border model, and the fix is to switch that table to the separated one with the spacing set to zero, which keeps the layout identical and the row lines single. Found by elimination against the running page rather than by reasoning about it: hiding the rows cleared the band, which proved it was real content and not an artifact of the screenshot. Two earlier attempts at this, a background on the header cells and snapping rows to the header edge, were both measured, neither was the cause, and both were taken back out.
- [Wrench] **[FIXED]** **A Warning Icon Sat Six Pixels Above Its Own Sentence**
  The cosign notice on the Updater page had its warning triangle floating above the line of text it belongs to. Every paragraph in the app is given a fixed line spacing regardless of its text size, and the small print on that notice sets no spacing of its own, so it runs twelve pixel text over a twenty-eight pixel line while the icon beside it was told to line up against a sixteen pixel one. Icons can now be told to take the spacing of the text they sit next to instead of being given a size, which is the right answer whenever the line of text is itself the thing holding the icon.
- [Mail] **[FIXED]** **Every Email Link On The Site Works Again, And The Addresses Are Better Hidden Than Before**
  Sixteen contact links, on the legal pages, the security reporting page, the contact page and several error screens, all led to a Cloudflare error page instead of opening a mail client. Cloudflare has a feature that hides addresses from scrapers by replacing them and adding a small script to put them back, and that script is blocked here: our pages only run scripts carrying a per-request token, which is what stops an injected script from executing, and the one Cloudflare adds does not carry one. Cloudflare offers no way to give it one, so the choice was to weaken the protection that blocks injected scripts, or to stop relying on their feature. We wrote our own instead, and it is a simpler idea: rather than hide the address and decode it, do not put it in the page at all. The link is delivered pointing at our contact form and becomes a real email link once the page loads. Anything reading the raw page, which is what an address harvester does, finds a contact form and no address anywhere, which is stronger than the scrambling it replaces. With scripts turned off the link still works and still goes to the contact form, rather than being dead as it was.

---

## v3.8.5 - September 6, 2026
**Whose Domain Is It**

Verifying a domain unlocked the intrusive scans and nothing else. It said nothing about the scans other people run against your domain, which is the half an owner actually cares about: anyone could point VulnRadar at your site, publish the result, and it appeared on the public feed and on your host page with your findings in it. You now get the list, the controls to take it out of public view, and a switch that stops the domain being scanned at all. Alongside that: the assistant stopped answering to the underlying model's name, repo scans stopped silently returning nothing on an Anthropic endpoint, the icons across the app line up with the text beside them, and a pass for hardcoded values found four settings that were being overridden by the literal sitting next to them.

### Changes
- [Shield] **[ADDED]** **You Can Finally Do Something About Scans of Your Own Domain**
  Proving you own a domain unlocked active probing, port sweeps and authenticated scans. It gave you nothing at all about the scans OTHER accounts run against you, which is the part a domain owner actually cares about: anyone could scan your site, mark the result public, and that report then sat on the public scan feed and on your domain's host page carrying your findings, with no list you could see and nothing you could do. Open Manage on a verified domain and there are three things now. The list is every scan of the domain a signed-out stranger can already read, whoever ran it, published ones and ones behind an unlisted share link. Private scans other people ran are deliberately not in it: those are their own record, they expose nothing about your domain, and showing them would turn domain verification into a way to watch other accounts. The controls take scans out of public view and revoke their share links. Neither deletes anything, and the screen says so rather than leaving it implied: the report stays in its own owner's private history, because what you control is exposure, not somebody else's data. And the switch refuses every scan of the domain and of anything beneath it, from every account including your own, through the same mechanism and the same enforcement path as a staff blocklist entry, because it is the same statement. An owner can lift a block they put in place themselves and cannot lift a staff one, which is reported plainly rather than hidden behind a button that would quietly do nothing.
- [Bot] **[FIXED]** **The Assistant Was Answering to the Model's Name**
  Asked who it was, the chat assistant said it was MiniMax. The prompt did name it, once, in its opening sentence, and the block at the very end that survives a truncated context said only that it was the VulnRadar assistant, without giving the name or saying what to do when someone asks directly, so the model answered from its own training instead. There is a section about this now that answers the question rather than only forbidding the wrong answer, names the exact denials that were coming out, and keeps naming the underlying model a perfectly fair thing to do: which model runs behind it is a real question with a real answer, and being that model is not the same as running on it. The name also comes from the setting that exists for it rather than being typed into the prompt, which is the same bug in miniature, and it had been typed into the chat's own help text too.
- [Code] **[FIXED]** **Repo Scans Returned Nothing on an Anthropic Endpoint**
  Every AI feature in the app resolves its provider the same way and branches on which request shape the endpoint speaks. Every one except the GitHub repo code review, which only ever spoke OpenAI's. Pointing the AI endpoint at an Anthropic-compatible route, which is what MiniMax's own documentation recommends for its newest model, left every repository scan posting into a 404 and reporting no AI findings, with a single line in the server log to say otherwise. Nothing failed visibly, which is exactly why it went unnoticed. It now branches like the rest, asks a reasoning model to reason before judging whether a line is exploitable, and gets the reasoning timeout allowance every other AI call already had. It sends tens of thousands of characters per call and was the only one still on a flat timeout.
- [ScanSearch] **[FIXED]** **The Code Review Prompt Said What to Look For and Nothing About When Not to File**
  It listed the vulnerability classes to hunt for and stopped there, which is the same defect the finding-verification prompt had before it was rewritten. It now carries the rule that matters more: name the file and the line, trace the dangerous value to the dangerous call, confirm the input is actually attacker-influenced, and check that nothing in between already neutralises it. Anything you would phrase as a maybe is a reason not to file rather than a hedge to attach. Findings also carry a confidence the model chose instead of the flat 60 every one used to be stamped with, and anything it scores below its own reporting floor is dropped rather than shown, since that is the model calling its own finding a guess.
- [Crosshair] **[FIXED]** **The Icons Were Never Quite Lined Up With the Text**
  An icon sitting beside a line of text was positioned by hand in 43 places, always the same way: nudge it down two pixels. Two pixels is correct for exactly one combination, a 16px icon against 14px text at the default line height, and the app used a dozen combinations. The two most common were both wrong, in opposite directions, by amounts small enough to look like nothing in isolation and impossible to unsee once you have noticed. There is one component for it now and it has no number in it: a zero-width space builds a box exactly one line of that text tall and the icon centres against it, at any type size and any leading. It also aligns to the FIRST line rather than the middle of the block, which is the half of this that was visible from across the room, since a row set to centre floated its icon down the middle of a three-line paragraph. 31 files converted, including the one shared alert component that carries 53 more behind it, and a test now fails the build on a new hand-written nudge. It caught one this pass had missed.
- [Smartphone] **[FIXED]** **The Chat Window Was Drawn Underneath the Browser's Own Toolbars**
  On a phone the chat panel filled the screen edge to edge using the layout viewport, which on iOS Safari extends behind the address bar. The composer sat under it: the panel looked open and could not be typed into. The existing handling only engaged once the keyboard was already up, and it measured the window height while rendering, so it never updated on rotation either. The sheet is now sized to the rectangle the phone can actually show, tracking the viewport's offset as well as its height, because iOS scrolls the page underneath the form assist bar and a panel pinned to the top drifts off screen when it does. Opening a user in the admin panel on a phone also used to land you at the bottom of the page: the detail panel mounts above the directory you scrolled through to find them, so the browser held its position and the panel was entirely above the fold.
- [Table2] **[FIXED]** **The Repo List Is Now the Same Table as the Scan List**
  The repos page and the history page are the same kind of list doing the same job, and repos read as a different product because it was the same idea drawn three different ways. The row opened on a bare 16px icon in a 16px track, so nothing anchored the left edge; it now opens on the same tinted chip the scan list uses, with the repository's own mark in it and its scan state in the tone. A lock stays visible because it is the one fact that changes what a finding means: a secret in a public repo is already leaked. The severity rail was drawn only for repos that had been scanned, so rows shifted sideways depending on their own state. And the three columns to the right were auto-sized, which made them a different width on every row: the Actions header sat over nothing in particular, and Updated landed in a different place depending on whether the row above had five severity pills or the words about not being scanned yet.
- [Network] **[FIXED]** **Asking for a Port Sweep Could Cost You the Whole Scan**
  A port sweep needs a verified domain, and the two places you can ask for one behaved completely differently when you did not have it. From a finished result, the panel says so up front and a refusal costs nothing: the rest of the report is still there. From the dashboard, the toggle said the same sentence in helper text and the API answered with a refusal that rejected the entire scan. Ticking it against an unverified domain did not give you a scan without the sweep. It gave you no scan at all, after you had picked every option and pressed the button. The form works it out before you commit now: the switch goes unavailable against a host you have not verified, names the host it could not match, and links to the page that fixes it. A switch already on when you edit the URL to an uncovered host turns itself off rather than letting the submit fail for a reason the form had already worked out.
- [Settings] **[FIXED]** **Four Settings Were Being Overridden by the Literal Beside Them**
  A pass for hardcoded values turned up several facts typed twice where the copies had already drifted. One database column had three different maximum lengths depending on which code path wrote to it, and the widest one accepted values the column then rejected. Every scan pipeline resolved a response-body ceiling from a setting, read the body with it, and then re-capped the body at a hardcoded number sitting just below the shipped default: raising the setting to 5 MB read 5 MB off the wire and threw 4 MB away before any check saw it. The async-checks timeout reached three scan routes and not the main one, which is the one that runs almost every scan. The crawl's per-page fetch timeout reached the page discovery step only, so the fetch that actually scans each page, the most expensive network operation a crawl performs, had no knob at all. The assistant was also telling people a 24-hour subdomain cache and a 5-minute browser session limit, both of which are wrong.
- [Target] **[ADDED]** **The Verification Agent Can Now Be Measured Instead of Guessed At**
  A prompt is behaviour, and until now the only way to find out that a change to it made verdicts worse was for someone to notice a wrong one on screen. That is exactly how the last pair of bad verdicts was found. There is a labelled set now: findings paired with the verdict a competent engineer would give and a written rationale for why, split deliberately between findings that are real and findings that are not, because a prompt can always be made to score well on one half by getting worse at the other. Confirming everything scores full marks on the real ones. A run sends the same prompt production sends, through the same builder and the same parser, and prints a scorecard per half. Two of the cases are the verdicts that were actually wrong, kept as regressions so they can never quietly come back. Part of it runs in CI for free: it cannot tell you whether a verdict is right without a model, but it does fail the build if someone deletes a rule that a case depends on, which is the failure that would otherwise show up much later as an unexplained score drop.
- [Shield] **[SECURITY]** **A Database Dump Can No Longer Be Committed Unnoticed**
  An encrypted production dump was committed from a local run and shipped inside a published release tarball before anyone spotted it. The ignore rules were widened in response, and widening them was not enough on its own: git ignores nothing it is already tracking, so the same mistake made a minute earlier would have sailed through again. A test now reads the actual git index and fails on any tracked file shaped like a database dump, which catches one added with a force flag, one that lands outside the ignored directories because the backup path was configured elsewhere, and one arriving on a branch whose ignore rules predate the fix.
- [Shield] **[CHANGED]** **Stopped Sending a Header Our Own Scanner Says Not to Bother With**
  Expect-CT went out on every response, monitor-only, on the reasoning that it signalled to scanners that Certificate Transparency had been considered. Our own scanner disagrees in writing: the expect-ct-missing check is informational and its text says Chrome removed support in 107, that CT is enforced unconditionally at certificate validation regardless of any header, and that there is no meaningful action to take. We were sending a header we tell users not to bother with. A deprecated header no browser reads is not a signal, it is bytes on every response.
- [Container] **[FIXED]** **The Release Build Installed an Emulator It Never Used**
  The publish workflow set up QEMU on every release. That was there to emulate arm64 back when the job built both architectures at once, and it outlived the split: the build is amd64 on an amd64 runner, which is native, and arm64 moved to its own workflow on a native ARM runner where it takes 4.6 minutes instead of the 27 it took under emulation. So the step installed an emulator that nothing then asked to emulate anything, and dependabot kept opening pull requests to keep it up to date. Removing it is the honest version of merging those. Separately, vitest and its coverage plugin pin each other to one exact version, and ungrouped they arrived as two pull requests that were each other's missing half: both failed at install before a single test ran, and neither could ever have gone green alone. They are grouped now.

---

## Earlier releases: change titles

Descriptions omitted. Ask about any of these by version and the full
entry is retrieved.

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

- **Total releases:** 72
- **Total changes documented:** 859
- **Latest:** v3.9.1 (September 8, 2026) - Handed the Whole Book, Remembering None of It
- **Earliest:** v1.0.0 (February 9, 2026) - First Release
