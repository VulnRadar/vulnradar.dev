import { LEGAL_EMAIL, APP_NAME, APP_URL } from "@/lib/constants"

export default function PrivacyPage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: March 16, 2026</p>

      <p className="leading-relaxed text-foreground/90">
        This Privacy Policy describes how {APP_NAME} (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) collects, uses,
        and protects your personal information when you use our Service at {APP_URL}. {APP_NAME} 
        is operated from Missouri, United States.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">1. Information We Collect</h2>
      <h3 className="text-base font-medium text-foreground mt-4">Account Information</h3>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li><strong>Name</strong>: provided at registration.</li>
        <li><strong>Email address</strong>: used for account identification and login.</li>
        <li><strong>Password</strong>: stored as a salted, cryptographically hashed value using scrypt. We never store or have access to your plaintext password.</li>
        <li><strong>Two-factor authentication data</strong>: if enabled, your TOTP secret and encrypted backup recovery codes. Backup codes are single-use and removed after consumption.</li>
      </ul>

      <h3 className="text-base font-medium text-foreground mt-4">Usage Data</h3>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li><strong>Scan history</strong>: URLs you scan, scan results (findings, severity summaries), and timestamps.</li>
        <li><strong>API usage</strong>: timestamps of API requests made with your API keys.</li>
        <li><strong>Session data</strong>: session tokens stored as HTTP-only cookies to maintain your login state.</li>
      </ul>

      <h3 className="text-base font-medium text-foreground mt-4">Data We Do NOT Collect</h3>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>We do not use analytics, tracking pixels, or third-party advertising cookies.</li>
        <li>We do not sell, rent, or share your personal information with any third party for marketing purposes.</li>
        <li>We do not collect data about the websites you scan beyond what is necessary to produce the scan report.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">2. How We Use Your Information</h2>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>To provide, maintain, and improve the Service.</li>
        <li>To authenticate your identity and manage your sessions.</li>
        <li>To enforce our Terms of Service and prevent abuse.</li>
        <li>To respond to data export requests when you initiate them.</li>
        <li>To send transactional emails (password resets, account notifications, team invitations).</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">3. Third-Party Service Providers</h2>
      <p className="leading-relaxed text-foreground/90">
        We may share your information with the following categories of service providers who help us 
        operate the Service. These providers only have access to your data as necessary to perform 
        their functions and are contractually obligated to protect your information:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90 mt-3">
        <li><strong>Payment Processing (Stripe)</strong>: If you subscribe to a paid plan, your payment 
        information is processed by Stripe. We do not store your credit card numbers. Stripe&apos;s privacy 
        policy is available at <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">stripe.com/privacy</a>.</li>
        <li><strong>Email Service (SMTP Provider)</strong>: We use an email service to send transactional 
        emails such as password resets and notifications. Only your email address and name are shared 
        with this provider.</li>
        <li><strong>Discord OAuth (Optional)</strong>: If you choose to sign in with Discord, Discord 
        provides us with your Discord user ID, username, and email. Discord&apos;s privacy policy is available 
        at <a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">discord.com/privacy</a>.</li>
        <li><strong>Cloudflare Turnstile (CAPTCHA)</strong>: We use Cloudflare Turnstile to prevent abuse 
        and bot activity. Cloudflare may collect device and browser information. Cloudflare&apos;s privacy 
        policy is available at <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">cloudflare.com/privacypolicy</a>.</li>
      </ul>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong>Self-Hosted Database</strong>: Our database is self-hosted and managed directly by us. 
        Your data is not shared with any third-party database provider.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">4. Data Storage and Security</h2>
      <p className="leading-relaxed text-foreground/90">
        Your data is stored in a PostgreSQL database hosted on our own infrastructure. Passwords are 
        hashed using scrypt with random salts. Session tokens are cryptographically generated random 
        values. API keys are hashed before storage: we never store plaintext API keys after initial 
        generation. Two-factor authentication secrets are stored server-side and backup codes are
        cryptographically generated. Backup codes are consumed on use and cannot be reused.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">5. Data Retention</h2>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li><strong>Scan history:</strong> 90 days, then automatically deleted.</li>
        <li><strong>API usage logs:</strong> 90 days, then automatically deleted.</li>
        <li><strong>Expired sessions:</strong> Deleted on every server restart.</li>
        <li><strong>Revoked API keys:</strong> 30 days after revocation, then automatically deleted.</li>
        <li><strong>Data export requests:</strong> 60 days, then automatically deleted.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">6. Your Rights</h2>
      <p className="leading-relaxed text-foreground/90">You have the right to:</p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li><strong>Access your data</strong>: Request a full export of all data associated with your account from your profile page.</li>
        <li><strong>Correct your data</strong>: Update your name, email, or password from your profile page.</li>
        <li><strong>Delete your data</strong>: Permanently delete your account and all associated data from your profile page. This action is irreversible and cascades to all sessions, API keys, scan history, and data requests.</li>
        <li><strong>Export your data</strong>: Download a JSON file containing all your data via the data export feature.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">7. Cookies</h2>
      <p className="leading-relaxed text-foreground/90">
        We use a single HTTP-only session cookie (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">vulnradar_session</code>) to maintain
        your login state. This cookie is essential for the Service to function and cannot be
        opted out of while using the Service. We also store a theme preference via{" "}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">next-themes</code> in localStorage.
        We do not use advertising cookies, tracking cookies, or third-party analytics cookies.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">8. Children&apos;s Privacy</h2>
      <p className="leading-relaxed text-foreground/90">
        The Service is not intended for use by anyone under the age of 18. We do not knowingly
        collect personal information from minors. If we learn that we have collected personal 
        information from a child under 18, we will delete that information as quickly as possible.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">9. Data Breach Notification</h2>
      <p className="leading-relaxed text-foreground/90">
        In the event of a data breach that compromises your personal information, we will:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90 mt-3">
        <li>Notify affected users via email within 72 hours of discovering the breach.</li>
        <li>Provide information about the nature of the breach and what data was affected.</li>
        <li>Describe the steps we are taking to address the breach and prevent future occurrences.</li>
        <li>Provide guidance on steps you can take to protect yourself.</li>
        <li>Notify relevant regulatory authorities as required by applicable law, including the Missouri Attorney General&apos;s office as required by Missouri law (Mo. Rev. Stat. § 407.1500).</li>
      </ul>

      <h2 id="gdpr" className="text-lg font-semibold text-foreground mt-8">10. Your Rights Under GDPR (EEA Residents)</h2>
      <p className="leading-relaxed text-foreground/90">
        If you are located in the European Economic Area (EEA), you have certain data protection rights
        under the General Data Protection Regulation (GDPR). We are committed to helping you exercise these rights:
      </p>
      <ul className="list-disc pl-6 space-y-2 text-foreground/90 mt-3">
        <li><strong className="text-foreground">Right of Access (Article 15)</strong> - You can request a copy of all personal data we hold about you.</li>
        <li><strong className="text-foreground">Right to Rectification (Article 16)</strong> - You can request that we correct any inaccurate personal data.</li>
        <li><strong className="text-foreground">Right to Erasure (Article 17)</strong> - You can request that we delete your personal data (&quot;right to be forgotten&quot;).</li>
        <li><strong className="text-foreground">Right to Restriction of Processing (Article 18)</strong> - You can request that we restrict the processing of your data.</li>
        <li><strong className="text-foreground">Right to Data Portability (Article 20)</strong> - You can request your data in a structured, machine-readable format.</li>
        <li><strong className="text-foreground">Right to Object (Article 21)</strong> - You can object to the processing of your personal data.</li>
      </ul>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong className="text-foreground">International Data Transfers:</strong> If you are located in the EEA, your data 
        may be transferred to and processed in the United States. We rely on Standard Contractual Clauses 
        approved by the European Commission to ensure adequate protection for your data when transferred 
        outside the EEA.
      </p>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong className="text-foreground">How to exercise your rights:</strong> If you have an account, you can export or delete your data directly from
        your <a href="/profile#privacy" className="text-primary hover:underline">Profile settings</a>. If you do not have an account or need further assistance,
        email us at{" "}
        <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a> with your request.
        We will respond within 30 days.
      </p>

      <h2 id="ccpa" className="text-lg font-semibold text-foreground mt-8">11. Your Rights Under CCPA/CPRA (California Residents)</h2>
      <p className="leading-relaxed text-foreground/90">
        If you are a California resident, you have specific rights under the California Consumer Privacy 
        Act (CCPA) and California Privacy Rights Act (CPRA):
      </p>
      <ul className="list-disc pl-6 space-y-2 text-foreground/90 mt-3">
        <li><strong className="text-foreground">Right to Know</strong> - You have the right to request information about the categories and specific 
        pieces of personal information we have collected about you, the sources of that information, 
        the business purposes for collecting it, and the categories of third parties with whom we share it.</li>
        <li><strong className="text-foreground">Right to Delete</strong> - You have the right to request deletion of your personal information, 
        subject to certain exceptions.</li>
        <li><strong className="text-foreground">Right to Correct</strong> - You have the right to request correction of inaccurate personal information.</li>
        <li><strong className="text-foreground">Right to Opt-Out of Sale/Sharing</strong> - You have the right to opt out of the &quot;sale&quot; or 
        &quot;sharing&quot; of your personal information. <strong>We do not sell or share your personal information 
        for cross-context behavioral advertising.</strong></li>
        <li><strong className="text-foreground">Right to Non-Discrimination</strong> - We will not discriminate against you for exercising your privacy rights.</li>
        <li><strong className="text-foreground">Right to Limit Use of Sensitive Personal Information</strong> - You have the right to limit our use 
        of sensitive personal information. We only use sensitive information as necessary to provide the Service.</li>
      </ul>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong className="text-foreground">Categories of Personal Information Collected:</strong> In the past 12 months, we have collected 
        the following categories of personal information: Identifiers (name, email), Internet activity 
        (scan history, API usage), and Account credentials (hashed passwords, 2FA data).
      </p>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong className="text-foreground">Do Not Sell My Personal Information:</strong> We do not sell your personal information. We do 
        not share your personal information for cross-context behavioral advertising purposes.
      </p>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong className="text-foreground">How to Exercise Your Rights:</strong> You may exercise your CCPA rights by emailing us at{" "}
        <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a> with 
        the subject line &quot;CCPA Request&quot; or by using the data export and account deletion features in 
        your <a href="/profile#privacy" className="text-primary hover:underline">Profile settings</a>. 
        We will verify your identity before processing your request.
      </p>

      <h2 id="state-laws" className="text-lg font-semibold text-foreground mt-8">12. Additional State Privacy Rights</h2>
      <p className="leading-relaxed text-foreground/90">
        Residents of Virginia (VCDPA), Colorado (CPA), Connecticut (CTDPA), and Utah (UCPA) have 
        similar privacy rights to those described above for California residents. You may:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90 mt-3">
        <li>Access and obtain a copy of your personal data</li>
        <li>Request deletion of your personal data</li>
        <li>Correct inaccuracies in your personal data</li>
        <li>Opt out of targeted advertising, sale of personal data, or profiling</li>
        <li>Appeal our decision regarding your privacy request</li>
      </ul>
      <p className="leading-relaxed text-foreground/90 mt-3">
        To exercise these rights, contact us at{" "}
        <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a>.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">13. Changes to This Policy</h2>
      <p className="leading-relaxed text-foreground/90">
        We may update this Privacy Policy at any time. When we make material changes, we will notify 
        you by displaying a prominent notice within the Service or by sending you an email. Continued 
        use of the Service after accepting changes constitutes acceptance of the revised policy.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">14. Contact</h2>
      <p className="leading-relaxed text-foreground/90">
        For privacy-related inquiries, please contact us at{" "}
        <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">
          {LEGAL_EMAIL}
        </a>.
      </p>
      <p className="leading-relaxed text-foreground/90 mt-3">
        {APP_NAME} is operated from Missouri, United States.
      </p>
    </article>
  )
}
