import { LEGAL_EMAIL, APP_NAME, APP_URL } from "@/lib/constants"

export default function TermsPage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold text-foreground">Terms of Service</h1>
      <p className="text-sm text-muted-foreground">Last updated: March 16, 2026</p>

      <p className="leading-relaxed text-foreground/90">
        Welcome to {APP_NAME} (&quot;the Service&quot;), operated at {APP_URL}. By creating an
        account or using our Service, you agree to be bound by these Terms of Service
        (&quot;Terms&quot;). If you do not agree, do not use {APP_NAME}.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">1. Description of Service</h2>
      <p className="leading-relaxed text-foreground/90">
        {APP_NAME}{" "} 
        is a web-based vulnerability scanning tool that analyzes publicly accessible
        websites for common security misconfigurations, missing security headers, and other
        potential vulnerabilities. The Service provides automated security assessments, detailed
        findings with severity ratings, and remediation guidance.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">2. Eligibility</h2>
      <p className="leading-relaxed text-foreground/90">
        You must be at least 13 years of age to use this Service. If you are between 13 and 18 
        years of age (or the age of majority in your jurisdiction), you may only use the Service 
        with the consent and supervision of a parent or legal guardian who agrees to be bound by 
        these Terms on your behalf. By registering, you represent and warrant that you meet these 
        eligibility requirements.
      </p>
      <p className="leading-relaxed text-foreground/90 mt-3">
        <strong>Parents and guardians:</strong> If you permit a minor to use the Service, you are 
        responsible for their activity and agree to supervise their use to ensure compliance with 
        these Terms, the Acceptable Use Policy, and all applicable laws regarding computer access 
        and security testing.
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
        By using {APP_NAME}, you represent and warrant that:
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
        <li>Redistribute, resell, or sublicense access to {APP_NAME} or its API.</li>
        <li>Reverse-engineer, decompile, or disassemble any part of the Service.</li>
        <li>Use automated tools to scrape, harvest, or extract data from the Service beyond the documented API.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">6. API Usage</h2>
      <p className="leading-relaxed text-foreground/90">
        Access to the {APP_NAME} API is subject to rate limits (50 requests per API key per day,
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
        EITHER EXPRESS OR IMPLIED.</strong> {APP_NAME}, its operators, contributors, and affiliates
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
      <p className="leading-relaxed text-foreground/90 mt-4">
        <strong>TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS 
        ARISING FROM OR RELATED TO THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT 
        YOU PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (B) ONE HUNDRED DOLLARS ($100 USD).</strong>
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">9. Indemnification</h2>
      <p className="leading-relaxed text-foreground/90">
        You agree to indemnify, defend, and hold harmless {APP_NAME} and its operators from and
        against any claims, damages, obligations, losses, liabilities, costs, or expenses arising
        from your use of the Service or violation of these Terms.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">10. Termination</h2>
      <p className="leading-relaxed text-foreground/90">
        We reserve the right to suspend or terminate your access to the Service at any time for
        violation of these Terms or for any conduct that we, in our sole discretion, believe is 
        harmful to other users, us, or third parties, or violates any applicable law. We will 
        make reasonable efforts to provide notice of termination when practicable, except in 
        cases of severe violations where immediate action is necessary. Upon termination, your 
        right to use the Service ceases immediately. You may delete your account at any time.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">11. Governing Law and Jurisdiction</h2>
      <p className="leading-relaxed text-foreground/90">
        These Terms shall be governed by and construed in accordance with the laws of the State 
        of Missouri, United States, without regard to its conflict of law provisions. You agree 
        that any legal action or proceeding arising out of or relating to these Terms or the 
        Service shall be brought exclusively in the state or federal courts located in Missouri, 
        and you hereby consent to the personal jurisdiction and venue of such courts.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">12. Dispute Resolution and Arbitration</h2>
      <p className="leading-relaxed text-foreground/90">
        <strong>PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR LEGAL RIGHTS, INCLUDING YOUR 
        RIGHT TO FILE A LAWSUIT IN COURT.</strong>
      </p>
      <p className="leading-relaxed text-foreground/90 mt-4">
        You and {APP_NAME} agree that any dispute, claim, or controversy arising out of or relating 
        to these Terms or the Service (collectively, &quot;Disputes&quot;) will be resolved through binding 
        arbitration, rather than in court, except that you may assert claims in small claims court 
        if your claims qualify.
      </p>
      <p className="leading-relaxed text-foreground/90 mt-4">
        <strong>Arbitration Rules:</strong> The arbitration will be conducted by a single arbitrator 
        under the rules of the American Arbitration Association (&quot;AAA&quot;) Consumer Arbitration Rules. 
        The arbitration shall take place in Missouri, United States, or may be conducted by telephone 
        or video conference if mutually agreed.
      </p>
      <p className="leading-relaxed text-foreground/90 mt-4">
        <strong>Informal Resolution First:</strong> Before initiating arbitration, you agree to first 
        contact us at {LEGAL_EMAIL} to attempt to resolve the dispute informally. We will attempt to 
        resolve the dispute within 60 days. If the dispute is not resolved within 60 days, either 
        party may proceed with arbitration.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">13. Class Action Waiver</h2>
      <p className="leading-relaxed text-foreground/90">
        <strong>YOU AND {APP_NAME.toUpperCase()} AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER ONLY IN YOUR 
        OR ITS INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS 
        OR REPRESENTATIVE PROCEEDING.</strong> Unless both you and {APP_NAME} agree otherwise, the 
        arbitrator may not consolidate more than one person&apos;s claims and may not otherwise preside 
        over any form of a representative or class proceeding.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">14. Force Majeure</h2>
      <p className="leading-relaxed text-foreground/90">
        {APP_NAME} shall not be liable for any failure or delay in performing its obligations under 
        these Terms due to circumstances beyond its reasonable control, including but not limited to: 
        acts of God, natural disasters, war, terrorism, riots, embargoes, acts of civil or military 
        authorities, fire, floods, accidents, strikes, shortages of transportation, facilities, fuel, 
        energy, labor, or materials, pandemic or epidemic, failure of third-party services, internet 
        outages, cyberattacks, or government actions.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">15. Assignment</h2>
      <p className="leading-relaxed text-foreground/90">
        You may not assign or transfer these Terms, or any rights or obligations hereunder, without 
        our prior written consent. We may assign these Terms, in whole or in part, to any person or 
        entity at any time with or without your consent, including in connection with a merger, 
        acquisition, corporate reorganization, or sale of all or substantially all of our assets. 
        Any attempted assignment in violation of this section shall be null and void.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">16. Severability</h2>
      <p className="leading-relaxed text-foreground/90">
        If any provision of these Terms is held to be invalid, illegal, or unenforceable by a court 
        of competent jurisdiction, such provision shall be modified to the minimum extent necessary 
        to make it valid and enforceable, or if modification is not possible, shall be severed from 
        these Terms. The remaining provisions shall continue in full force and effect.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">17. Entire Agreement</h2>
      <p className="leading-relaxed text-foreground/90">
        These Terms, together with the Privacy Policy, Acceptable Use Policy, and Disclaimer, 
        constitute the entire agreement between you and {APP_NAME} regarding the Service and 
        supersede all prior agreements, representations, and understandings.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">18. Changes to Terms</h2>
      <p className="leading-relaxed text-foreground/90">
        We may update these Terms at any time. When we make material changes, we will notify you 
        by displaying a prominent notice within the Service or by sending you an email. You will 
        be required to accept the updated Terms to continue using the Service. If you do not agree 
        to the updated Terms, you may delete your account. Continued use of the Service after 
        accepting changes constitutes acceptance of the revised Terms.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">19. Contact</h2>
      <p className="leading-relaxed text-foreground/90">
        For questions about these Terms, please contact us at{" "}
        <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">
          {LEGAL_EMAIL}
        </a>.
      </p>
    </article>
  )
}
