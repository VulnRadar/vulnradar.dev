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
  const { LEGAL_EMAIL: legalEmail, TERMS_UPDATED_AT: termsUpdatedAt } =
    await getSettings(["LEGAL_EMAIL", "TERMS_UPDATED_AT"] as const);
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
              TOTP secret and encrypted backup recovery codes.
            </>,
          ]}
        />

        <p className="font-medium text-foreground mt-4">Usage Data</p>
        <LegalList
          items={[
            <>
              <strong>Scan history</strong>: URLs you scan, scan results, and
              timestamps.
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
              necessary for the scan report, with one exception: the optional
              live browser viewer and browser-based authenticated login (see
              Section 3) route that one scan through a third-party
              remote-browser provider, which may briefly record the session.
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
              <strong>Discord OAuth (Optional)</strong>: If you sign in with
              Discord, we receive basic account information.
            </>,
            <>
              <strong>Cloudflare Turnstile (CAPTCHA)</strong>: Cloudflare may
              collect limited device data to prevent abuse.
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
              : If enabled, messages you send to the AI assistant and scan
              findings submitted for AI verification are forwarded to a
              configured AI provider (for example OpenAI, Anthropic, or a
              self-hosted model, depending on how the operator has configured
              it) to generate a response. You can also connect your own AI
              provider account from Profile &gt; AI settings, in which case
              those requests go directly to the provider you choose using your
              own API key instead.
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
          Session tokens and API keys are cryptographically generated and hashed
          before storage.
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
              <strong>Scan history:</strong> depends on your plan. Free plan: 30
              days. Core Supporter: 90 days. Pro and Elite Supporter: kept for
              as long as your account is active. In every case, deleting your
              account deletes your scan history immediately.
            </>,
            <>
              <strong>API usage logs:</strong> 90 days, then automatically
              deleted.
            </>,
            <>
              <strong>AI chat history:</strong> 90 days, then automatically
              deleted.
            </>,
            <>
              <strong>Expired sessions:</strong> removed by an automatic cleanup
              pass that runs every few minutes, and again on every server start;
              an expired session stops working immediately regardless of when
              the row is actually deleted.
            </>,
            <>
              <strong>Revoked API keys:</strong> 30 days after revocation, then
              automatically deleted.
            </>,
            <>
              <strong>Data export requests:</strong> 60 days, then automatically
              deleted.
            </>,
            <>
              <strong>Billing and invoice history:</strong> kept for as long as
              your account exists and deleted when you delete your account.
            </>,
            <>
              <strong>Security alerts:</strong> 180 days, then automatically
              deleted.
            </>,
            <>
              <strong>Admin audit log and notes:</strong> 365 days, then
              automatically deleted. If you delete your account, entries
              referencing you as the target of an admin action are de-identified
              rather than deleted, so administrators keep an accountability
              record of what action was taken and why, without it being tied to
              your identity.
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
                discord_pending_login
              </code>
              : short-lived (5 minutes), set only mid-login if you sign in with
              Discord and two-factor authentication is required to finish.
            </>,
          ]}
        />
        <p className="font-medium text-foreground mt-4">
          Preference cookies (not HTTP-only, no personal data)
        </p>
        <LegalList
          items={[
            "A sidebar cookie that remembers whether the dashboard sidebar is expanded or collapsed.",
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
          <a href="/profile#privacy" className="text-primary hover:underline">
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
