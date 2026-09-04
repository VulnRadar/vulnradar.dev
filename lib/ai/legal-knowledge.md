# VulnRadar Legal Pages: AI Knowledge

_Auto-compiled from `app/legal/*/page.tsx` on 2026-09-04._

This file is consumed by the AI system prompt at runtime (via the
/legal slash command) so the assistant can answer questions about
data retention, account access, acceptable use, and liability using
the actual current policy text, not a guess. Edit the source pages;
this file regenerates on `npm run build` and `npm run dev`.

IMPORTANT for the assistant: this is informational context, not legal
advice. Quote or summarize what these pages say; never speculate
beyond what's written here, and tell the user to read the actual page
or contact support for anything this file doesn't cover.

---

## Terms of Service
Route: /legal/terms
Last updated: 2026-08-14

### 1. Description of Service
VulnRadar is a web-based vulnerability scanning tool that analyzes
websites for security misconfigurations, missing security headers,
exposed secrets, and other potential vulnerabilities. Beyond passive
checks (reading response headers, page content, and configuration),
some checks actively probe the target with test payloads (for example,
to detect SQL injection or server-side template injection) to confirm
a finding. The Service provides automated security assessments,
detailed findings with severity ratings, and remediation guidance.

Security Tool Disclaimer:
Scan results provided by VulnRadar are informational only and may
contain false positives or false negatives. The Service does not
guarantee the detection of all vulnerabilities or security issues.

Service Availability Disclaimer:

We do not guarantee that the Service will be uninterrupted, secure, or
error-free.

### 2. Eligibility
You must be at least 13 years of age to use this Service. If you are
between 13 and 18 years of age, you may only use the Service with the
consent and supervision of a parent or legal guardian who agrees to be
bound by these Terms on your behalf.

Parents and guardians: If
you permit a minor to use the Service, you are responsible for their
activity and agree to supervise their use.

### 3. Account Responsibilities
- You are responsible for maintaining the confidentiality of your account credentials, API keys, and 2FA backup recovery codes.
- You are responsible for all activity that occurs under your account.
- You agree to notify us immediately of any unauthorized use of your account.
- We reserve the right to suspend or terminate accounts that violate these Terms.

### 4. Authorized Use Only
You may only scan websites that you own or have explicit written
authorization to test.

Unauthorized scanning of third-party websites may violate laws
including the Computer Fraud and Abuse Act (CFAA).

By using VulnRadar, you represent and warrant that:

- You have proper authorization from the website owner to perform security scans.
- You are using the Service for legitimate security research, testing, or educational purposes only.
- You will not use the Service to discover vulnerabilities for exploitation or malicious activity.
- You will comply with all applicable laws and regulations.

### 5. Prohibited Activities
You agree NOT to:

- Scan any website without authorization from its owner.
- Use the Service to perform denial-of-service attacks or any form of disruption.
- Attempt to bypass rate limits, authentication, or any security measures of the Service.
- Use the Service for any unlawful, harmful, or malicious purposes.
- Redistribute, resell, or sublicense access to the API.
- Reverse-engineer, decompile, or disassemble any part of the Service.

### 6. API Usage
Access to the VulnRadar API is subject to rate limits and a cap on
how many API keys you may have at once, both based on your
subscription plan. We reserve the right to modify rate limits at any
time. Abuse of the API may result in immediate suspension.

Technical reference: current limits are documented on the

Rate Limits

page, and the endpoints themselves on the

API Reference

.

### 7. Data Retention &amp; Deletion
Scan history is kept for as long as your account is active. API usage
logs are retained for 90 days. Data export requests are
retained for 60 days. You may delete your account and
all associated data at any time from your profile page; see the

Privacy Policy&apos;s Data Retention section

for the full list of retention windows.

Data Deletion Rights: We reserve the right to delete
any scan data, user account data, or other information associated with
your account at any time and for any reason, including (but not
limited to) policy violations, security concerns, content moderation,
or routine maintenance. Such deletion may be performed without prior
notice and without liability.

You agree that VulnRadar is under no obligation to retain, restore,
or provide backup copies of deleted data. We are not responsible for
any loss or damages resulting from data deletion.

### 8. Limitation of Liability
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE"
WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.

VulnRadar shall not be liable for any direct, indirect, incidental,
special, consequential, or exemplary damages resulting from your use
of the Service, including damages from unauthorized scanning, legal
consequences from misuse, or false positives/negatives in scan
results.

TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY SHALL NOT
EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE TWELVE (12)
MONTHS PRECEDING THE CLAIM, OR (B) $100 USD.

### 9. Indemnification
You agree to indemnify, defend, and hold harmless VulnRadar and its
operators from any claims, damages, or expenses arising from your use
of the Service or violation of these Terms.

### 10. Termination
We reserve the right to suspend or terminate your access at any time
for violation of these Terms. Upon termination, your right to use the
Service ceases immediately. You may delete your account at any time.

### 11. Governing Law
These Terms shall be governed by and construed in accordance with the
laws of the State of Missouri, United States. Any legal action shall
be brought exclusively in the state or federal courts located in
Missouri.

### 12. Dispute Resolution
PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR LEGAL RIGHTS.

You and VulnRadar agree that any dispute will be resolved through
binding arbitration, rather than in court, except for claims in small
claims court. Before initiating arbitration, contact us at
the support email address listed on this page to attempt informal resolution.

### 13. Class Action Waiver
YOU AND {APP_NAME.toUpperCase()} AGREE THAT EACH MAY BRING CLAIMS ONLY
IN YOUR INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN
ANY CLASS OR REPRESENTATIVE PROCEEDING.

### 14. Changes to Terms
We may update these Terms at any time. When we make material changes,
we will notify you by displaying a prominent notice within the Service
or by email. Continued use constitutes acceptance of the revised
Terms.

### 15. Contact
For questions about these Terms, please contact us at

the support email address listed on this page

.

## Privacy Policy
Route: /legal/privacy
Last updated: 2026-08-14

### 1. Information We Collect
Account Information

- Name: provided at registration.
- Email address: used for account identification
and login.
- Password: stored as a salted, cryptographically
hashed value using scrypt.
- Two-factor authentication data: if enabled, your
TOTP secret, encrypted, and your backup recovery codes, hashed the
same way as your password (one-way, so we cannot recover a lost
backup code any more than we can recover a lost password).

Usage Data

- Scan history: URLs you scan, scan results, and
timestamps. If you assign a scan (or an API key, webhook, or
scheduled scan) to a team, co-members of that team whose role
grants read access can view it, and co-members whose role grants
write access can modify or delete it. Each team&apos;s

Members page

shows exactly what each role can do.
- API usage: timestamps of API requests made with
your API keys.
- Session data: session tokens stored as HTTP-only
cookies.
- IP address and browser user agent: recorded
against each sign-in session (so you can see and revoke your own
sessions from

Profile > Security

), against a device you mark as trusted, and against a security
alert or an administrative action when one is raised. They are not
used to profile you or build an advertising audience.
- AI chat messages: if you use the AI assistant,
your messages and its replies are stored so the conversation can
continue across page loads.

Data We Do NOT Collect

- We do not use analytics, tracking pixels, or third-party advertising cookies.
- We do not sell, rent, or share your personal information for marketing purposes.
- We do not collect data about websites you scan beyond what is
necessary for the scan report. Producing that report does send the
URL or hostname you scanned to the threat-intelligence and
vulnerability-database services listed in Section 4, and the
optional live browser viewer and browser-based authenticated login
route that one scan through a third-party remote-browser provider.
Nothing beyond the scan itself is shared.
- Login credentials you provide for an authenticated scan are used
only in memory for that single scan and are never written to our
database or logs.

### 2. Browser Extension
The VulnRadar browser extension (Chrome and Firefox) connects to your
{" " + APP_NAME} account using an API key you generate and paste into
the extension&apos;s Settings page. It scans whatever page you tell it
to scan and, if you turn on its optional features, watches the pages
you browse to offer a scan or show a past result.

What the extension sends to our servers

- Your API key, on every request, to authenticate
you.
- The URL of the page you manually scan, whether
triggered from the popup, the right-click "Scan this
link" menu item, or the on-page card&apos;s "Scan this
site" button.
- The URL (and page title) of pages you visit, while a feature
that needs it is turned on

: the on-page "Site Alerts" card (shows a past result or
a one-click scan offer) and auto-scan (background scanning without
you clicking anything). Both are configurable independently in
Settings; auto-scan is off by default. If both are off, the
extension does not report page visits at all.

What the extension does NOT do

- It does not read, copy, or transmit the content of the pages you visit (text, images, forms, or scripts). It only sends the URL and, where noted above, the page title.
- It does not monitor clicks, keystrokes, mouse movement, or scrolling on any page.
- It does not run any code it fetches at runtime; everything it executes ships inside the extension package you installed from the Chrome Web Store or Firefox Add-ons.

What is stored on your device

Your API key, extension settings, and a local cache of recent scan
results are stored in the browser&apos;s own extension storage (

browser.storage.local

), on your device only. Uninstalling the extension deletes all of it.
It does not touch the account or scan history stored on our servers,
covered under Section 1 above and deleted the same way regardless of
whether you ever installed the extension.

### 3. How We Use Your Information
- To provide, maintain, and improve the Service.
- To authenticate your identity and manage your sessions.
- To enforce our Terms of Service and prevent abuse.
- To respond to data export requests when you initiate them.
- To send transactional emails (password resets, account notifications, team invitations).
- To improve the AI assistant: when you use
VulnRadar&apos;s own AI (not a provider key you connected
yourself), staff may review conversation transcripts and use them
to fix bad responses, tune the assistant&apos;s prompts, and,
where we do so, to train or fine-tune the underlying AI models.
This does not apply when you use your own connected AI provider
account (Profile > AI settings): those conversations go
directly to the provider you chose and are not reviewed or used by
us.
- To provide account support: an admin responding
to a support request can temporarily sign in as your account
(impersonation) to reproduce or fix the issue you reported. This
requires the admin&apos;s own password, is logged to the admin
audit trail, ends automatically after one hour, and shows a
persistent on-screen banner in your account for as long as it is
active.

### 4. Third-Party Service Providers
We may share your information with service providers who help us
operate the Service. These providers only have access to your data as
necessary to perform their functions:

- Payment Processing (Stripe): If you subscribe to
a paid plan, Stripe processes your payment. We do not store credit
card numbers.
- Email Service (SMTP Provider): We use an email
service for transactional emails. Only your email and name are
shared.
- Google OAuth (Optional): If you sign in with
Google, we receive your basic account information (email address
and profile) to create or match your account.
- Discord OAuth (Optional): If you sign in with
Discord, we receive basic account information.
- GitHub OAuth (Optional): If you sign in with
GitHub, we receive basic account information (email address and
profile). If you additionally connect a GitHub account for
repo-based AI code review, we store your GitHub username, user ID,
granted OAuth scopes, and an encrypted copy of the access token.
GitHub&apos;s OAuth apps have no read-only scope for private
repositories, so the token is technically capable of read/write
access to whatever repos you authorize, even though the feature
itself only reads the files you select.
- Cloudflare Turnstile (CAPTCHA): Cloudflare may
collect limited device data to prevent abuse.
- Threat reputation lookups: a scan checks the
target against public abuse feeds, which means the URL or its
hostname leaves our infrastructure. Google Web Risk receives the
full URL and URLhaus (abuse.ch) receives the hostname, both only
when the operator has configured a key for them. Quad9 receives
the hostname on every scan: it is a public security DNS resolver
that needs no key, so the lookup is a plain DNS query and cannot
be turned off by leaving a key unset. None of these receive your
account, your email, or anything else about you.
- Vulnerability databases (OSV.dev and the NVD):
when a scan fingerprints a server, framework, or library version,
that component name and version is sent to OSV.dev and the NVD
REST API to correlate it with known CVEs. Names and version
numbers only: neither receives the URL you scanned or anything
about your account.
- Remote Browser Sessions (Browserbase, Optional):
Used when you open the live scan viewer or when authenticated
scanning uses browser-based login. Browserbase runs a short-lived
(a few minutes) remote browser session to do this and may record
video and network logs of that session under its own retention
policy. The URL you are scanning, and for browser-based login the
login page itself, is sent to Browserbase to open the session.
Only used if the operator has Browserbase configured.
- AI Chat Assistant & Scan Verification (Optional)

: If enabled, messages you send to the AI assistant, scan findings
submitted for AI verification, and, if you use the GitHub repo AI
code review feature, the source files you select from a connected
repo, are forwarded to a configured AI provider (for example
OpenAI, Anthropic, or a self-hosted model, depending on how the
operator has configured it) to generate a response. You can also
connect your own AI provider account from Profile > AI
settings, in which case those requests go directly to the provider
you choose using your own API key instead.

Self-Hosted Database: Our
database is self-hosted and managed directly by us.

### 5. Data Storage and Security
Your data is stored in a PostgreSQL database hosted on our own
infrastructure. Passwords are hashed using scrypt with random salts.
Session tokens are cryptographically random values; the token itself,
not a hash of it, is what we look up on each request, the same way
most session systems work, so protecting database access matters as
much as anything else here. API keys are encrypted at rest
(AES-256-GCM) using a server-side key the operator controls, or, if
that key isn&apos;t configured, hashed with bcrypt instead; either way
the raw key is shown to you once, at creation, and never displayed
again.

Security Disclaimer:
While we implement industry-standard security measures, no method of
transmission over the Internet is completely secure.

Implementation detail for the curious: see the

Authentication section

of the architecture docs.

### 6. Data Retention
- Scan history: kept for as long as your account is
active, on every plan. Deleting your account deletes your scan
history immediately.
- API usage logs: 90 days, then
automatically deleted.
- AI chat history: 90 days, then
automatically deleted. Deleting your account deletes it
immediately rather than waiting for that window.
- Expired sessions: removed by an automatic cleanup
pass that runs every few minutes, and again on every server start;
an expired session stops working immediately regardless of when
the row is actually deleted.
- Revoked API keys: 30 days after
revocation, then automatically deleted.
- Data export requests: 60 days,
then automatically deleted.
- Billing and invoice history: kept for as long as
your account exists and deleted when you delete your account.
- Security alerts: 180 days, then
automatically deleted; deleting your account deletes them
immediately.
- Finding feedback: if you mark a finding
confirmed, false positive, or not applicable, that verdict and any
notes you add are kept for 90 days, then automatically
deleted. Deleting your account deletes the entry immediately
rather than waiting for that window, because it carries the URL
you scanned and whatever you typed into the notes field.
- In-app notifications: the notification-bell feed
(e.g. "your scheduled scan finished") is kept for
90 days, then automatically deleted; deleting your
account deletes them immediately.
- Email delivery logs: a record that an email was
attempted (recipient address, subject line, delivery status, and a
redacted preview of the content, with links, codes, and tokens
stripped out) is kept for 30 days for deliverability
troubleshooting, then automatically deleted. This table has no
account column and is keyed only by the recipient address, so
deleting your account purges it by that address instead, and the
rows go at the same time as everything else.
- Admin notes: 365 days, then
automatically deleted.
- Admin audit log: entries move from the active
table to a permanent, indefinite compliance archive after
365 days, rather than being deleted, so the platform
keeps a lasting record of what administrative action was taken and
by whom. If you delete your account, any entries still in the
active table that reference you as the target of an admin action
are de-identified (the link to your account is removed, the record
of what happened is kept). Entries already moved to the archive
before you delete your account keep their original data, since the
archive exists specifically as an immutable historical record.
- System error logs: when a server-side error
occurs, the diagnostic message is captured for troubleshooting
with secrets and email addresses automatically redacted before
storage. These logs are visible only to administrators and are
kept for 30 days, then automatically deleted.

### 7. Your Rights
You have the right to:

- Access your data: Request a full export from your
profile page.
- Correct your data: Update your name, email, or
password from your profile page.
- Delete your data: Permanently delete your account
from your profile page.
- Export your data: Download a JSON file via the
data export feature.

### 8. Cookies
Every cookie we set is strictly functional: none are used for
advertising, tracking, or third-party analytics, so none of them
require your consent.

HTTP-only (not readable by page scripts)

- vulnradar_session

: maintains your login state.
- vulnradar_2fa_pending

: short-lived, set only mid-login while a two-factor code is being
verified.
- vulnradar_device_trusted

: remembers a device you marked as trusted so you are not asked
for a two-factor code on it again.
- vr_oauth_nonce

: short-lived, set while an OAuth sign-in (Google, GitHub, or
Discord) is in progress to protect the flow against CSRF.
- oauth_pending_login

/

discord_pending_login

: short-lived (5 minutes), set only mid-login if you sign in with
an OAuth provider and two-factor authentication is required to
finish.
- Staff-only, when applicable:

staff_oidc_nonce

(staff single sign-on) and

imp_return_session

(lets an administrator return to their own session after a logged,
time-limited impersonation).

Preference cookies (not HTTP-only, no personal data)

- vulnradar_last_seen_version

: remembers the last app version you saw so the "what&apos;s
new" notification does not reappear.
- A per-notification dismissal cookie so a banner or announcement you closed does not reappear.

### 9. Your Rights Under GDPR (EEA Residents)
If you are in the European Economic Area, you have these rights under
GDPR:

- Right of Access (Article 15) - Request a copy of
your personal data.
- Right to Rectification (Article 16) - Request
correction of inaccurate data.
- Right to Erasure (Article 17) - Request deletion
of your data.
- Right to Restriction (Article 18) - Request we
restrict processing.
- Right to Data Portability (Article 20) - Request
data in machine-readable format.
- Right to Object (Article 21) - Object to
processing of your data.

How to exercise your rights:

Use your

Profile settings

or email us at

the support email address listed on this page

.

### 10. Your Rights Under CCPA/CPRA (California Residents)
California residents have these rights:

- Right to Know - Request information about data we
collect.
- Right to Delete - Request deletion of your
personal information.
- Right to Correct - Request correction of
inaccurate data.
- Right to Opt-Out - We do not sell or share your
personal information.
- Right to Non-Discrimination - We will not
discriminate for exercising rights.

Do Not Sell My Personal Information:

We do not sell your personal information or share it for cross-context
behavioral advertising.

### 11. Children's Privacy
The Service is intended for users 13 years of age and older. We do not
knowingly collect personal information from children under 13. If we
learn we have collected such information, we will delete it as quickly
as possible.

### 12. Changes to This Policy
We may update this Privacy Policy at any time. When we make material
changes, we will notify you by displaying a prominent notice within
the Service or by sending you an email.

### 13. Contact
For questions about this Privacy Policy, please contact us at

the support email address listed on this page

.

## Acceptable Use Policy
Route: /legal/acceptable-use
Last updated: 2026-08-14

### 1. Permitted Uses
You may use VulnRadar to:

- Scan websites that you own and operate.
- Scan websites for which you have explicit, documented written permission.
- Perform security assessments as part of an authorized bug bounty program where automated scanning is permitted.
- Conduct security research on your own infrastructure or test environments.
- Educate yourself about web security best practices using your own test sites.

### 2. Prohibited Uses
You may NOT use
VulnRadar to:

- Scan any website without authorization from its owner.
- Discover vulnerabilities for exploitation, unauthorized access, data theft, or extortion.
- Perform reconnaissance for malicious purposes.
- Conduct denial-of-service attacks or disrupt any service.
- Bypass rate limits or abuse the API.
- Perform large-scale internet-wide scanning without authorization.
- Scan government, military, financial, healthcare, or critical infrastructure systems without explicit authorization.
- Share scan results publicly that could enable exploitation before remediation.
- Use scan results to blackmail, extort, or coerce website owners.

### 3. Authorization Documentation
When scanning websites you do not own, you must maintain
documentation. Acceptable forms include:

- Written permission (email, letter, or contract) from the website owner.
- Active participation in a bug bounty program that permits automated scanning.
- A penetration testing agreement or security assessment contract.
- Employment where security testing is part of your job duties.

You are solely responsible

for obtaining and maintaining proof of authorization. VulnRadar may
request proof at any time. Failure to provide adequate documentation
may result in account suspension.

### 4. Bug Bounty Programs
If you use VulnRadar for bug bounty hunting:

- Verify that the program scope explicitly permits automated scanning tools.
- Comply with all program rules, including rate limiting and out-of-scope areas.
- Do not scan targets that are explicitly listed as out-of-scope.
- Report findings through the program's designated channels.
- Do not publicly disclose vulnerabilities without following the program's disclosure policy.

Disclaimer: VulnRadar
does not guarantee that any particular bug bounty program permits our
service. You are responsible for verifying program rules.

### 5. Security Research Safe Harbor
We support good-faith security research. If conducting legitimate
research in compliance with this policy:

- You must have proper authorization as described above.
- You must not access, modify, or exfiltrate data beyond demonstrating a vulnerability.
- You must report findings responsibly and allow reasonable remediation time.
- You must not conduct research on critical infrastructure without explicit authorization.

Important: This safe
harbor applies only to your use of VulnRadar. We cannot provide legal
protection for your interactions with third-party targets.

### 6. Responsible Disclosure
If you discover vulnerabilities while performing authorized testing,
we encourage responsible disclosure:

- Report findings privately to the website owner before any public disclosure.
- Allow reasonable time (typically 90 days) for remediation before disclosure.
- Do not exploit discovered vulnerabilities beyond demonstrating the issue.
- Follow the target's vulnerability disclosure policy if one exists.

### 7. Rate Limits and Fair Use
Your account has a daily scan quota and a cap on how many API keys you
may have at once, both set by your subscription plan. These limits
prevent abuse and ensure fair access. Attempting to circumvent rate
limits may result in immediate account suspension.

Full quota table: see

Rate Limits

in the docs.

### 8. Enforcement
Violations of this Acceptable Use Policy may result in:

- Temporary or permanent suspension of your account.
- Revocation of all API keys.
- Reporting to appropriate law enforcement authorities if illegal activity is suspected.
- Legal action to recover damages.
- Cooperation with law enforcement investigations.

### 9. Reporting Abuse
If you believe VulnRadar is being used in violation of this policy,
please report it to

the security contact email listed on this page

. For general legal inquiries, contact

the support email address listed on this page

.

## Disclaimer
Route: /legal/disclaimer
Last updated: 2026-08-14

### 1. No Warranty
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE"
WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

We make no warranty that:

- Scan results are complete, accurate, or free from errors.
- The Service will identify all vulnerabilities present on a target.
- The Service will be uninterrupted, timely, or error-free.
- Remediation guidance will resolve all security issues.
- The Service will meet your specific requirements.

### 2. Not Professional Security Advice
VulnRadar scan results do
NOT constitute
professional security advice, a security audit, or a penetration test.
The results should be used as a starting point for further
investigation. For comprehensive security assessments, consult a
qualified cybersecurity professional.

### 3. Accuracy of Results
VulnRadar performs the current check count (see /checks) automated vulnerability
checks. Most read only what the target already returns: response
headers, page content, certificates, and DNS records. A smaller set
confirms a finding by sending a test payload to the target, and those
run only when a scan asks for them by name and only against a domain
verified on the requesting account. Results may include:

- False positives: issues flagged that are not
actual vulnerabilities in your context.
- False negatives: real vulnerabilities that the
scanner does not detect.
- Incomplete coverage: the scanner checks specific
known issues, not all vulnerability classes.

### 4. Your Responsibility
You are solely responsible for:

- Ensuring you have proper authorization before scanning any website.
- Verifying scan results before taking any action.
- Any consequences resulting from scanning a website.
- Compliance with all applicable laws and regulations.
- Any damages to systems or data resulting from actions based on scan results.

### 5. Limitation of Liability
IN NO EVENT SHALL {APP_NAME.toUpperCase()}, ITS OPERATORS,
CONTRIBUTORS, OR AFFILIATES BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES.

OUR TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE GREATER OF (A) THE
AMOUNTS YOU HAVE PAID IN THE TWELVE (12) MONTHS PRIOR TO THE CLAIM, OR
(B) $100 USD.

### 6. Indemnification
You agree to indemnify, defend, and hold harmless VulnRadar and its
operators from any claims, damages, or expenses arising from:

- Your use of and access to the Service.
- Your violation of any term of these Terms or related policies.
- Your violation of any third-party right.
- Any claim that your use of the Service caused damage to a third party.
- Unauthorized scanning of websites you do not own or have permission to test.

### 7. Legal Compliance
Unauthorized computer scanning may violate criminal and civil laws
including:

- United States: Computer Fraud and Abuse Act
(CFAA), 18 U.S.C. § 1030
- Missouri: Missouri Computer Tampering Laws, Mo.
Rev. Stat. § 569.095-569.099
- United Kingdom: Computer Misuse Act 1990
- Germany: Strafgesetzbuch (StGB) Section 202c
- European Union: Directive 2013/40/EU on attacks
against information systems

It is your responsibility to understand and comply with the laws
applicable in your jurisdiction and the jurisdiction where the target
systems are located.

### 8. Governing Law
This Disclaimer shall be governed by the laws of the State of
Missouri, United States. Any disputes shall be subject to the
exclusive jurisdiction of the courts located in Missouri.

### 9. Contact
For questions about this Disclaimer, please contact us at

the support email address listed on this page

.

VulnRadar is operated from Missouri, United States.

## DMCA Policy
Route: /legal/dmca
Last updated: 2026-08-14

### 1. Reporting Copyright Infringement
If you believe that your copyrighted work has been copied in a way
that constitutes copyright infringement and is accessible through our
Service, please notify our designated DMCA agent. For your complaint
to be valid under the DMCA, you must provide:

- A physical or electronic signature of a person authorized to act on behalf of the copyright owner.
- Identification of the copyrighted work claimed to have been infringed.
- Identification of the material that is claimed to be infringing and where it is located on the Service.
- Your contact information, including address, telephone number, and email address.
- A statement that you have a good faith belief that use of the material is not authorized.
- A statement, made under penalty of perjury, that the information is accurate and that you are authorized to act on the copyright owner's behalf.

### 2. Designated DMCA Agent
Please send DMCA notices to our designated agent:

Email:

the support email address listed on this page

Subject Line: DMCA Takedown Notice

### 3. Counter-Notification
If you believe that your material was removed or disabled by mistake
or misidentification, you may submit a counter-notification. Your
counter-notification must include:

- Your physical or electronic signature.
- Identification of the material that was removed and where it appeared before removal.
- A statement under penalty of perjury that you have a good faith belief the material was removed by mistake.
- Your name, address, telephone number, and consent to the jurisdiction of the federal district court (Missouri if outside the US).

### 4. Repeat Infringers
In accordance with the DMCA and other applicable law, we have adopted
a policy of terminating, in appropriate circumstances, users who are
deemed to be repeat infringers. We may also limit access to the
Service and/or terminate accounts of users who infringe intellectual
property rights of others.

### 5. Good Faith
Please note that under Section 512(f) of the DMCA, any person who
knowingly materially misrepresents that material or activity is
infringing, or that material was removed by mistake or
misidentification, may be subject to liability for damages, including
costs and attorneys&apos; fees.

### 6. Modifications
We reserve the right to modify this DMCA Policy at any time. Changes
will be posted on this page with an updated revision date.

## Accessibility Statement
Route: /legal/accessibility
Last updated: 2026-08-14

### 1. Conformance Status
We strive to conform to the Web Content Accessibility Guidelines
(WCAG) 2.1 Level AA standards. These guidelines explain how to make
web content more accessible for people with disabilities and more
user-friendly for everyone.

### 2. Accessibility Features
Our website includes the following accessibility features:

- Keyboard Navigation: All interactive elements can
be accessed using keyboard navigation.
- Screen Reader Compatibility: Our pages are
structured with proper headings, landmarks, and ARIA labels.
- Color Contrast: We maintain sufficient color
contrast ratios between text and backgrounds.
- Focus Indicators: Visible focus indicators help
users navigate with keyboards.
- Alternative Text: Images include descriptive alt
text where appropriate.
- Responsive Design: Content is accessible across
different screen sizes and zoom levels.
- Form Labels: Form inputs carry associated labels
or accessible names.
- Skip Links: Skip navigation links allow users to
bypass repetitive content.

### 3. Technologies Used
Accessibility of VulnRadar relies on:

- HTML
- CSS
- JavaScript
- WAI-ARIA

These technologies are relied upon for conformance with accessibility
standards.

### 4. Known Limitations
Despite our best efforts, there may be some limitations:

- Third-party content: Some integrations (such as
CAPTCHA) may have limitations. If unable to complete a CAPTCHA
challenge, please contact us at

the support email address listed on this page

.
- Complex data visualizations: Some security scan
result charts may require additional screen reader descriptions.
- PDF exports: Exported PDF reports may not be
fully accessible. We recommend using the web interface for the
most accessible experience.

### 5. Feedback
We welcome your feedback on the accessibility of VulnRadar. Please
let us know if you encounter barriers:

- Email:

the support email address listed on this page
- Contact Form:

{APP_URL.replace(/^https?:\/\//, "")}/contact

We try to respond to accessibility feedback within 5 business days.

### 6. Compatibility
VulnRadar is designed to be compatible with:

- Screen readers (NVDA, JAWS, VoiceOver, TalkBack)
- Screen magnification software
- Speech recognition software
- Keyboard-only navigation

VulnRadar is not compatible with browsers older than 3 major versions
or Internet Explorer.

### 7. Assessment Approach
VulnRadar assessed accessibility by:

- Self-evaluation by the maintainers, not by an external auditor
- Manual keyboard-only navigation and screen reader passes over the main flows
- Review of colour contrast and focus visibility against WCAG 2.1 AA

We do not currently run an automated accessibility test suite in
continuous integration. Adding one is on the roadmap, and this section
will be updated when it lands rather than in advance of it.

### 8. Continuous Improvement
We are committed to maintaining and improving accessibility. New
features get the same manual keyboard and screen reader pass described
above, and reported barriers are treated as bugs rather than requests.
