import { LEGAL_EMAIL, APP_NAME, APP_URL } from "@/lib/config/constants"
import { LegalPageHeader, LegalSection, LegalList } from "@/components/legal"

export default function PrivacyPage() {
  return (
    <article className="space-y-8">
      <LegalPageHeader title="Privacy Policy" lastUpdated="March 16, 2026" type="privacy" />
      
      <p className="text-sm text-muted-foreground leading-relaxed">
        This Privacy Policy describes how {APP_NAME} (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) collects, uses,
        and protects your personal information when you use our Service at {APP_URL}. {APP_NAME} is 
        operated by an independent developer based in Missouri, United States.
      </p>

      <LegalSection title="1. Information We Collect">
        <p className="font-medium text-foreground">Account Information</p>
        <LegalList items={[
          <><strong>Name</strong>: provided at registration.</>,
          <><strong>Email address</strong>: used for account identification and login.</>,
          <><strong>Password</strong>: stored as a salted, cryptographically hashed value using scrypt.</>,
          <><strong>Two-factor authentication data</strong>: if enabled, your TOTP secret and encrypted backup recovery codes.</>,
        ]} />
        
        <p className="font-medium text-foreground mt-4">Usage Data</p>
        <LegalList items={[
          <><strong>Scan history</strong>: URLs you scan, scan results, and timestamps.</>,
          <><strong>API usage</strong>: timestamps of API requests made with your API keys.</>,
          <><strong>Session data</strong>: session tokens stored as HTTP-only cookies.</>,
        ]} />
        
        <p className="font-medium text-foreground mt-4">Data We Do NOT Collect</p>
        <LegalList items={[
          "We do not use analytics, tracking pixels, or third-party advertising cookies.",
          "We do not sell, rent, or share your personal information for marketing purposes.",
          "We do not collect data about websites you scan beyond what is necessary for the scan report.",
        ]} />
      </LegalSection>

      <LegalSection title="2. How We Use Your Information">
        <LegalList items={[
          "To provide, maintain, and improve the Service.",
          "To authenticate your identity and manage your sessions.",
          "To enforce our Terms of Service and prevent abuse.",
          "To respond to data export requests when you initiate them.",
          "To send transactional emails (password resets, account notifications, team invitations).",
        ]} />
      </LegalSection>

      <LegalSection title="3. Third-Party Service Providers">
        <p>
          We may share your information with service providers who help us operate the Service. 
          These providers only have access to your data as necessary to perform their functions:
        </p>
        <LegalList items={[
          <><strong>Payment Processing (Stripe)</strong>: If you subscribe to a paid plan, Stripe processes your payment. We do not store credit card numbers.</>,
          <><strong>Email Service (SMTP Provider)</strong>: We use an email service for transactional emails. Only your email and name are shared.</>,
          <><strong>Discord OAuth (Optional)</strong>: If you sign in with Discord, we receive basic account information.</>,
          <><strong>Cloudflare Turnstile (CAPTCHA)</strong>: Cloudflare may collect limited device data to prevent abuse.</>,
        ]} />
        <p className="mt-3">
          <strong className="text-foreground">Self-Hosted Database</strong>: Our database is self-hosted and managed directly by us.
        </p>
      </LegalSection>

      <LegalSection title="4. Data Storage and Security">
        <p>
          Your data is stored in a PostgreSQL database hosted on our own infrastructure. Passwords are 
          hashed using scrypt with random salts. Session tokens and API keys are cryptographically generated 
          and hashed before storage.
        </p>
        <p className="mt-2">
          <strong className="text-foreground">Security Disclaimer:</strong> While we implement industry-standard security measures, 
          no method of transmission over the Internet is completely secure.
        </p>
      </LegalSection>

      <LegalSection title="5. Data Retention">
        <LegalList items={[
          <><strong>Scan history:</strong> 90 days, then automatically deleted.</>,
          <><strong>API usage logs:</strong> 90 days, then automatically deleted.</>,
          <><strong>Expired sessions:</strong> Deleted on every server restart.</>,
          <><strong>Revoked API keys:</strong> 30 days after revocation, then automatically deleted.</>,
          <><strong>Data export requests:</strong> 60 days, then automatically deleted.</>,
        ]} />
      </LegalSection>

      <LegalSection title="6. Your Rights">
        <p>You have the right to:</p>
        <LegalList items={[
          <><strong>Access your data</strong>: Request a full export from your profile page.</>,
          <><strong>Correct your data</strong>: Update your name, email, or password from your profile page.</>,
          <><strong>Delete your data</strong>: Permanently delete your account from your profile page.</>,
          <><strong>Export your data</strong>: Download a JSON file via the data export feature.</>,
        ]} />
      </LegalSection>

      <LegalSection title="7. Cookies">
        <p>
          We use a single HTTP-only session cookie (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">vulnradar_session</code>) to maintain
          your login state. We do not use advertising cookies, tracking cookies, or third-party analytics cookies.
        </p>
      </LegalSection>

      <LegalSection id="gdpr" title="8. Your Rights Under GDPR (EEA Residents)">
        <p>If you are in the European Economic Area, you have these rights under GDPR:</p>
        <LegalList items={[
          <><strong>Right of Access (Article 15)</strong> - Request a copy of your personal data.</>,
          <><strong>Right to Rectification (Article 16)</strong> - Request correction of inaccurate data.</>,
          <><strong>Right to Erasure (Article 17)</strong> - Request deletion of your data.</>,
          <><strong>Right to Restriction (Article 18)</strong> - Request we restrict processing.</>,
          <><strong>Right to Data Portability (Article 20)</strong> - Request data in machine-readable format.</>,
          <><strong>Right to Object (Article 21)</strong> - Object to processing of your data.</>,
        ]} />
        <p className="mt-3">
          <strong className="text-foreground">How to exercise your rights:</strong> Use your{" "}
          <a href="/profile#privacy" className="text-primary hover:underline">Profile settings</a> or 
          email us at <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection id="ccpa" title="9. Your Rights Under CCPA/CPRA (California Residents)">
        <p>California residents have these rights:</p>
        <LegalList items={[
          <><strong>Right to Know</strong> - Request information about data we collect.</>,
          <><strong>Right to Delete</strong> - Request deletion of your personal information.</>,
          <><strong>Right to Correct</strong> - Request correction of inaccurate data.</>,
          <><strong>Right to Opt-Out</strong> - We do not sell or share your personal information.</>,
          <><strong>Right to Non-Discrimination</strong> - We will not discriminate for exercising rights.</>,
        ]} />
        <p className="mt-3">
          <strong className="text-foreground">Do Not Sell My Personal Information:</strong> We do not sell your 
          personal information or share it for cross-context behavioral advertising.
        </p>
      </LegalSection>

      <LegalSection title="10. Children&apos;s Privacy">
        <p>
          The Service is intended for users 13 years of age and older. We do not knowingly collect 
          personal information from children under 13. If we learn we have collected such information, 
          we will delete it as quickly as possible.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes to This Policy">
        <p>
          We may update this Privacy Policy at any time. When we make material changes, we will notify 
          you by displaying a prominent notice within the Service or by sending you an email.
        </p>
      </LegalSection>

      <LegalSection title="12. Contact">
        <p>
          For questions about this Privacy Policy, please contact us at{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a>.
        </p>
      </LegalSection>
    </article>
  )
}
