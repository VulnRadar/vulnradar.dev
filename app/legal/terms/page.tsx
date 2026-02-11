export default function TermsPage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold text-foreground">Terms of Service</h1>
      <p className="text-sm text-muted-foreground">Last updated: February 8, 2026</p>

      <p className="leading-relaxed text-foreground/90">
        Welcome to VulnRadar (&quot;the Service&quot;), operated at vulnradar.dev. By creating an
        account or using our Service, you agree to be bound by these Terms of Service
        (&quot;Terms&quot;). If you do not agree, do not use VulnRadar.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">1. Description of Service</h2>
      <p className="leading-relaxed text-foreground/90">
        VulnRadar is a web-based vulnerability scanning tool that analyzes publicly accessible
        websites for common security misconfigurations, missing security headers, and other
        potential vulnerabilities. The Service provides automated security assessments, detailed
        findings with severity ratings, and remediation guidance.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">2. Eligibility</h2>
      <p className="leading-relaxed text-foreground/90">
        You must be at least 18 years of age to use this Service. By registering, you represent
        and warrant that you are at least 18 years old and have the legal capacity to enter into
        these Terms.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">3. Account Responsibilities</h2>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>You are responsible for maintaining the confidentiality of your account credentials, API keys, and 2FA backup recovery codes.</li>
        <li>You are responsible for all activity that occurs under your account, including activity authenticated via backup codes.</li>
        <li>You agree to notify us immediately of any unauthorized use of your account.</li>
        <li>You are responsible for securing your two-factor authentication setup and storing backup codes in a safe location.</li>
        <li>We reserve the right to suspend or terminate accounts that violate these Terms.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">4. Authorized Use Only</h2>
      <p className="leading-relaxed text-foreground/90">
        <strong>You may only scan websites that you own or have explicit written authorization to test.</strong>{" "}
        Unauthorized scanning of third-party websites may violate laws including but not limited to
        the Computer Fraud and Abuse Act (CFAA), the Computer Misuse Act 1990, and equivalent
        laws in other jurisdictions.
      </p>
      <p className="leading-relaxed text-foreground/90">
        By using VulnRadar, you represent and warrant that:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>You have proper authorization from the website owner to perform security scans.</li>
        <li>You are using the Service for legitimate security research, testing, or educational purposes only.</li>
        <li>You will not use the Service to discover vulnerabilities for the purpose of exploitation, unauthorized access, or malicious activity.</li>
        <li>You will comply with all applicable local, state, national, and international laws and regulations.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">5. Prohibited Activities</h2>
      <p className="leading-relaxed text-foreground/90">You agree NOT to:</p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Scan any website without authorization from its owner.</li>
        <li>Use the Service to perform denial-of-service attacks or any form of disruption.</li>
        <li>Attempt to bypass rate limits, authentication, or any security measures of the Service.</li>
        <li>Use the Service for any unlawful, harmful, or malicious purposes.</li>
        <li>Redistribute, resell, or sublicense access to VulnRadar or its API.</li>
        <li>Reverse-engineer, decompile, or disassemble any part of the Service.</li>
        <li>Use automated tools to scrape, harvest, or extract data from the Service beyond the documented API.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">6. API Usage</h2>
      <p className="leading-relaxed text-foreground/90">
        Access to the VulnRadar API is subject to rate limits (50 requests per API key per day,
        maximum 3 keys per account). We reserve the right to modify rate limits at any time.
        Abuse of the API may result in immediate suspension of your account and API access.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">7. Data Retention</h2>
      <p className="leading-relaxed text-foreground/90">
        Scan history is retained for 90 days. API usage logs are retained for 90 days. Data export
        requests are retained for 60 days. You may delete your account and all associated data
        at any time from your profile page.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">8. Limitation of Liability</h2>
      <p className="leading-relaxed text-foreground/90">
        <strong>THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
        EITHER EXPRESS OR IMPLIED.</strong> VulnRadar, its operators, contributors, and affiliates
        shall not be liable for any direct, indirect, incidental, special, consequential, or exemplary
        damages resulting from your use of the Service, including but not limited to:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Damages resulting from unauthorized scanning of third-party websites.</li>
        <li>Legal consequences arising from your misuse of the Service.</li>
        <li>False positives or false negatives in scan results.</li>
        <li>Loss of data, revenue, or business opportunities.</li>
        <li>Any actions taken based on scan results or remediation guidance.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">9. Indemnification</h2>
      <p className="leading-relaxed text-foreground/90">
        You agree to indemnify, defend, and hold harmless VulnRadar and its operators from and
        against any claims, damages, obligations, losses, liabilities, costs, or expenses arising
        from your use of the Service or violation of these Terms.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">10. Termination</h2>
      <p className="leading-relaxed text-foreground/90">
        We reserve the right to suspend or terminate your access to the Service at any time, with
        or without cause, with or without notice. Upon termination, your right to use the Service
        ceases immediately. You may delete your account at any time.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">11. Changes to Terms</h2>
      <p className="leading-relaxed text-foreground/90">
        We may update these Terms at any time. Continued use of the Service after changes
        constitutes acceptance of the revised Terms. Material changes will be communicated
        where reasonably possible.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">12. Contact</h2>
      <p className="leading-relaxed text-foreground/90">
        For questions about these Terms, please contact us at{" "}
        <a href="mailto:legal@vulnradar.dev" className="text-primary hover:underline">
          legal@vulnradar.dev
        </a>.
      </p>
    </article>
  )
}
