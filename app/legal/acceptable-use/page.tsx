export default function AcceptableUsePage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold text-foreground">Acceptable Use Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: February 8, 2026</p>

      <p className="leading-relaxed text-foreground/90">
        This Acceptable Use Policy (&quot;AUP&quot;) outlines the rules and guidelines for using VulnRadar.
        By using the Service, you agree to comply with this policy.
      </p>

      <div className="rounded-xl border-2 border-[hsl(var(--severity-medium))]/30 bg-[hsl(var(--severity-medium))]/5 p-6 my-6">
        <h2 className="text-lg font-bold text-[hsl(var(--severity-medium))] mt-0">Authorization Requirement</h2>
        <p className="leading-relaxed text-foreground/90 mb-0">
          You <strong>MUST</strong> have explicit written authorization from the website owner
          before scanning any target. Scanning websites without authorization is strictly
          prohibited and may constitute a criminal offense in your jurisdiction.
        </p>
      </div>

      <h2 className="text-lg font-semibold text-foreground mt-8">1. Permitted Uses</h2>
      <p className="leading-relaxed text-foreground/90">You may use VulnRadar to:</p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Scan websites that you own and operate.</li>
        <li>Scan websites for which you have explicit, documented written permission from the owner.</li>
        <li>Perform security assessments as part of an authorized bug bounty program where the program scope explicitly allows automated scanning.</li>
        <li>Conduct security research on your own infrastructure or test environments.</li>
        <li>Educate yourself about web security best practices using your own test sites.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">2. Prohibited Uses</h2>
      <p className="leading-relaxed text-foreground/90">You may <strong>NOT</strong> use VulnRadar to:</p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Scan any website without authorization from its owner.</li>
        <li>Discover vulnerabilities for the purpose of exploitation, unauthorized access, data theft, or extortion.</li>
        <li>Perform reconnaissance for malicious purposes.</li>
        <li>Conduct denial-of-service attacks or attempt to disrupt any service.</li>
        <li>Bypass rate limits or abuse the API in any way.</li>
        <li>Scan government, military, financial, healthcare, or critical infrastructure systems without explicit authorization.</li>
        <li>Share scan results publicly in a way that could enable exploitation of discovered vulnerabilities before the owner has had reasonable time to remediate.</li>
        <li>Use scan results to blackmail, extort, or otherwise coerce website owners.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">3. Responsible Disclosure</h2>
      <p className="leading-relaxed text-foreground/90">
        If you discover vulnerabilities while performing authorized security testing, we
        strongly encourage responsible disclosure:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Report findings privately to the website owner before any public disclosure.</li>
        <li>Allow reasonable time (typically 90 days) for the owner to remediate before disclosure.</li>
        <li>Do not exploit discovered vulnerabilities beyond what is necessary to demonstrate the issue.</li>
        <li>Follow the target&apos;s vulnerability disclosure policy if one exists.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">4. Rate Limits and Fair Use</h2>
      <p className="leading-relaxed text-foreground/90">
        Each API key is limited to 50 requests per day, with a maximum of 3 API keys per
        account. These limits are in place to prevent abuse and ensure fair access for all
        users. Attempting to circumvent rate limits may result in immediate account suspension.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">5. Enforcement</h2>
      <p className="leading-relaxed text-foreground/90">
        Violations of this Acceptable Use Policy may result in:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Temporary or permanent suspension of your account.</li>
        <li>Revocation of all API keys.</li>
        <li>Reporting to appropriate law enforcement authorities if illegal activity is suspected.</li>
        <li>Legal action to recover damages.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">6. Reporting Abuse</h2>
      <p className="leading-relaxed text-foreground/90">
        If you believe VulnRadar is being used in violation of this policy, please report it to{" "}
        <a href="mailto:security@vulnradar.dev" className="text-primary hover:underline">
          security@vulnradar.dev
        </a>.
      </p>
    </article>
  )
}
