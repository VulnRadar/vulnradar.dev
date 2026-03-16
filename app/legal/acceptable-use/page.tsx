import { SECURITY_EMAIL, APP_NAME, LEGAL_EMAIL } from "@/lib/constants"

export default function AcceptableUsePage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold text-foreground">Acceptable Use Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: March 16, 2026</p>

      <p className="leading-relaxed text-foreground/90">
        This Acceptable Use Policy (&quot;AUP&quot;) outlines the rules and guidelines for using {APP_NAME}.
        By using the Service, you agree to comply with this policy.
      </p>

      <div className="rounded-xl border-2 border-[hsl(var(--severity-medium))]/30 bg-[hsl(var(--severity-medium))]/5 p-6 my-6">
        <h2 className="text-lg font-bold text-[hsl(var(--severity-medium))] mt-0">Authorization Requirement</h2>
        <p className="leading-relaxed text-foreground/90 mb-0">
          You <strong>MUST</strong> have explicit written authorization from the website owner
          before scanning any target. Scanning websites without authorization is strictly
          prohibited and may constitute a criminal offense in your jurisdiction under laws 
          including but not limited to the Computer Fraud and Abuse Act (CFAA) in the United States.
        </p>
      </div>

      <h2 className="text-lg font-semibold text-foreground mt-8">1. Permitted Uses</h2>
      <p className="leading-relaxed text-foreground/90">You may use {APP_NAME} to:</p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Scan websites that you own and operate.</li>
        <li>Scan websites for which you have explicit, documented written permission from the owner.</li>
        <li>Perform security assessments as part of an authorized bug bounty program where the program scope explicitly allows automated scanning.</li>
        <li>Conduct security research on your own infrastructure or test environments.</li>
        <li>Educate yourself about web security best practices using your own test sites.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">2. Prohibited Uses</h2>
      <p className="leading-relaxed text-foreground/90">You may <strong>NOT</strong> use {APP_NAME} to:</p>
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

      <h2 className="text-lg font-semibold text-foreground mt-8">3. Authorization Documentation</h2>
      <p className="leading-relaxed text-foreground/90">
        When scanning websites you do not own, you must maintain documentation of your authorization. 
        Acceptable forms of authorization include:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Written permission (email, letter, or contract) from the website owner or authorized representative.</li>
        <li>Active participation in a bug bounty program that explicitly permits automated scanning tools.</li>
        <li>A penetration testing agreement or security assessment contract.</li>
        <li>Employment or contractor relationship where security testing is part of your job duties.</li>
      </ul>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong>You are solely responsible</strong> for obtaining and maintaining proof of authorization. 
        {APP_NAME} may request proof of authorization at any time. Failure to provide adequate documentation 
        may result in account suspension.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">4. Bug Bounty Programs</h2>
      <p className="leading-relaxed text-foreground/90">
        If you use {APP_NAME} for bug bounty hunting:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Verify that the program&apos;s scope explicitly permits automated scanning tools.</li>
        <li>Comply with all program rules, including rate limiting and out-of-scope areas.</li>
        <li>Do not scan targets that are explicitly listed as out-of-scope.</li>
        <li>Report findings through the program&apos;s designated channels.</li>
        <li>Do not publicly disclose vulnerabilities without following the program&apos;s disclosure policy.</li>
      </ul>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong>Disclaimer:</strong> {APP_NAME} does not guarantee that any particular bug bounty program 
        permits the use of our service. You are responsible for verifying program rules before scanning.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">5. Security Research Safe Harbor</h2>
      <p className="leading-relaxed text-foreground/90">
        We support good-faith security research. If you are conducting legitimate security research 
        in compliance with this policy:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>You must have proper authorization as described above.</li>
        <li>You must not access, modify, or exfiltrate data beyond what is necessary to demonstrate a vulnerability.</li>
        <li>You must report findings responsibly and allow reasonable remediation time.</li>
        <li>You must not use the Service to conduct research on critical infrastructure, healthcare systems, 
        or systems where disruption could cause physical harm, without explicit written authorization from 
        the system owner.</li>
      </ul>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong>Important:</strong> This safe harbor applies only to your use of {APP_NAME}. We cannot 
        provide legal protection for your interactions with third-party targets. You are solely 
        responsible for ensuring your security research complies with all applicable laws and the 
        target&apos;s policies.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">6. Responsible Disclosure</h2>
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

      <h2 className="text-lg font-semibold text-foreground mt-8">7. Rate Limits and Fair Use</h2>
      <p className="leading-relaxed text-foreground/90">
        Each API key is limited to 50 requests per day, with a maximum of 3 API keys per
        account. These limits are in place to prevent abuse and ensure fair access for all
        users. Attempting to circumvent rate limits may result in immediate account suspension.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">8. Enforcement</h2>
      <p className="leading-relaxed text-foreground/90">
        Violations of this Acceptable Use Policy may result in:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Temporary or permanent suspension of your account.</li>
        <li>Revocation of all API keys.</li>
        <li>Reporting to appropriate law enforcement authorities if illegal activity is suspected.</li>
        <li>Legal action to recover damages.</li>
        <li>Cooperation with law enforcement investigations.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">9. Your Liability</h2>
      <p className="leading-relaxed text-foreground/90">
        You are solely responsible for your use of {APP_NAME}. You agree to indemnify and hold 
        harmless {APP_NAME} and its operators from any claims, damages, or legal actions arising 
        from your use of the Service, including but not limited to claims by third parties whose 
        systems you have scanned.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">10. Reporting Abuse</h2>
      <p className="leading-relaxed text-foreground/90">
        If you believe {APP_NAME} is being used in violation of this policy, please report it to{" "}
        <a href={`mailto:${SECURITY_EMAIL}`} className="text-primary hover:underline">
          {SECURITY_EMAIL}
        </a>. For general legal inquiries, contact{" "}
        <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">
          {LEGAL_EMAIL}
        </a>.
      </p>
    </article>
  )
}
