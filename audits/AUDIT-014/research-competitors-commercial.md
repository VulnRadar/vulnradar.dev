# AUDIT-014 salvaged research: commercial DAST competitors (section 20)

**Status: raw research, NOT findings.** Companion to `research-competitors.md` (which
covers open-source and free-tool competitors). The section 20 agent was stopped before
turning either into findings; both of its research subagents had already completed, so
this preserves the second one. Use it as the evidence base rather than repeating the
web research.

**Gathered 2026-08-28.** VERIFIED-LIVE means a vendor page was fetched this session.
VENDOR-SEARCH means a search result quoting a vendor domain, page not fetched.
THIRD-PARTY means an aggregator or review site. UNVERIFIED means unconfirmed.

---

## Detectify | pricing VERIFIED-LIVE

Annual platform fee plus usage. Starter EUR 0/yr, Standard EUR 2,500+/yr, Professional
EUR 5,000+/yr, Enterprise EUR 15,000+/yr. Usage billed separately per domain and per
target. **PCI ASV EUR 500/yr.** API Scanning starts at EUR 90/month.

Auth: exactly three methods, a recorded login via a Detectify Chrome recorder
extension, HTTP Basic, and session cookie. No SSO or OIDC login flow.

Compliance: PCI ASV **in partnership with Clone Systems**, so Detectify is not itself
the ASV. Produces the Attestation of Scan Compliance. No SOC 2 / ISO 27001 / HIPAA
mapping surfaced.

Integrations: Jira (two-way, resolving the ticket updates Detectify), Slack, Teams,
ServiceNow, Splunk, OpsGenie, PagerDuty, webhooks. Built on Workato iPaaS. No Linear
or GitHub Issues named.

ASM: continuous subdomain enumeration and monitoring, subdomain takeover detection
including expiring nameservers and cloud-hosted takeover.

**Distinctive: Crowdsource**, a private bug bounty community feeding real submitted
0-days into the scanner. That is the moat, not the tooling. No SCA, container, or IaC.
SaaS only.

## Intruder | pricing VERIFIED-LIVE (numbers withdrawn by vendor)

Free tier is $0 forever. Cloud / Pro / Enterprise prices are **no longer displayed**;
they removed the public calculator. Base fee plus per-target fee, and "a licence is
used each time you scan a target, and stays used for 30 days".
Bolt-ons: **AI Pentesting from $3,500 per test**, internal scanning, GregAI analyst.
**THIRD-PARTY and likely stale, do not quote: Essential $119/mo, Cloud $239/mo,
Pro $399/mo.**

Compliance: SOC 2, ISO 27001, PCI DSS, HIPAA, DORA, with one-click evidence push to
**Drata and Vanta**. 140,000+ checks claimed. **Intruder is explicitly not a PCI ASV**;
their own help centre says the underlying Tenable engine is, but they are not.

Integrations: Jira, ServiceNow, GitHub, GitLab, Azure DevOps, **Linear** (the only one
of the eight with it), Slack, Teams, AWS, Azure, GCP, Cloudflare, Docker Hub, Drata,
Vanta, Microsoft Sentinel, Okta SSO, Zapier.

**Distinctive: Vanguard**, a hybrid where certified human pentesters review automated
results. Scanning engine is third-party (Tenable/Nessus, optionally OpenVAS/ZAP),
which matters because VulnRadar builds its own.

## Probely | now Snyk

**Major finding: acquired 12 Nov 2024, folded into Snyk API and Web, launched 22 Apr 2025.** Confirmed live: `developers.probely.com` serves Snyk docs,
`help.probely.com` is titled "Snyk API and Web Help Center", the site brands itself
"Probely, a Snyk business".

**Pricing UNVERIFIED:** probely.com returns HTTP 403 to every automated fetch. Two
conflicting third-party datasets exist; treat both as unreliable.

Notable inherited feature: the Jira integration is genuinely two-way and unusual,
**marking the Jira issue Done automatically triggers a retest of that finding.**

**Assessment: treat Probely as a legacy brand and evaluate Snyk API and Web instead.**

## Pentest-Tools.com | VERIFIED-LIVE

Per scanned asset, quota resets every 30 days. **NetSec from $95/month**, **WebNetSec
from $140/month** (adds web and API DAST plus authenticated scans), **Pentest Suite
from $190/month** (adds exploitation tools and the report generator). Annual pays 10
months. **Free Edition up to 5 assets.** Unlimited scans and team members on all paid
plans.

Auth: username/password, custom headers, cookies, and recorded login sessions.

**Proof of exploit is the differentiator: Sniper auto-exploiter, SQLi Exploiter, XSS
Exploiter actually exploit to confirm.** Real exploitation evidence, not just
request/response pairs.

Reporting: pentest report generator, DOCX/PDF/HTML, white-label, templates aligned to
ISO 27001, NIS2, SOC 2, DORA, CRA. No PCI ASV.

Integrations: Jira, Slack, Teams, **Discord**, webhooks, AWS, GitHub Actions, REST API.
RBAC: Admin/Member/Viewer, unlimited workspaces and team members on every plan.
**SSO/SAML is not documented anywhere, likely absent.**

**This is the closest analogue to VulnRadar's shape** of the eight, and the cheapest
credible paid entry at $95/mo.

## Acunetix / Invicti | pricing mostly quote-only

Only published number is **Agentic Pentest at "$500 max per pentest", 24-hour
delivery**. A target is a fully qualified domain name. THIRD-PARTY estimates put entry
around $7,000/yr, range $7K to $37K+/yr. **Flagged unverified**; acunetix.com 403s.

**Proof-Based Scanning is the flagship claim: runtime verification at a claimed 99.98%
accuracy.** The strongest zero-false-positive claim in the set.

**AcuSensor IAST agent** for PHP, ASP.NET, Java and Node.js gives grey-box runtime
feedback from inside the source. **None of the other seven ship a comparable
server-side sensor.**

Auth: Login Sequence Recorder, explicitly handles CAPTCHA and MFA. Compliance: PCI DSS,
HIPAA, ISO 27001, SOC 2, OWASP templates. Two-way sync with Jira, GitHub, Azure Boards,
ServiceNow and 30+ others. **Deployment: SaaS and enterprise on-premise.**

**Distinctive 2026 development: Invicti Agentic Pentest**, announced 29-30 July 2026.
Parallel specialized AI agents attack SQLi, RCE, XSS, SSRF, XXE, insecure
deserialization, path traversal and NoSQLi, with an app-specific agent synthesizing
chained attack strategies. Max $500 per pentest, 24h turnaround. Directly undercuts
traditional PTaaS.

## Burp Suite DAST (PortSwigger) | renamed from Enterprise Edition, May 2025

Burp Suite **Professional $499** and Community free. Burp Suite DAST is quote-only,
with "no limits on the number of users" and explicitly **"you don't pay per URL"**,
which distinguishes it from every per-FQDN competitor. THIRD-PARTY estimate $6,000 to
$200,000+/yr.

**Best self-host story in the set:** Cloud, self-hosted Windows/Linux with your own
PostgreSQL or Oracle, **air-gapped supported**, and **Kubernetes via Helm with
auto-scaling.**

**Strongest API format coverage of the eight:** Postman Collections, OpenAPI, SOAP and
GraphQL, with Basic, Bearer, API key and OAuth 2.0 client credentials.

CI/CD: Jenkins, GitHub Actions, GitLab CI, Azure DevOps, Bitbucket, CircleCI, TeamCity.
SSO: SAML, Okta, Entra ID. Secrets from HashiCorp Vault and AWS Secrets Manager.

**Distinctive: OAST via Burp Collaborator** for out-of-band detection, which needs
infrastructure VulnRadar would have to build. **No compliance framework mapping at all,
which is a real hole in an otherwise strongest-in-class product.**

## Snyk (including Snyk API and Web) | VERIFIED-LIVE

Priced **per contributing developer**. Free $0 (5 projects, **no DAST**), Team from
$25/mo (**no DAST**), **Ignite from $1,260/yr per dev with DAST included**
(THIRD-PARTY: capped at 50 devs and 10 DAST targets), Enterprise on quote.

DAST specifics: 30,000+ potential vulnerabilities, claimed **0.08% false positive
rate**, 115 API-specific vulnerability types.

**Deepest auth support of the eight:** login forms, recorded login sequences,
**2FA via TOTP and email/SMS OTP**, API keys, token auth, **SSO and OpenID Connect**,
and **automatic re-authentication when the session expires mid-scan.**

APIs: OpenAPI/Swagger, Postman, and **GraphQL as a first-class target** including
schema fetch from an introspection endpoint. Headless-Chrome SPA crawler inherited
from Probely. Compliance: PCI DSS, SOC 2, HIPAA, ISO 27001, GDPR, OWASP. Scanning
agent as a Docker container or Kubernetes workload for internal targets.

**Only vendor spanning SAST, SCA, container, IaC, secrets, DAST and SBOM in one
platform.** But **DAST is paywalled to Ignite and above, which is exactly the seam
VulnRadar sits in.**

## Astra Security | most transparent pricing of the eight

DAST: Scanner Lite **$69/mo or $699/yr**, Scanner **$199/mo or $1,999/yr** (unlimited
scans, 1 target), Scanner Agency **$499/mo or $4,999/yr** (5-target pool).
PTaaS: Pentest Basic $1,999/yr, Pentest Plus $5,999/yr. API DAST $199/mo. Cloud from
$99/mo. **Trial is $7 for one week. No permanent free tier.**

Auth: **Chrome DevTools Recorder**, handles **TOTP MFA** (Google Authenticator, Authy)
and static OTPs. All paid tiers include authenticated scans.

Compliance: SOC 2, ISO 27001, PCI DSS, HIPAA, GDPR mapping with automated evidence
collection. **Trust Center**: a public or access-controlled page sharing live
compliance, pentest and vulnerability data.

**Publicly verifiable pentest certificate** on Pentest Plus and above, issued only
after you fix the initial findings and pass reverification, **valid 180 days.** The
strongest attestation-artifact story of the eight for a small team.

API scanning: REST, SOAP, GraphQL, and it flags **shadow APIs and zombie APIs.**

---

## Cross-cutting conclusions for section 20

### Table stakes all eight have that VulnRadar does not

1. **Authenticated scanning. This is the single biggest gap.** Universal across all
   eight. The floor is a recorded login via a browser recorder extension plus Basic
   auth and session cookie (Detectify, Astra, Pentest-Tools, Acunetix, Burp all ship
   one). Snyk is the ceiling: form, recorded sequence, TOTP/OTP 2FA, API key, SSO/OIDC,
   and auto re-auth mid-scan. **Check the current code first: VulnRadar has
   `lib/scanner/auth/browser-login.ts` and an `/api/v3/scan/authenticated` route, so
   some of this may already exist and the gap may be narrower than it looks.**
2. **Ticketing integrations.** Jira is universal, Slack near-universal. The real
   differentiator is **two-way sync**: Detectify, Probely/Snyk (marking Done triggers a
   retest) and Invicti all have it. Linear only at Intruder.
3. **Compliance framework mapping.** SOC 2 / ISO 27001 / PCI DSS / HIPAA / GDPR views
   are standard at Intruder, Astra, Snyk and Invicti. Burp has none.
4. **CI/CD break-the-build.** Burp (7 platforms) and Snyk (4) are broadest.

### Attestation artifacts, where the market is thin

Astra issues a publicly verifiable certificate gated on remediation, 180-day validity.
Detectify resells PCI ASV attestation via a partner at EUR 500/yr. Intruder explicitly
is not an ASV. Nobody else issues a certificate. **Astra's Trust Center is the most
copyable idea here for a small vendor, and VulnRadar's public host report pages plus
badges are already most of the way to it.**

### Pricing landscape

Per target: Pentest-Tools ($95-190/mo), Astra ($69-499/mo), Intruder, Acunetix
(per FQDN), Detectify (platform fee plus usage). Per developer: Snyk only. Per user
with unlimited targets: Burp DAST, explicitly not per URL.
**Cheapest credible paid entry points: Astra $69/mo, Pentest-Tools $95/mo, Detectify
API Scanning EUR 90/mo.**
**Persistent free tiers:** Detectify Starter, Intruder Free, Pentest-Tools Free
(5 assets), Snyk Free (no DAST).

### Deployment: VulnRadar's clearest structural advantage

**Only Burp Suite DAST and Acunetix/Invicti offer real self-hosting.** Everyone else is
SaaS with at most an internal-scanning agent. **VulnRadar being genuinely self-hostable
and GPL differentiates it against six of the eight** (subject to `AUDIT-014#host-01`,
which found the documented self-host does not currently work, so this advantage is
claimed but not yet delivered).

### The 2026 industry shift

Every major vendor launched agentic AI pentesting this year: Invicti Agentic Pentest
(July 2026, max $500, 24h), Intruder AI Pentesting (from $3,500/test), Astra autonomous
agents, Snyk Evo Continuous Offensive Security. All priced 10x to 100x below
traditional pentests and aimed at the "we need a pentest report for the SOC 2 auditor"
buyer. Section 20 should take a position on whether VulnRadar competes here or
deliberately does not.

### Could not verify, re-check before acting

Probely's current pricing (403 to automated fetch, open it in a browser);
Acunetix/Invicti tier names and any price beyond the $500 figure; Intruder's current
Cloud/Pro/Enterprise prices (calculator deliberately removed, the $119/$239/$399
numbers are stale); Burp Professional's $499 billing period; Detectify's named CI/CD
integrations.
