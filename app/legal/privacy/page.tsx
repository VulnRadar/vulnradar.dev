import Link from "next/link";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import {
  LegalPageHeader,
  LegalSection,
  LegalList,
  LegalToc,
} from "@/components/legal";

const SECTIONS = [
  { id: "information-we-collect", label: "1. Information We Collect" },
  { id: "browser-extension", label: "2. Browser Extension" },
  { id: "how-we-use-information", label: "3. How We Use Your Information" },
  { id: "third-party-providers", label: "4. Third-Party Service Providers" },
  { id: "data-storage-security", label: "5. Data Storage and Security" },
  { id: "data-retention", label: "6. Data Retention" },
  { id: "your-rights", label: "7. Your Rights" },
  { id: "cookies", label: "8. Cookies" },
  { id: "gdpr", label: "9. GDPR (EEA Residents)" },
  { id: "ccpa", label: "10. CCPA/CPRA (California Residents)" },
  { id: "childrens-privacy", label: "11. Children's Privacy" },
  { id: "changes-to-policy", label: "12. Changes to This Policy" },
  { id: "contact", label: "13. Contact" },
];

export default async function PrivacyPage() {
  // Every window in section 6 is rendered from the setting the cleanup pass
  // actually reads (lib/database/cleanup.ts), never from a literal typed into
  // this page. These are runtime-tier settings an operator can change from
  // Admin -> Settings, so a hardcoded "90 days" here is a promise the running
  // deployment may already be breaking.
  //
  // Split into two calls, string-valued keys and number-valued keys, rather
  // than one. getSettings returns Record<K, SettingValue<K>>, so a single call
  // mixing the two distributes into `string | number` for every field and the
  // date below stops typechecking. Both calls read the same cached snapshot.
  const { LEGAL_EMAIL: legalEmail, TERMS_UPDATED_AT: termsUpdatedAt } =
    await getSettings(["LEGAL_EMAIL", "TERMS_UPDATED_AT"] as const);
  const {
    CLEANUP_API_USAGE_RETENTION_DAYS: apiUsageDays,
    AI_CHAT_HISTORY_DAYS: aiChatDays,
    CLEANUP_REVOKED_API_KEYS_RETENTION_DAYS: revokedKeyDays,
    CLEANUP_DATA_REQUESTS_RETENTION_DAYS: dataRequestDays,
    CLEANUP_SECURITY_ALERTS_RETENTION_DAYS: securityAlertDays,
    CLEANUP_SCAN_FINDING_FEEDBACK_RETENTION_DAYS: feedbackDays,
    CLEANUP_USER_NOTIFICATIONS_RETENTION_DAYS: notificationDays,
    CLEANUP_EMAIL_LOG_RETENTION_DAYS: emailLogDays,
    CLEANUP_ADMIN_USER_NOTES_RETENTION_DAYS: adminNoteDays,
    CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS: auditLogDays,
    CLEANUP_SYSTEM_ERROR_LOGS_RETENTION_DAYS: errorLogDays,
  } = await getSettings([
    "CLEANUP_API_USAGE_RETENTION_DAYS",
    "AI_CHAT_HISTORY_DAYS",
    "CLEANUP_REVOKED_API_KEYS_RETENTION_DAYS",
    "CLEANUP_DATA_REQUESTS_RETENTION_DAYS",
    "CLEANUP_SECURITY_ALERTS_RETENTION_DAYS",
    "CLEANUP_SCAN_FINDING_FEEDBACK_RETENTION_DAYS",
    "CLEANUP_USER_NOTIFICATIONS_RETENTION_DAYS",
    "CLEANUP_EMAIL_LOG_RETENTION_DAYS",
    "CLEANUP_ADMIN_USER_NOTES_RETENTION_DAYS",
    "CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS",
    "CLEANUP_SYSTEM_ERROR_LOGS_RETENTION_DAYS",
  ] as const);
  return (
    <article className="space-y-8">
      <LegalPageHeader
        title="Privacy Policy"
        lastUpdated={termsUpdatedAt}
        type="privacy"
      />

      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        This Privacy Policy describes how {APP_NAME} (&quot;we&quot;,
        &quot;us&quot;, &quot;our&quot;) collects, uses, and protects your
        personal information when you use our Service at {APP_URL}. {APP_NAME}{" "}
        is operated by an independent developer based in Missouri, United
        States.
      </p>

      <LegalToc items={SECTIONS} />

      <LegalSection
        id="information-we-collect"
        title="1. Information We Collect"
      >
        <p className="font-medium text-foreground">Account Information</p>
        <LegalList
          items={[
            <>
              <strong>Name</strong>: provided at registration.
            </>,
            <>
              <strong>Email address</strong>: used for account identification
              and login.
            </>,
            <>
              <strong>Password</strong>: stored as a salted, cryptographically
              hashed value using scrypt.
            </>,
            <>
              <strong>Two-factor authentication data</strong>: if enabled, your
              TOTP secret, encrypted, and your backup recovery codes, hashed the
              same way as your password (one-way, so we cannot recover a lost
              backup code any more than we can recover a lost password).
            </>,
          ]}
        />

        <p className="font-medium text-foreground mt-4">Usage Data</p>
        <LegalList
          items={[
            <>
              <strong>Scan history</strong>: URLs you scan, scan results, and
              timestamps. If you assign a scan (or an API key, webhook, or
              scheduled scan) to a team, co-members of that team whose role
              grants read access can view it, and co-members whose role grants
              write access can modify or delete it. Each team&apos;s{" "}
              <a href="/teams" className="text-primary hover:underline">
                Members page
              </a>{" "}
              shows exactly what each role can do.
            </>,
            <>
              <strong>API usage</strong>: timestamps of API requests made with
              your API keys.
            </>,
            <>
              <strong>Session data</strong>: session tokens stored as HTTP-only
              cookies.
            </>,
            <>
              <strong>IP address and browser user agent</strong>: recorded
              against each sign-in session (so you can see and revoke your own
              sessions from{" "}
              <a
                href="/profile?tab=security"
                className="text-primary hover:underline"
              >
                Profile &gt; Security
              </a>
              ), against a device you mark as trusted, and against a security
              alert or an administrative action when one is raised. They are not
              used to profile you or build an advertising audience.
            </>,
            <>
              <strong>AI chat messages</strong>: if you use the AI assistant,
              your messages and its replies are stored so the conversation can
              continue across page loads.
            </>,
          ]}
        />

        <p className="font-medium text-foreground mt-4">
          Data We Do NOT Collect
        </p>
        <LegalList
          items={[
            "We do not use analytics, tracking pixels, or third-party advertising cookies.",
            "We do not sell, rent, or share your personal information for marketing purposes.",
            <>
              We do not collect data about websites you scan beyond what is
              necessary for the scan report. Producing that report does send the
              URL or hostname you scanned to the threat-intelligence and
              vulnerability-database services listed in Section 4, and the
              optional live browser viewer and browser-based authenticated login
              route that one scan through a third-party remote-browser provider.
              Nothing beyond the scan itself is shared.
            </>,
            <>
              Login credentials you provide for an authenticated scan are used
              only in memory for that single scan and are never written to our
              database or logs.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="browser-extension" title="2. Browser Extension">
        <p>
          The VulnRadar browser extension (Chrome and Firefox) connects to your
          {" " + APP_NAME} account using an API key you generate and paste into
          the extension&apos;s Settings page. It scans whatever page you tell it
          to scan and, if you turn on its optional features, watches the pages
          you browse to offer a scan or show a past result.
        </p>
        <p className="font-medium text-foreground mt-4">
          What the extension sends to our servers
        </p>
        <LegalList
          items={[
            <>
              <strong>Your API key</strong>, on every request, to authenticate
              you.
            </>,
            <>
              <strong>The URL of the page you manually scan</strong>, whether
              triggered from the popup, the right-click &quot;Scan this
              link&quot; menu item, or the on-page card&apos;s &quot;Scan this
              site&quot; button.
            </>,
            <>
              <strong>
                The URL (and page title) of pages you visit, while a feature
                that needs it is turned on
              </strong>
              : the on-page &quot;Site Alerts&quot; card (shows a past result or
              a one-click scan offer) and auto-scan (background scanning without
              you clicking anything). Both are configurable independently in
              Settings; auto-scan is off by default. If both are off, the
              extension does not report page visits at all.
            </>,
          ]}
        />
        <p className="font-medium text-foreground mt-4">
          What the extension does NOT do
        </p>
        <LegalList
          items={[
            "It does not read, copy, or transmit the content of the pages you visit (text, images, forms, or scripts). It only sends the URL and, where noted above, the page title.",
            "It does not monitor clicks, keystrokes, mouse movement, or scrolling on any page.",
            "It does not run any code it fetches at runtime; everything it executes ships inside the extension package you installed from the Chrome Web Store or Firefox Add-ons.",
          ]}
        />
        <p className="font-medium text-foreground mt-4">
          What is stored on your device
        </p>
        <p>
          Your API key, extension settings, and a local cache of recent scan
          results are stored in the browser&apos;s own extension storage (
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
            browser.storage.local
          </code>
          ), on your device only. Uninstalling the extension deletes all of it.
          It does not touch the account or scan history stored on our servers,
          covered under Section 1 above and deleted the same way regardless of
          whether you ever installed the extension.
        </p>
      </LegalSection>

      <LegalSection
        id="how-we-use-information"
        title="3. How We Use Your Information"
      >
        <LegalList
          items={[
            "To provide, maintain, and improve the Service.",
            "To authenticate your identity and manage your sessions.",
            "To enforce our Terms of Service and prevent abuse.",
            "To respond to data export requests when you initiate them.",
            "To send transactional emails (password resets, account notifications, team invitations).",
            <>
              <strong>To improve the AI assistant</strong>: when you use{" "}
              {APP_NAME}&apos;s own AI (not a provider key you connected
              yourself), staff may review conversation transcripts and use them
              to fix bad responses, tune the assistant&apos;s prompts, and,
              where we do so, to train or fine-tune the underlying AI models.
              This does not apply when you use your own connected AI provider
              account (Profile &gt; AI settings): those conversations go
              directly to the provider you chose and are not reviewed or used by
              us.
            </>,
            <>
              <strong>To provide account support</strong>: an admin responding
              to a support request can temporarily sign in as your account
              (impersonation) to reproduce or fix the issue you reported. This
              requires the admin&apos;s own password, is logged to the admin
              audit trail, ends automatically after one hour, and shows a
              persistent on-screen banner in your account for as long as it is
              active.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection
        id="third-party-providers"
        title="4. Third-Party Service Providers"
      >
        <p>
          We may share your information with service providers who help us
          operate the Service. These providers only have access to your data as
          necessary to perform their functions:
        </p>
        <LegalList
          items={[
            <>
              <strong>Payment Processing (Stripe)</strong>: If you subscribe to
              a paid plan, Stripe processes your payment. We do not store credit
              card numbers.
            </>,
            <>
              <strong>Email Service (SMTP Provider)</strong>: We use an email
              service for transactional emails. Only your email and name are
              shared.
            </>,
            <>
              <strong>Google OAuth (Optional)</strong>: If you sign in with
              Google, we receive your basic account information (email address
              and profile) to create or match your account.
            </>,
            <>
              <strong>Discord OAuth (Optional)</strong>: If you sign in with
              Discord, we receive basic account information.
            </>,
            <>
              <strong>GitHub OAuth (Optional)</strong>: If you sign in with
              GitHub, we receive basic account information (email address and
              profile). If you additionally connect a GitHub account for
              repo-based AI code review, we store your GitHub username, user ID,
              granted OAuth scopes, and an encrypted copy of the access token.
              GitHub&apos;s OAuth apps have no read-only scope for private
              repositories, so the token is technically capable of read/write
              access to whatever repos you authorize, even though the feature
              itself only reads the files you select.
            </>,
            <>
              <strong>Cloudflare Turnstile (CAPTCHA)</strong>: Cloudflare may
              collect limited device data to prevent abuse.
            </>,
            <>
              <strong>Threat reputation lookups</strong>: a scan checks the
              target against public abuse feeds, which means the URL or its
              hostname leaves our infrastructure. Google Web Risk receives the
              full URL and URLhaus (abuse.ch) receives the hostname, both only
              when the operator has configured a key for them. Quad9 receives
              the hostname on every scan: it is a public security DNS resolver
              that needs no key, so the lookup is a plain DNS query and cannot
              be turned off by leaving a key unset. None of these receive your
              account, your email, or anything else about you.
            </>,
            <>
              <strong>Vulnerability databases (OSV.dev and the NVD)</strong>:
              when a scan fingerprints a server, framework, or library version,
              that component name and version is sent to OSV.dev and the NVD
              REST API to correlate it with known CVEs. Names and version
              numbers only: neither receives the URL you scanned or anything
              about your account.
            </>,
            <>
              <strong>Remote Browser Sessions (Browserbase, Optional)</strong>:
              Used when you open the live scan viewer or when authenticated
              scanning uses browser-based login. Browserbase runs a short-lived
              (a few minutes) remote browser session to do this and may record
              video and network logs of that session under its own retention
              policy. The URL you are scanning, and for browser-based login the
              login page itself, is sent to Browserbase to open the session.
              Only used if the operator has Browserbase configured.
            </>,
            <>
              <strong>
                AI Chat Assistant &amp; Scan Verification (Optional)
              </strong>
              : If enabled, messages you send to the AI assistant, scan findings
              submitted for AI verification, and, if you use the GitHub repo AI
              code review feature, the source files you select from a connected
              repo, are forwarded to a configured AI provider (for example
              OpenAI, Anthropic, or a self-hosted model, depending on how the
              operator has configured it) to generate a response. You can also
              connect your own AI provider account from Profile &gt; AI
              settings, in which case those requests go directly to the provider
              you choose using your own API key instead.
            </>,
          ]}
        />
        <p className="mt-3">
          <strong className="text-foreground">Self-Hosted Database</strong>: Our
          database is self-hosted and managed directly by us.
        </p>
      </LegalSection>

      <LegalSection
        id="data-storage-security"
        title="5. Data Storage and Security"
      >
        <p>
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
        </p>
        <p className="mt-2">
          <strong className="text-foreground">Security Disclaimer:</strong>{" "}
          While we implement industry-standard security measures, no method of
          transmission over the Internet is completely secure.
        </p>
        <p className="mt-2 text-xs">
          Implementation detail for the curious: see the{" "}
          <Link
            href="/docs/architecture#auth"
            className="text-primary hover:underline"
          >
            Authentication section
          </Link>{" "}
          of the architecture docs.
        </p>
      </LegalSection>

      <LegalSection id="data-retention" title="6. Data Retention">
        <LegalList
          items={[
            <>
              <strong>Scan history:</strong> kept for as long as your account is
              active, on every plan. Deleting your account deletes your scan
              history immediately.
            </>,
            <>
              <strong>API usage logs:</strong> {apiUsageDays} days, then
              automatically deleted.
            </>,
            <>
              <strong>AI chat history:</strong> {aiChatDays} days, then
              automatically deleted. Deleting your account deletes it
              immediately rather than waiting for that window.
            </>,
            <>
              <strong>Expired sessions:</strong> removed by an automatic cleanup
              pass that runs every few minutes, and again on every server start;
              an expired session stops working immediately regardless of when
              the row is actually deleted.
            </>,
            <>
              <strong>Revoked API keys:</strong> {revokedKeyDays} days after
              revocation, then automatically deleted.
            </>,
            <>
              <strong>Data export requests:</strong> {dataRequestDays} days,
              then automatically deleted.
            </>,
            <>
              <strong>Billing and invoice history:</strong> kept for as long as
              your account exists and deleted when you delete your account.
            </>,
            <>
              <strong>Security alerts:</strong> {securityAlertDays} days, then
              automatically deleted; deleting your account deletes them
              immediately.
            </>,
            <>
              <strong>Finding feedback:</strong> if you mark a finding
              confirmed, false positive, or not applicable, that verdict and any
              notes you add are kept for {feedbackDays} days, then automatically
              deleted. Deleting your account deletes the entry immediately
              rather than waiting for that window, because it carries the URL
              you scanned and whatever you typed into the notes field.
            </>,
            <>
              <strong>In-app notifications:</strong> the notification-bell feed
              (e.g. &quot;your scheduled scan finished&quot;) is kept for{" "}
              {notificationDays} days, then automatically deleted; deleting your
              account deletes them immediately.
            </>,
            <>
              <strong>Email delivery logs:</strong> a record that an email was
              attempted (recipient address, subject line, delivery status, and a
              redacted preview of the content, with links, codes, and tokens
              stripped out) is kept for {emailLogDays} days for deliverability
              troubleshooting, then automatically deleted. This table has no
              account column and is keyed only by the recipient address, so
              deleting your account purges it by that address instead, and the
              rows go at the same time as everything else.
            </>,
            <>
              <strong>Admin notes:</strong> {adminNoteDays} days, then
              automatically deleted.
            </>,
            <>
              <strong>Admin audit log:</strong> entries move from the active
              table to a permanent, indefinite compliance archive after{" "}
              {auditLogDays} days, rather than being deleted, so the platform
              keeps a lasting record of what administrative action was taken and
              by whom. If you delete your account, any entries still in the
              active table that reference you as the target of an admin action
              are de-identified (the link to your account is removed, the record
              of what happened is kept). Entries already moved to the archive
              before you delete your account keep their original data, since the
              archive exists specifically as an immutable historical record.
            </>,
            <>
              <strong>System error logs:</strong> when a server-side error
              occurs, the diagnostic message is captured for troubleshooting
              with secrets and email addresses automatically redacted before
              storage. These logs are visible only to administrators and are
              kept for {errorLogDays} days, then automatically deleted.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="your-rights" title="7. Your Rights">
        <p>You have the right to:</p>
        <LegalList
          items={[
            <>
              <strong>Access your data</strong>: Request a full export from your
              profile page.
            </>,
            <>
              <strong>Correct your data</strong>: Update your name, email, or
              password from your profile page.
            </>,
            <>
              <strong>Delete your data</strong>: Permanently delete your account
              from your profile page.
            </>,
            <>
              <strong>Export your data</strong>: Download a JSON file via the
              data export feature.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="cookies" title="8. Cookies">
        <p>
          Every cookie we set is strictly functional: none are used for
          advertising, tracking, or third-party analytics, so none of them
          require your consent.
        </p>
        <p className="font-medium text-foreground mt-4">
          HTTP-only (not readable by page scripts)
        </p>
        <LegalList
          items={[
            <>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                vulnradar_session
              </code>
              : maintains your login state.
            </>,
            <>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                vulnradar_2fa_pending
              </code>
              : short-lived, set only mid-login while a two-factor code is being
              verified.
            </>,
            <>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                vulnradar_device_trusted
              </code>
              : remembers a device you marked as trusted so you are not asked
              for a two-factor code on it again.
            </>,
            <>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                vr_oauth_nonce
              </code>
              : short-lived, set while an OAuth sign-in (Google, GitHub, or
              Discord) is in progress to protect the flow against CSRF.
            </>,
            <>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                oauth_pending_login
              </code>{" "}
              /{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                discord_pending_login
              </code>
              : short-lived (5 minutes), set only mid-login if you sign in with
              an OAuth provider and two-factor authentication is required to
              finish.
            </>,
            <>
              Staff-only, when applicable:{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                staff_oidc_nonce
              </code>{" "}
              (staff single sign-on) and{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                imp_return_session
              </code>{" "}
              (lets an administrator return to their own session after a logged,
              time-limited impersonation).
            </>,
          ]}
        />
        <p className="font-medium text-foreground mt-4">
          Preference cookies (not HTTP-only, no personal data)
        </p>
        <LegalList
          items={[
            <>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                vulnradar_last_seen_version
              </code>
              : remembers the last app version you saw so the &quot;what&apos;s
              new&quot; notification does not reappear.
            </>,
            "A per-notification dismissal cookie so a banner or announcement you closed does not reappear.",
          ]}
        />
      </LegalSection>

      <LegalSection id="gdpr" title="9. Your Rights Under GDPR (EEA Residents)">
        <p>
          If you are in the European Economic Area, you have these rights under
          GDPR:
        </p>
        <LegalList
          items={[
            <>
              <strong>Right of Access (Article 15)</strong> - Request a copy of
              your personal data.
            </>,
            <>
              <strong>Right to Rectification (Article 16)</strong> - Request
              correction of inaccurate data.
            </>,
            <>
              <strong>Right to Erasure (Article 17)</strong> - Request deletion
              of your data.
            </>,
            <>
              <strong>Right to Restriction (Article 18)</strong> - Request we
              restrict processing.
            </>,
            <>
              <strong>Right to Data Portability (Article 20)</strong> - Request
              data in machine-readable format.
            </>,
            <>
              <strong>Right to Object (Article 21)</strong> - Object to
              processing of your data.
            </>,
          ]}
        />
        <p className="mt-3">
          <strong className="text-foreground">
            How to exercise your rights:
          </strong>{" "}
          Use your{" "}
          <a
            href="/profile?tab=privacy"
            className="text-primary hover:underline"
          >
            Profile settings
          </a>{" "}
          or email us at{" "}
          <a
            href={`mailto:${legalEmail}`}
            className="text-primary hover:underline"
          >
            {legalEmail}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection
        id="ccpa"
        title="10. Your Rights Under CCPA/CPRA (California Residents)"
      >
        <p>California residents have these rights:</p>
        <LegalList
          items={[
            <>
              <strong>Right to Know</strong> - Request information about data we
              collect.
            </>,
            <>
              <strong>Right to Delete</strong> - Request deletion of your
              personal information.
            </>,
            <>
              <strong>Right to Correct</strong> - Request correction of
              inaccurate data.
            </>,
            <>
              <strong>Right to Opt-Out</strong> - We do not sell or share your
              personal information.
            </>,
            <>
              <strong>Right to Non-Discrimination</strong> - We will not
              discriminate for exercising rights.
            </>,
          ]}
        />
        <p className="mt-3">
          <strong className="text-foreground">
            Do Not Sell My Personal Information:
          </strong>{" "}
          We do not sell your personal information or share it for cross-context
          behavioral advertising.
        </p>
      </LegalSection>

      <LegalSection id="childrens-privacy" title="11. Children's Privacy">
        <p>
          The Service is intended for users 13 years of age and older. We do not
          knowingly collect personal information from children under 13. If we
          learn we have collected such information, we will delete it as quickly
          as possible.
        </p>
      </LegalSection>

      <LegalSection id="changes-to-policy" title="12. Changes to This Policy">
        <p>
          We may update this Privacy Policy at any time. When we make material
          changes, we will notify you by displaying a prominent notice within
          the Service or by sending you an email.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact">
        <p>
          For questions about this Privacy Policy, please contact us at{" "}
          <a
            href={`mailto:${legalEmail}`}
            className="text-primary hover:underline"
          >
            {legalEmail}
          </a>
          .
        </p>
      </LegalSection>
    </article>
  );
}
