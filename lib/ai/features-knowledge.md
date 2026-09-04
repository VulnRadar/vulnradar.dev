# VulnRadar Product Features: AI Knowledge

_Auto-compiled from the routes under `app/` on 2026-09-04._

Every user-facing page this deployment ships, with the purpose read out
of the page's own metadata, heading and subtitle. If a feature is not
listed here, this build does not have it. If it is listed here, it
exists and the route shown is where it lives.

Where a page says no description could be read, that means the source
did not state one in a form this compiler could quote. It does NOT mean
the page is unimportant, and it is not licence to invent what it does.

---

## Product features

### /
Route: /
Access: public, no account needed

This route holds no content of its own: it redirects to /landing.

### Open-Source Scanner Alternatives Compared
Route: /alternatives
Access: public, no account needed
Page title: Open-Source Scanner Alternatives Compared
Heading on the page: How VulnRadar compares

VulnRadar is an open-source, GPL-3.0 web vulnerability scanner you can self-host, with a free tier and paid plans from $5 a month. Here is an honest look at where it fits next to the better-known commercial tools. No invented competitor prices, no disparagement.

### Assets
Route: /assets
Access: signed in (or a share token)
Page title: Assets
In-app navigation label: Assets
Also known as: hosts inventory

This page exists at /assets. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Attack Surface
Route: /attack-surface
Access: signed in (or a share token)
Page title: Attack Surface
Heading on the page: Attack surface
In-app navigation label: Attack Surface
Also known as: domains verified portfolio

Your verified domain portfolio. Verifying a domain proves you own it: a verified apex covers every subdomain beneath it and unlocks active probing, authenticated scans, and subdomain discovery across those assets.

### Status badge
Route: /badge
Access: signed in (or a share token)
Page title: Security Badge
Heading on the page: Badge
In-app navigation label: Status badge
Also known as: embed snippet readme svg

Pick a scan and get an image that links back to the full report. The badge is tied to that URL, not that one scan: every time you scan it again, the badge updates on its own. Paste the embed code once and forget it.

### Live Browser Session
Route: /browser/[id]
Access: signed in (or a share token)
Page title: Live Browser Session

This page exists at /browser/[id]. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Changelog
Route: /changelog
Access: public, no account needed
Page title: Changelog: New Checks and Fixed Detectors
Heading on the page: Changelog
In-app navigation label: Changelog
Also known as: releases versions what is new

Every release in order, including the security fixes, not just the features. Each release is grouped by what kind of change it is, so you can read only the part you came for.

### Every Web Vulnerability Check, With Fixes
Route: /checks
Access: public, no account needed
Page title: Every Web Vulnerability Check, With Fixes
Heading on the page: Every check VulnRadar runs

The 795+ checks a scan runs, grouped into 18 categories. Not a marketing number: most have a real page here that tells you what the check catches, why it matters, and how to fix it with code you can paste. The rest only fire across several pages at once, so there is no single check to link to.

### Compare scans
Route: /compare
Access: signed in (or a share token)
Page title: Compare Scans
Heading on the page: Compare
In-app navigation label: Compare scans
Also known as: diff difference regression

Diff two scans of the same host. Because finding IDs do not change between runs, the difference is real: what appeared, what you closed, and what has been sitting there the whole time.

### Contact and support tickets
Route: /contact
Access: public, no account needed
Page title: Contact: Bugs, False Positives, and Support
Heading on the page: Contact
In-app navigation label: Contact and support tickets
Also known as: help ticket email support

Bugs, false positives, feature ideas, security disclosures, or enterprise deployments: pick a category and it goes to the right place.

### Scanner
Route: /dashboard
Access: signed in (or a share token)
Page title: Dashboard
Heading on the page: Scan a host
In-app navigation label: Scanner
Also known as: scan new dashboard

795+ checks across 18 categories. Paste a domain or an IPv4 address, choose what runs, and read the findings. Nothing to install.

### Live Demo: Scan Any URL in 3 Seconds
Route: /demo
Access: public, no account needed
Page title: Live Demo: Scan Any URL in 3 Seconds
Heading on the page: Point it at us first.

This runs the real scanner against VulnRadar's own deployment and shows you the whole report, including whatever we fail. Nothing is pre-rendered and nothing is filtered out to make us look better.

### Donate
Route: /donate
Access: public, no account needed
Page title: Donate: Fund Open-Source Scanner Development
Heading on the page: Support VulnRadar
In-app navigation label: Donate
Also known as: support sponsor fund

VulnRadar is GPL-3.0 and free to self-host. Donations pay for the hosting behind the public instance and the time spent chasing false positives out of the detection engine.

### History
Route: /history
Access: signed in (or a share token)
Page title: Scan History
In-app navigation label: History
Also known as: past scans results

This page exists at /history. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Host Report
Route: /host/[hostname]
Access: signed in (or a share token)
Page title: Host Report

This page exists at /host/[hostname]. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Scan Any Website for Security Issues
Route: /landing
Access: public, no account needed
Page title: Scan Any Website for Security Issues

Paste a URL, get a security report in under 3 seconds: 795+ deterministic checks across headers, TLS, cookies, DNS, and secrets. No agent to install.

### Pricing
Route: /pricing
Access: public, no account needed
Page title: Pricing: Free Tier and Plans From $5/mo
Heading on the page: There is nothing to pay for here
In-app navigation label: Pricing
Also known as: plans cost upgrade

Billing is switched off on this VulnRadar deployment. Every account gets the full check set, the full API, and no daily scan ceiling.

### Profile and account settings
Route: /profile
Access: signed in (or a share token)
Page title: Profile
Heading on the page: Account Settings
In-app navigation label: Profile and account settings
Also known as: name email avatar general

Manage your account settings and preferences

### Public Scans
Route: /public-scans
Access: public, no account needed
Page title: Public Scans: Shared Reports Directory
Heading on the page: Public Scans
In-app navigation label: Public Scans
Also known as: directory listed

Every scan someone chose to list here, most recent first. Each one links to the full read-only report. Sharing a scan lists it by default, unless you or your account settings say otherwise.

### Repos
Route: /repos
Access: signed in (or a share token)
Page title: Repos
In-app navigation label: Repos
Also known as: github repositories code

Run a security review on your repo source: any kind of repo, not just web apps. Bots, games, CLIs, libraries, whatever. Not URL/HTTP problems, actual code-level issues.

### Security & Responsible Disclosure
Route: /security
Access: public, no account needed
Page title: Security & Responsible Disclosure
Heading on the page: Report a security issue

VulnRadar is a security scanner, so we hold our own code to the same bar. If you have found a vulnerability, we want to hear about it before anyone else does. This page is the one place that tells you how to reach us, what we treat as in scope, and what you can expect once you hit send.

### Shared Scan Report
Route: /shared/[token]
Access: signed in (or a share token)
Page title: Shared Scan Report

This page exists at /shared/[token]. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Shared links
Route: /shares
Access: signed in (or a share token)
Page title: Shared Reports
Heading on the page: Shared reports
In-app navigation label: Shared links
Also known as: share report link

Anyone with a link below can read that report without logging in. Revoke a link and it stops working immediately.

### Teams
Route: /teams
Access: signed in (or a share token)
Page title: Teams
In-app navigation label: Teams
Also known as: members invite organisation

A team shares its scans. Everyone in one can open every report run under it, and the role you give someone decides whether they can also start scans or invite people.

### Join a Team
Route: /teams/join
Access: signed in (or a share token)
Page title: Join a Team

This page exists at /teams/join. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Free Online Security Tools, No Signup
Route: /tools
Access: public, no account needed
Page title: Free Online Security Tools, No Signup
Heading on the page: Free security tools

Focused, single-purpose views of the VulnRadar scanner. Each one runs the same detection engine against a URL you paste, no signup and nothing to install.

### Online API Security Scanner, No Agent
Route: /tools/api-scanner
Access: public, no account needed
Page title: Online API Security Scanner, No Agent
Heading on the page: API scanner, online

Paste an API URL and VulnRadar checks it the way an attacker would probe it from the outside: CORS, rate limiting, GraphQL introspection, and any OpenAPI document you left reachable. No agent to install, just paste a URL.

### Link & Redirect Checker: See Where It Goes
Route: /tools/link-checker
Access: public, no account needed
Page title: Link & Redirect Checker: See Where It Goes
Heading on the page: Check where a link really goes

Paste a URL and VulnRadar follows it end to end: the redirect chain, the security headers, the TLS, and the reputation of wherever it lands, including links sitting behind Cloudflare. It is the check to run before you click something you were sent.

## Checkout and credit top-ups

### AI Credits
Route: /ai-credits
Access: public, no account needed
Page title: AI Credits

This page exists at /ai-credits. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Live-Browser Minutes
Route: /browser-credits
Access: public, no account needed
Page title: Live-Browser Minutes

This page exists at /browser-credits. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Checkout
Route: /checkout/[productId]
Access: signed in (or a share token)
Page title: Checkout

This page exists at /checkout/[productId]. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### /checkout/browser-credits
Route: /checkout/browser-credits
Access: signed in (or a share token)

This page exists at /checkout/browser-credits. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### /checkout/credits
Route: /checkout/credits
Access: signed in (or a share token)

This page exists at /checkout/credits. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### /checkout/github-credits
Route: /checkout/github-credits
Access: signed in (or a share token)

This page exists at /checkout/github-credits. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Checkout Complete
Route: /checkout/success
Access: signed in (or a share token)
Page title: Checkout Complete

This page exists at /checkout/success. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Credits
Route: /credits
Access: public, no account needed
Page title: Credits

Three separate balances, one for each metered feature. A balance is spent only after that feature's free allowance for the period runs out, and none of them expires.

### GitHub Review Credits
Route: /github-credits
Access: public, no account needed
Page title: GitHub Review Credits

This page exists at /github-credits. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

## Legal and policy pages

### VulnRadar Legal: Terms, Privacy, and DMCA
Route: /legal
Access: public, no account needed
Page title: VulnRadar Legal: Terms, Privacy, and DMCA

The terms of service, privacy policy, acceptable use policy, disclaimer, accessibility statement, and DMCA policy that govern using VulnRadar.

### Acceptable Use Policy: What You May Scan
Route: /legal/acceptable-use
Access: public, no account needed
Page title: Acceptable Use Policy: What You May Scan

Rules for what you may scan: authorization requirements, prohibited uses, bug bounty guidance, and rate limits.

### Accessibility Statement and Conformance
Route: /legal/accessibility
Access: public, no account needed
Page title: Accessibility Statement and Conformance

VulnRadar's accessibility conformance target, the features that support it, known limitations we are still working on, and how to report a barrier.

### Disclaimer: Scan Results Are Informational
Route: /legal/disclaimer
Access: public, no account needed
Page title: Disclaimer: Scan Results Are Informational

Scan results are informational, not a warranty or a penetration test. What the scanner does and does not guarantee, and where legal responsibility sits.

### DMCA & Copyright: How to File a Notice
Route: /legal/dmca
Access: public, no account needed
Page title: DMCA & Copyright: How to File a Notice

How to file a copyright infringement notice or a counter-notification, and the designated agent to send it to.

### Privacy Policy: Data, Retention, and Rights
Route: /legal/privacy
Access: public, no account needed
Page title: Privacy Policy: Data, Retention, and Rights

What data the scanner collects, how passwords and API keys are hashed and encrypted, retention windows, and your rights under GDPR and CCPA.

### Terms of Service: Authorized Use and Limits
Route: /legal/terms
Access: public, no account needed
Page title: Terms of Service: Authorized Use and Limits

The terms that govern using the scanner: authorized use only, account responsibilities, API limits, data retention, and liability.

## Sign-in and account recovery

### Reset Password
Route: /forgot-password
Access: signed in (or a share token)
Page title: Reset Password

This page exists at /forgot-password. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Sign In to History, API Keys, and Scans
Route: /login
Access: public, no account needed
Page title: Sign In to History, API Keys, and Scans

Sign in to VulnRadar to view scan history, manage API keys, schedule recurring scans, and share reports with your team.

### Set New Password
Route: /reset-password
Access: signed in (or a share token)
Page title: Set New Password

This page exists at /reset-password. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Create a Free Scanner Account, No Card
Route: /signup
Access: public, no account needed
Page title: Create a Free Scanner Account, No Card

Create a free VulnRadar account. 25 scans a day, full API access, and scan history retained for 30 days. No card required.

### Accept a Staff Invite
Route: /staff-invite/[token]
Access: signed in (or a share token)
Page title: Accept a Staff Invite

This page exists at /staff-invite/[token]. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

### Unsubscribe
Route: /unsubscribe
Access: signed in (or a share token)
Page title: Unsubscribe
Heading on the page: Invalid unsubscribe link.

This link has expired or is not valid. Sign in to manage your email preferences from your profile.

### Verify Email
Route: /verify-email
Access: signed in (or a share token)
Page title: Verify Email

This page exists at /verify-email. Its source states no description in a form that could be quoted here, so say what it is called and where it lives, and do not describe what it does beyond that.

## Staff and admin

### Admin panel
Route: /admin
Access: signed in (or a share token)
Page title: Admin
Heading on the page: Couldn't load the admin panel
In-app navigation label: Admin panel
Also known as: staff moderation users

The admin data request failed. This is a server or network problem, not a permissions one, so your account is fine.

### Conversation
Route: /admin/ai-chats/[id]
Access: signed in (or a share token)
Heading on the page: Conversation

Rendered with the same markdown and reasoning-block pipeline as the live chat widget.
