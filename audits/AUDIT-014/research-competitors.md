# AUDIT-014 salvaged research: competitor landscape (section 20)

**Status: raw research, NOT findings.** The section 20 agent was stopped before it
could turn this into findings. Its research subagent had already completed, so this
file preserves that output verbatim in substance. The next session should use this as
the evidence base for section 20 rather than repeating roughly six minutes of live
web research.

**Gathered 2026-08-28.** Confidence is marked per item. "VERIFIED-LIVE" means a URL
was actually fetched in this session. "FROM-MEMORY" means it was not verified and
must be re-checked before anyone acts on it.

---

## Group A: open-source self-hostable scanners

### OWASP ZAP (now "ZAP by Checkmarx") | VERIFIED-LIVE
15,699 stars, 2,625 forks, Apache-2.0, last push 2026-08-27. Latest release v2.17.0
(2025-12-15). Checkmarx hired all three project leads in Sept 2024; still Apache-2.0
and free, and there is **no official hosted ZAP**.

Full active-scan payload injection (SQLi, XSS, command injection, path traversal),
passive rules, spider, AJAX spider, manual fuzzer. MITM proxy first, scanner second.
Auth: form, script, browser-based, header/env, plus an auto-detect add-on. Reports:
HTML, JSON, PDF, XML, Markdown. CI: Docker packaged scans (`zap-baseline`,
`zap-full-scan`, `zap-api-scan` for OpenAPI/GraphQL), official GitHub Actions, the
YAML Automation Framework, daemon mode with a REST API. Roughly 200+ marketplace
add-ons.

### Nuclei / ProjectDiscovery | VERIFIED-LIVE (cloud tier partly unverified)
nuclei: 30,908 stars, MIT, last push 2026-08-26. nuclei-templates: 12,875 stars, last
push 2026-08-29 (daily churn). About **11,997 template files across 873 directories**:
info 4,353, high 2,552, medium 2,457, critical 1,555, low 330.

Protocols: TCP, DNS, HTTP, SSL, WHOIS, JavaScript, Code, Headless, WebSocket, File.
Primarily signature matching, but `-dast` / `-fuzz` enables real fuzzing. Reports:
JSONL, JSON, Markdown, **SARIF**, text, with integrations for GitHub, GitLab, Jira,
Elasticsearch, Splunk HEC, MongoDB. Paid platform is now "Neo", pay-as-you-go from
$250 (50 credits/seat). **FROM-MEMORY:** the free PDCP tier limits (own-domain only,
~10 new domains/month) were not verified.

**The template community is the moat none of the others have:** 12k templates, daily
commits, a formal "Pioneers" program, and template bounties.

### Wapiti | VERIFIED-LIVE
1,848 stars, GPL-2.0, v3.3.1 (2026-07-27). Small but actively maintained. Genuine
black-box active injection fuzzing across 30+ modules: SQL/XPath/LDAP injection, XXE,
reflected and stored XSS, command execution, CRLF, SSRF, open redirect, file
disclosure, file upload, Shellshock, Log4Shell, Spring4Shell, CSRF, subdomain
takeover, plus CMS/WordPress enum and SSL/TLS evaluation. Reports: HTML, XML, JSON,
TXT, CSV, Markdown. **FLAG: no Docker or CI story could be verified.**

### Nikto | VERIFIED-LIVE
10,691 stars, README states GPLv3 (the API reports NOASSERTION), last push 2026-08-28.
Web-server-level signature scanning: misconfiguration, default and backup files,
information disclosure, outdated server software, dangerous HTTP methods. Reports:
csv, json, htm, sql, txt, xml. **Note the database files carry separate licensing.**

### Dead or dying, do not treat as competitors
- **Arachni:** 4,040 stars, GitHub API reports `archived: true`.
- **w3af:** 4,899 stars, last push 2023-02-22, three and a half years cold.

### Trivy (Aqua Security) | VERIFIED-LIVE
37,679 stars, Apache-2.0, last push 2026-08-28. **Not a web scanner.** Targets
container images, filesystems, repos, binaries, Kubernetes, clouds. Overlaps
VulnRadar only at "software inventory plus CVE correlation", and only for artifacts,
not live URLs. Emits **SARIF 2.1.0**, CycloneDX/SPDX SBOM, JUnit, HTML.
**FLAG: the API returned `forks_count: 637`, implausibly low. Do not cite it.**

### DefectDojo | VERIFIED-LIVE
4,911 stars, BSD-3-Clause, last push 2026-08-29. The OSS vulnerability-management
layer teams pair scanners with. **500+ supported report parsers** per the official
docs, confirmed to include ZAP, Nuclei, Trivy, Nikto, Burp, SSL Labs and Wapiti.
Import via UI, REST API (the standard CI path), or Pro-only connectors.

**Distribution wedge:** shipping a DefectDojo-compatible export, or getting a
VulnRadar parser upstreamed, is low cost. So is SARIF, which ZAP, Nuclei and Trivy all
emit and which peers treat as table stakes.

### Faraday (Infobyte) | VERIFIED-LIVE
6,697 stars, GPL-3.0, last push 2026-08-20. OSS vulnerability management, 80+ tool
plugins, multi-user, CI/CD integration, `faraday-cli`, remote agent dispatcher, full
API. The company has pivoted to services; pricing is demo-gated.

---

## Group B: free "paste a URL, get a grade" tools

This is the group VulnRadar most resembles in the funnel, and it is where the clearest
market opening is.

### MDN HTTP Observatory | VERIFIED-LIVE
Hosted on MDN. 6.9M+ sites, 47M+ scans since 2016. Baseline 100 points, penalties in
round 1, bonuses only if already at 90+, range 0 to 145. Grades A+ (100+) down to
F (0-24). **Ten tests, HTTP headers only.**

**The TLS/SSH Observatory was sunset in October 2024.** The MDN version does no TLS or
certificate analysis at all. That is a verified gap VulnRadar already fills.

API: `POST https://observatory-api.mdn.mozilla.net/api/v2/scan?host=<host>`. One scan
per host per 60 seconds. Scan history is public per domain. No badges. Self-hostable
(Node + Postgres, MPL-2.0). No business model: it is a Mozilla funnel property.

### SecurityHeaders.com | PARTIALLY VERIFIED (site 403s automated fetch)
Ownership chain: Scott Helme, then **Probely (June 2023)**, then **Snyk (acquired
Probely, June 2025)**. Instant A+ through F grade on response headers; the A+ badge is
widely embedded in READMEs.

**Its API is dead.** Retirement announced April 2025, shut down **April 2026**. The
historical price was $2.99/month. The free web scanner appears to still run, but
**FLAG: could not be verified live, confirm in a browser.**

**This is the single clearest live market opening in this research set.** A well-known
free API with an established A+ to F grading contract was killed four months ago, and
the replacements are all unknown micro-vendors (Guardr/Cybaa, myssl.info, WebAudit,
detectzestack, sitesecurityscore). VulnRadar already has a public REST API, public
host report pages, and badges.

### Qualys SSL Labs | VERIFIED-LIVE
Live, SSL Report v2.4.3, no deprecation notice. Grades A+ through F plus T (trust
issues) and M (name mismatch). Weights: protocol support 30%, key exchange 30%, cipher
strength 40%. A zero in any category zeroes the score. No TLS 1.3 caps the grade at
A-, as do HSTS problems.

API v4 only (v3 deprecated 2024-01-01). **Registration now requires an organizational
email; free providers are rejected.** Dynamic rate limits via `X-Max-Assessments`,
429 on overflow.

**Commercial use is prohibited by default:** "APIs are made available so that system
operators can test their own infrastructure", with exceptions only for CAs, CDNs,
hosting companies and registrars by prior arrangement. **This blocks any SaaS from
proxying SSL Labs, which matters if VulnRadar's SSL grade is or becomes SSL Labs
derived. Worth checking the current implementation.**

### Hardenize | FROM-MEMORY, not verified live
Acquired by Red Sift (October 2022), rebranded Red Sift ASM. Self-serve tier reportedly
removed, pricing moved to $5,000+/yr enterprise. Net effect: it has vacated the
small-team segment VulnRadar targets.

### ImmuniWeb Community Edition | VERIFIED-LIVE
Seven free tools, 380M+ scans since 2019. The Website Security Test covers web
vulnerabilities, AI bot protection, headers, DNSSEC, CSP, and **GDPR plus PCI DSS
compliance**, with a free PDF report. Free API tier: 8 tests/day. A premium API removes
the cap and is **purchasable self-serve, the only one left standing in this group.**

**Most relevant mechanic:** score A or A+ and you get a PDF certificate plus an
installable digital badge, with install instructions on the results page. This is the
most mature implementation of exactly what VulnRadar's public host reports and badges
are aiming at, and it is gated on grade, which is what makes people work to earn it and
then embed it.

### Google PageSpeed Insights / Lighthouse | MEDIUM confidence
No paid tier. Quota reportedly ~25,000 requests/day and 100 queries/100 seconds with a
free API key, **FLAG: community-sourced, not officially published.**

**The lesson for VulnRadar:** PSI became infrastructure by shipping a generous,
key-only, well-documented API and letting a third-party monitoring industry build on
top. SecurityHeaders.com did the opposite and deleted its API.

---

## Cross-cutting conclusions for the section 20 write-up

1. **Active injection testing is the defining line.** ZAP and Wapiti send real payloads;
   Nuclei does with `-dast`/`-fuzz`. A header/TLS/DNS/inventory scanner sits in a
   lighter category. Every Group A peer except Trivy does something VulnRadar does not.
   This is almost certainly gap number one, and it should be ranked against how much
   the target user actually wants it versus the build and liability cost.
2. **SARIF is the interop format** and VulnRadar should emit it, plus a DefectDojo
   parser, to be pipeable into what small security teams already run. Cheap, high
   leverage. **Verify first whether VulnRadar already emits SARIF: prior audits
   reference a SARIF renderer, so this may already be done.**
3. **The nuclei-templates model is the moat none of the others have.** A community
   check-contribution path with a published count is the most defensible asset
   available to a GPL scanner with a large check registry.
4. **Free-tier API supply just contracted sharply.** SecurityHeaders.com's API died
   April 2026, SSL Labs v4 demands a corporate email and forbids commercial use, MDN
   Observatory offers one narrow endpoint with a 60s cooldown and zero TLS coverage,
   and Hardenize went enterprise-only. VulnRadar already has the API, badges, public
   host pages, and TLS plus DNS coverage that this vacuum wants. **This is the
   strongest single opportunity in the research.**
5. **ImmuniWeb's grade-gated certificate and installable badge** is the closest live
   analogue to VulnRadar's badges and is worth copying deliberately.

## Explicitly unverified, re-check before acting

securityheaders.com's current live status and check list; Hardenize/Red Sift pricing
and free tier; ProjectDiscovery's current free cloud tier limits; ImmuniWeb's exact
grade scale; Wapiti's Docker and CI story; Trivy's fork count; Aqua Platform pricing;
Nikto's current version and license as reported by the API.
