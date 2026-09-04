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

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /.

### How VulnRadar compares
Route: /alternatives
Access: public, no account needed
Page title: Open-Source Scanner Alternatives Compared

VulnRadar is an open-source, GPL-3.0 web vulnerability scanner you can self-host, with a free tier and paid plans from $5 a month. Here is an honest look at where it fits next to the better-known commercial tools. No invented competitor prices, no disparagement.

### Assets
Route: /assets
Access: signed in (or a share token)
Page title: Assets
In-app navigation label: Assets
Also called: hosts, inventory

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /assets.

### Attack Surface
Route: /attack-surface
Access: signed in (or a share token)
Page title: Attack Surface
In-app navigation label: Attack Surface
Also called: domains, verified, portfolio

Your verified domain portfolio. Verifying a domain proves you own it: a verified apex covers every subdomain beneath it and unlocks active probing, authenticated scans, and subdomain discovery across those assets.

### Status badge
Route: /badge
Access: signed in (or a share token)
Page title: Security Badge
In-app navigation label: Status badge
Also called: embed, snippet, readme, svg

Pick a scan and get an image that links back to the full report. The badge is tied to that URL, not that one scan: every time you scan it again, the badge updates on its own. Paste the embed code once and forget it.

### Live Browser Session
Route: /browser/[id]
Access: signed in (or a share token)
Page title: Live Browser Session

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /browser/[id].

### Changelog
Route: /changelog
Access: public, no account needed
Page title: Changelog: New Checks and Fixed Detectors
In-app navigation label: Changelog
Also called: releases, versions, what, is, new

Every release in order, including the security fixes, not just the features. Each release is grouped by what kind of change it is, so you can read only the part you came for.

### /checks
Route: /checks
Access: public, no account needed

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /checks.

### Compare scans
Route: /compare
Access: signed in (or a share token)
Page title: Compare Scans
In-app navigation label: Compare scans
Also called: diff, difference, regression

Diff two scans of the same host. Because finding IDs do not change between runs, the difference is real: what appeared, what you closed, and what has been sitting there the whole time.

### Contact and support tickets
Route: /contact
Access: public, no account needed
Page title: Contact: Bugs, False Positives, and Support
In-app navigation label: Contact and support tickets
Also called: help, ticket, email, support

Bugs, false positives, feature ideas, security disclosures, or enterprise deployments: pick a category and it goes to the right place.

### Scanner
Route: /dashboard
Access: signed in (or a share token)
Page title: Dashboard
In-app navigation label: Scanner
Also called: scan, new, dashboard

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /dashboard.

### Live Demo: Scan Any URL in 3 Seconds
Route: /demo
Access: public, no account needed
Page title: Live Demo: Scan Any URL in 3 Seconds

Scan any URL and see a full security report in under 3 seconds. No signup, no agent to install. Try the scanner before creating an account.

### Donate
Route: /donate
Access: public, no account needed
Page title: Donate: Fund Open-Source Scanner Development
In-app navigation label: Donate
Also called: support, sponsor, fund

VulnRadar is GPL-3.0 and free to self-host. Donations pay for the hosting behind the public instance and the time spent chasing false positives out of the detection engine.

### History
Route: /history
Access: signed in (or a share token)
Page title: Scan History
In-app navigation label: History
Also called: past, scans, results

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /history.

### Host Report
Route: /host/[hostname]
Access: signed in (or a share token)
Page title: Host Report

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /host/[hostname].

### Scan Any Website for Security Issues
Route: /landing
Access: public, no account needed
Page title: Scan Any Website for Security Issues

Paste a URL, get a security report in under 3 seconds: the full check catalogue deterministic checks across headers, TLS, cookies, DNS, and secrets. No agent to install.

### Pricing
Route: /pricing
Access: public, no account needed
Page title: Pricing: Free Tier and Plans From $5/mo
In-app navigation label: Pricing
Also called: plans, cost, upgrade

Billing is switched off on this VulnRadar deployment. Every account gets the full check set, the full API, and no daily scan ceiling.

### Profile and account settings
Route: /profile
Access: signed in (or a share token)
Page title: Profile
In-app navigation label: Profile and account settings
Also called: name, email, avatar, general

Manage your account settings and preferences

### Public Scans
Route: /public-scans
Access: public, no account needed
Page title: Public Scans: Shared Reports Directory
In-app navigation label: Public Scans
Also called: directory, listed

Every scan someone chose to list here, most recent first. Each one links to the full read-only report. Sharing a scan lists it by default, unless you or your account settings say otherwise.

### Repos
Route: /repos
Access: signed in (or a share token)
Page title: Repos
In-app navigation label: Repos
Also called: github, repositories, code

Run a security review on your repo source: any kind of repo, not just web apps. Bots, games, CLIs, libraries, whatever. Not URL/HTTP problems, actual code-level issues.

### Report a security issue
Route: /security
Access: public, no account needed

VulnRadar is a security scanner, so we hold our own code to the same bar. If you have found a vulnerability, we want to hear about it before anyone else does. This page is the one place that tells you how to reach us, what we treat as in scope, and what you can expect once you hit send.

### Shared Scan Report
Route: /shared/[token]
Access: signed in (or a share token)
Page title: Shared Scan Report

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /shared/[token].

### Shared links
Route: /shares
Access: signed in (or a share token)
Page title: Shared Reports
In-app navigation label: Shared links
Also called: share, report, link

Anyone with a link below can read that report without logging in. Revoke a link and it stops working immediately.

### Teams
Route: /teams
Access: signed in (or a share token)
Page title: Teams
In-app navigation label: Teams
Also called: members, invite, organisation

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /teams.

### Join a Team
Route: /teams/join
Access: signed in (or a share token)
Page title: Join a Team

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /teams/join.

### Free security tools
Route: /tools
Access: public, no account needed
Page title: Free Online Security Tools, No Signup

Focused, single-purpose views of the VulnRadar scanner. Each one runs the same detection engine against a URL you paste, no signup and nothing to install.

### API scanner, online
Route: /tools/api-scanner
Access: public, no account needed
Page title: Online API Security Scanner, No Agent

Paste an API URL and VulnRadar checks it the way an attacker would probe it from the outside: CORS, rate limiting, GraphQL introspection, and any OpenAPI document you left reachable. No agent to install, just paste a URL.

### Check where a link really goes
Route: /tools/link-checker
Access: public, no account needed
Page title: Link & Redirect Checker: See Where It Goes

Paste a URL and VulnRadar follows it end to end: the redirect chain, the security headers, the TLS, and the reputation of wherever it lands, including links sitting behind Cloudflare. It is the check to run before you click something you were sent.

## Checkout and credit top-ups

### AI Credits
Route: /ai-credits
Access: public, no account needed
Page title: AI Credits

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /ai-credits.

### Live-Browser Minutes
Route: /browser-credits
Access: public, no account needed
Page title: Live-Browser Minutes

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /browser-credits.

### Checkout
Route: /checkout/[productId]
Access: signed in (or a share token)
Page title: Checkout

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /checkout/[productId].

### /checkout/browser-credits
Route: /checkout/browser-credits
Access: signed in (or a share token)

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /checkout/browser-credits.

### /checkout/credits
Route: /checkout/credits
Access: signed in (or a share token)

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /checkout/credits.

### /checkout/github-credits
Route: /checkout/github-credits
Access: signed in (or a share token)

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /checkout/github-credits.

### Checkout Complete
Route: /checkout/success
Access: signed in (or a share token)
Page title: Checkout Complete

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /checkout/success.

### Credits
Route: /credits
Access: public, no account needed
Page title: Credits

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /credits.

### GitHub Review Credits
Route: /github-credits
Access: public, no account needed
Page title: GitHub Review Credits

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /github-credits.

## Legal and policy pages

### /legal
Route: /legal
Access: public, no account needed

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /legal.

### Acceptable Use Policy: What You May Scan
Route: /legal/acceptable-use
Access: public, no account needed
Page title: Acceptable Use Policy: What You May Scan

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /legal/acceptable-use.

### Accessibility Statement and Conformance
Route: /legal/accessibility
Access: public, no account needed
Page title: Accessibility Statement and Conformance

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /legal/accessibility.

### Disclaimer: Scan Results Are Informational
Route: /legal/disclaimer
Access: public, no account needed
Page title: Disclaimer: Scan Results Are Informational

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /legal/disclaimer.

### DMCA & Copyright: How to File a Notice
Route: /legal/dmca
Access: public, no account needed
Page title: DMCA & Copyright: How to File a Notice

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /legal/dmca.

### Privacy Policy: Data, Retention, and Rights
Route: /legal/privacy
Access: public, no account needed
Page title: Privacy Policy: Data, Retention, and Rights

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /legal/privacy.

### Terms of Service: Authorized Use and Limits
Route: /legal/terms
Access: public, no account needed
Page title: Terms of Service: Authorized Use and Limits

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /legal/terms.

## Sign-in and account recovery

### Reset Password
Route: /forgot-password
Access: signed in (or a share token)
Page title: Reset Password

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /forgot-password.

### Sign In to History, API Keys, and Scans
Route: /login
Access: public, no account needed
Page title: Sign In to History, API Keys, and Scans

Sign in to VulnRadar to view scan history, manage API keys, schedule recurring scans, and share reports with your team.

### Set New Password
Route: /reset-password
Access: signed in (or a share token)
Page title: Set New Password

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /reset-password.

### Create a Free Scanner Account, No Card
Route: /signup
Access: public, no account needed
Page title: Create a Free Scanner Account, No Card

Create a free VulnRadar account. 25 scans a day, full API access, and scan history retained for 30 days. No card required.

### Accept a Staff Invite
Route: /staff-invite/[token]
Access: signed in (or a share token)
Page title: Accept a Staff Invite

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /staff-invite/[token].

### Invalid unsubscribe link.
Route: /unsubscribe
Access: signed in (or a share token)
Page title: Unsubscribe

This link has expired or is not valid. Sign in to manage your email preferences from your profile.

### Verify Email
Route: /verify-email
Access: signed in (or a share token)
Page title: Verify Email

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /verify-email.

## Staff and admin

### Admin panel
Route: /admin
Access: signed in (or a share token)
Page title: Admin
In-app navigation label: Admin panel
Also called: staff, moderation, users

The admin data request failed. This is a server or network problem, not a permissions one, so your account is fine.

### /admin/ai-chats/[id]
Route: /admin/ai-chats/[id]
Access: signed in (or a share token)

No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at /admin/ai-chats/[id].
