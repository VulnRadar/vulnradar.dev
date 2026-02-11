export default function PrivacyPage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: February 8, 2026</p>

      <p className="leading-relaxed text-foreground/90">
        This Privacy Policy describes how VulnRadar (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) collects, uses,
        and protects your personal information when you use our Service at vulnradar.dev.
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
        <li>We do not sell, rent, or share your personal information with any third party.</li>
        <li>We do not collect data about the websites you scan beyond what is necessary to produce the scan report.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">2. How We Use Your Information</h2>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>To provide, maintain, and improve the Service.</li>
        <li>To authenticate your identity and manage your sessions.</li>
        <li>To enforce our Terms of Service and prevent abuse.</li>
        <li>To respond to data export requests when you initiate them.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">3. Data Storage and Security</h2>
      <p className="leading-relaxed text-foreground/90">
        Your data is stored in a PostgreSQL database. Passwords are hashed using scrypt with
        random salts. Session tokens are cryptographically generated random values. API keys
        are hashed before storage: we never store plaintext API keys after initial generation.
        Two-factor authentication secrets are stored server-side and backup codes are
        cryptographically generated. Backup codes are consumed on use and cannot be reused.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">4. Data Retention</h2>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li><strong>Scan history:</strong> 90 days, then automatically deleted.</li>
        <li><strong>API usage logs:</strong> 90 days, then automatically deleted.</li>
        <li><strong>Expired sessions:</strong> Deleted on every server restart.</li>
        <li><strong>Revoked API keys:</strong> 30 days after revocation, then automatically deleted.</li>
        <li><strong>Data export requests:</strong> 60 days, then automatically deleted.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">5. Your Rights</h2>
      <p className="leading-relaxed text-foreground/90">You have the right to:</p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li><strong>Access your data</strong>: Request a full export of all data associated with your account from your profile page.</li>
        <li><strong>Correct your data</strong>: Update your name, email, or password from your profile page.</li>
        <li><strong>Delete your data</strong>: Permanently delete your account and all associated data from your profile page. This action is irreversible and cascades to all sessions, API keys, scan history, and data requests.</li>
        <li><strong>Export your data</strong>: Download a JSON file containing all your data via the data export feature.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">6. Cookies</h2>
      <p className="leading-relaxed text-foreground/90">
        We use a single HTTP-only session cookie (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">vulnradar_session</code>) to maintain
        your login state. This cookie is essential for the Service to function and cannot be
        opted out of while using the Service. We also store a theme preference via{" "}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">next-themes</code> in localStorage.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">7. Children&apos;s Privacy</h2>
      <p className="leading-relaxed text-foreground/90">
        The Service is not intended for use by anyone under the age of 18. We do not knowingly
        collect personal information from minors.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">8. Changes to This Policy</h2>
      <p className="leading-relaxed text-foreground/90">
        We may update this Privacy Policy at any time. Continued use of the Service after changes
        constitutes acceptance of the revised policy.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">9. Contact</h2>
      <p className="leading-relaxed text-foreground/90">
        For privacy-related inquiries, please contact us at{" "}
        <a href="mailto:legal@vulnradar.dev" className="text-primary hover:underline">
          legal@vulnradar.dev
        </a>.
      </p>
    </article>
  )
}
