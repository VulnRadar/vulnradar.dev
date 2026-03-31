import { LEGAL_EMAIL, APP_NAME, APP_URL } from "@/lib/config/constants"
import { LegalPageHeader, LegalSection, LegalList } from "@/components/legal"

export default function TermsPage() {
  return (
    <article className="space-y-8">
      <LegalPageHeader title="Terms of Service" lastUpdated="March 16, 2026" type="terms" />
      
      <p className="text-sm text-muted-foreground leading-relaxed">
        Welcome to {APP_NAME} (&quot;the Service&quot;), operated at {APP_URL}. By creating an
        account or using our Service, you agree to be bound by these Terms of Service
        (&quot;Terms&quot;). If you do not agree, do not use {APP_NAME}.
      </p>

      <LegalSection title="1. Description of Service">
        <p>
          {APP_NAME} is a web-based vulnerability scanning tool that analyzes publicly accessible
          websites for common security misconfigurations, missing security headers, and other
          potential vulnerabilities. The Service provides automated security assessments, detailed
          findings with severity ratings, and remediation guidance.
        </p>
        <p>
          <strong className="text-foreground">Security Tool Disclaimer:</strong> Scan results provided by {APP_NAME} are 
          informational only and may contain false positives or false negatives. The Service does 
          not guarantee the detection of all vulnerabilities or security issues.
        </p>
        <p>
          <strong className="text-foreground">Service Availability Disclaimer:</strong> We do not guarantee that the Service 
          will be uninterrupted, secure, or error-free.
        </p>
      </LegalSection>

      <LegalSection title="2. Eligibility">
        <p>
          You must be at least 13 years of age to use this Service. If you are between 13 and 18 
          years of age, you may only use the Service with the consent and supervision of a parent 
          or legal guardian who agrees to be bound by these Terms on your behalf.
        </p>
        <p>
          <strong className="text-foreground">Parents and guardians:</strong> If you permit a minor to use the Service, you are 
          responsible for their activity and agree to supervise their use.
        </p>
      </LegalSection>

      <LegalSection title="3. Account Responsibilities">
        <LegalList items={[
          "You are responsible for maintaining the confidentiality of your account credentials, API keys, and 2FA backup recovery codes.",
          "You are responsible for all activity that occurs under your account.",
          "You agree to notify us immediately of any unauthorized use of your account.",
          "We reserve the right to suspend or terminate accounts that violate these Terms.",
        ]} />
      </LegalSection>

      <LegalSection title="4. Authorized Use Only">
        <p>
          <strong className="text-foreground">You may only scan websites that you own or have explicit written authorization to test.</strong>{" "}
          Unauthorized scanning of third-party websites may violate laws including the Computer Fraud 
          and Abuse Act (CFAA).
        </p>
        <p>By using {APP_NAME}, you represent and warrant that:</p>
        <LegalList items={[
          "You have proper authorization from the website owner to perform security scans.",
          "You are using the Service for legitimate security research, testing, or educational purposes only.",
          "You will not use the Service to discover vulnerabilities for exploitation or malicious activity.",
          "You will comply with all applicable laws and regulations.",
        ]} />
      </LegalSection>

      <LegalSection title="5. Prohibited Activities">
        <p>You agree NOT to:</p>
        <LegalList items={[
          "Scan any website without authorization from its owner.",
          "Use the Service to perform denial-of-service attacks or any form of disruption.",
          "Attempt to bypass rate limits, authentication, or any security measures of the Service.",
          "Use the Service for any unlawful, harmful, or malicious purposes.",
          "Redistribute, resell, or sublicense access to the API.",
          "Reverse-engineer, decompile, or disassemble any part of the Service.",
        ]} />
      </LegalSection>

      <LegalSection title="6. API Usage">
        <p>
          Access to the {APP_NAME} API is subject to rate limits based on your subscription plan
          (maximum 3 keys per account). We reserve the right to modify rate limits at any time.
          Abuse of the API may result in immediate suspension.
        </p>
      </LegalSection>

      <LegalSection title="7. Data Retention &amp; Deletion">
        <p>
          Scan history is retained for 90 days. API usage logs are retained for 90 days. Data export
          requests are retained for 60 days. You may delete your account and all associated data
          at any time from your profile page.
        </p>
        <p className="font-semibold text-foreground">
          <strong>Data Deletion Rights:</strong> We reserve the right to delete any scan data, user account data, 
          or other information associated with your account at any time and for any reason, including 
          (but not limited to) policy violations, security concerns, content moderation, or routine 
          maintenance. Such deletion may be performed without prior notice and without liability.
        </p>
        <p>
          You agree that {APP_NAME} is under no obligation to retain, restore, or provide backup copies 
          of deleted data. We are not responsible for any loss or damages resulting from data deletion.
        </p>
      </LegalSection>

      <LegalSection title="8. Limitation of Liability">
        <p className="uppercase text-xs font-medium text-foreground">
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
          EITHER EXPRESS OR IMPLIED.
        </p>
        <p>
          {APP_NAME} shall not be liable for any direct, indirect, incidental, special, consequential, 
          or exemplary damages resulting from your use of the Service, including damages from unauthorized 
          scanning, legal consequences from misuse, or false positives/negatives in scan results.
        </p>
        <p className="text-xs font-medium text-foreground mt-2">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY SHALL NOT EXCEED THE GREATER OF 
          (A) THE AMOUNT YOU PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (B) $100 USD.
        </p>
      </LegalSection>

      <LegalSection title="9. Indemnification">
        <p>
          You agree to indemnify, defend, and hold harmless {APP_NAME} and its operators from any
          claims, damages, or expenses arising from your use of the Service or violation of these Terms.
        </p>
      </LegalSection>

      <LegalSection title="10. Termination">
        <p>
          We reserve the right to suspend or terminate your access at any time for violation of these 
          Terms. Upon termination, your right to use the Service ceases immediately. You may delete 
          your account at any time.
        </p>
      </LegalSection>

      <LegalSection title="11. Governing Law">
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the State 
          of Missouri, United States. Any legal action shall be brought exclusively in the state 
          or federal courts located in Missouri.
        </p>
      </LegalSection>

      <LegalSection title="12. Dispute Resolution">
        <p className="text-xs font-medium text-foreground">
          PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR LEGAL RIGHTS.
        </p>
        <p>
          You and {APP_NAME} agree that any dispute will be resolved through binding arbitration, 
          rather than in court, except for claims in small claims court. Before initiating arbitration, 
          contact us at {LEGAL_EMAIL} to attempt informal resolution.
        </p>
      </LegalSection>

      <LegalSection title="13. Class Action Waiver">
        <p className="text-xs font-medium text-foreground">
          YOU AND {APP_NAME.toUpperCase()} AGREE THAT EACH MAY BRING CLAIMS ONLY IN YOUR INDIVIDUAL 
          CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY CLASS OR REPRESENTATIVE PROCEEDING.
        </p>
      </LegalSection>

      <LegalSection title="14. Changes to Terms">
        <p>
          We may update these Terms at any time. When we make material changes, we will notify you 
          by displaying a prominent notice within the Service or by email. Continued use constitutes 
          acceptance of the revised Terms.
        </p>
      </LegalSection>

      <LegalSection title="15. Contact">
        <p>
          For questions about these Terms, please contact us at{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a>.
        </p>
      </LegalSection>
    </article>
  )
}
