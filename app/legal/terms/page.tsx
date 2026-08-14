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
  { id: "description-of-service", label: "1. Description of Service" },
  { id: "eligibility", label: "2. Eligibility" },
  { id: "account-responsibilities", label: "3. Account Responsibilities" },
  { id: "authorized-use-only", label: "4. Authorized Use Only" },
  { id: "prohibited-activities", label: "5. Prohibited Activities" },
  { id: "api-usage", label: "6. API Usage" },
  { id: "data-retention", label: "7. Data Retention & Deletion" },
  { id: "limitation-of-liability", label: "8. Limitation of Liability" },
  { id: "indemnification", label: "9. Indemnification" },
  { id: "termination", label: "10. Termination" },
  { id: "governing-law", label: "11. Governing Law" },
  { id: "dispute-resolution", label: "12. Dispute Resolution" },
  { id: "class-action-waiver", label: "13. Class Action Waiver" },
  { id: "changes-to-terms", label: "14. Changes to Terms" },
  { id: "contact", label: "15. Contact" },
];

export default async function TermsPage() {
  const { LEGAL_EMAIL: legalEmail, TERMS_UPDATED_AT: termsUpdatedAt } =
    await getSettings(["LEGAL_EMAIL", "TERMS_UPDATED_AT"] as const);
  return (
    <article className="space-y-8">
      <LegalPageHeader
        title="Terms of Service"
        lastUpdated={termsUpdatedAt}
        type="terms"
      />

      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Welcome to {APP_NAME} (&quot;the Service&quot;), operated at {APP_URL}.
        By creating an account or using our Service, you agree to be bound by
        these Terms of Service (&quot;Terms&quot;). If you do not agree, do not
        use {APP_NAME}.
      </p>

      <LegalToc items={SECTIONS} />

      <LegalSection
        id="description-of-service"
        title="1. Description of Service"
      >
        <p>
          {APP_NAME} is a web-based vulnerability scanning tool that analyzes
          websites for security misconfigurations, missing security headers,
          exposed secrets, and other potential vulnerabilities. Beyond passive
          checks (reading response headers, page content, and configuration),
          some checks actively probe the target with test payloads (for example,
          to detect SQL injection or server-side template injection) to confirm
          a finding. The Service provides automated security assessments,
          detailed findings with severity ratings, and remediation guidance.
        </p>
        <p>
          <strong className="text-foreground">Security Tool Disclaimer:</strong>{" "}
          Scan results provided by {APP_NAME} are informational only and may
          contain false positives or false negatives. The Service does not
          guarantee the detection of all vulnerabilities or security issues.
        </p>
        <p>
          <strong className="text-foreground">
            Service Availability Disclaimer:
          </strong>{" "}
          We do not guarantee that the Service will be uninterrupted, secure, or
          error-free.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" title="2. Eligibility">
        <p>
          You must be at least 13 years of age to use this Service. If you are
          between 13 and 18 years of age, you may only use the Service with the
          consent and supervision of a parent or legal guardian who agrees to be
          bound by these Terms on your behalf.
        </p>
        <p>
          <strong className="text-foreground">Parents and guardians:</strong> If
          you permit a minor to use the Service, you are responsible for their
          activity and agree to supervise their use.
        </p>
      </LegalSection>

      <LegalSection
        id="account-responsibilities"
        title="3. Account Responsibilities"
      >
        <LegalList
          items={[
            "You are responsible for maintaining the confidentiality of your account credentials, API keys, and 2FA backup recovery codes.",
            "You are responsible for all activity that occurs under your account.",
            "You agree to notify us immediately of any unauthorized use of your account.",
            "We reserve the right to suspend or terminate accounts that violate these Terms.",
          ]}
        />
      </LegalSection>

      <LegalSection id="authorized-use-only" title="4. Authorized Use Only">
        <p>
          <strong className="text-foreground">
            You may only scan websites that you own or have explicit written
            authorization to test.
          </strong>{" "}
          Unauthorized scanning of third-party websites may violate laws
          including the Computer Fraud and Abuse Act (CFAA).
        </p>
        <p>By using {APP_NAME}, you represent and warrant that:</p>
        <LegalList
          items={[
            "You have proper authorization from the website owner to perform security scans.",
            "You are using the Service for legitimate security research, testing, or educational purposes only.",
            "You will not use the Service to discover vulnerabilities for exploitation or malicious activity.",
            "You will comply with all applicable laws and regulations.",
          ]}
        />
      </LegalSection>

      <LegalSection id="prohibited-activities" title="5. Prohibited Activities">
        <p>You agree NOT to:</p>
        <LegalList
          items={[
            "Scan any website without authorization from its owner.",
            "Use the Service to perform denial-of-service attacks or any form of disruption.",
            "Attempt to bypass rate limits, authentication, or any security measures of the Service.",
            "Use the Service for any unlawful, harmful, or malicious purposes.",
            "Redistribute, resell, or sublicense access to the API.",
            "Reverse-engineer, decompile, or disassemble any part of the Service.",
          ]}
        />
      </LegalSection>

      <LegalSection id="api-usage" title="6. API Usage">
        <p>
          Access to the {APP_NAME} API is subject to rate limits and a cap on
          how many API keys you may have at once, both based on your
          subscription plan. We reserve the right to modify rate limits at any
          time. Abuse of the API may result in immediate suspension.
        </p>
        <p className="text-xs">
          Technical reference: current limits are documented on the{" "}
          <Link
            href="/docs/rate-limits"
            className="text-primary hover:underline"
          >
            Rate Limits
          </Link>{" "}
          page, and the endpoints themselves on the{" "}
          <Link href="/docs/api" className="text-primary hover:underline">
            API Reference
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection
        id="data-retention"
        title="7. Data Retention &amp; Deletion"
      >
        <p>
          Scan history is kept for as long as your account is active. API usage
          logs are retained for 90 days. Data export requests are retained for
          60 days. You may delete your account and all associated data at any
          time from your profile page; see the{" "}
          <Link
            href="/legal/privacy#data-retention"
            className="text-primary hover:underline"
          >
            Privacy Policy&apos;s Data Retention section
          </Link>{" "}
          for the full list of retention windows.
        </p>
        <p className="font-semibold text-foreground">
          <strong>Data Deletion Rights:</strong> We reserve the right to delete
          any scan data, user account data, or other information associated with
          your account at any time and for any reason, including (but not
          limited to) policy violations, security concerns, content moderation,
          or routine maintenance. Such deletion may be performed without prior
          notice and without liability.
        </p>
        <p>
          You agree that {APP_NAME} is under no obligation to retain, restore,
          or provide backup copies of deleted data. We are not responsible for
          any loss or damages resulting from data deletion.
        </p>
      </LegalSection>

      <LegalSection
        id="limitation-of-liability"
        title="8. Limitation of Liability"
      >
        <p className="uppercase text-xs font-medium text-foreground">
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;
          WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
        </p>
        <p>
          {APP_NAME} shall not be liable for any direct, indirect, incidental,
          special, consequential, or exemplary damages resulting from your use
          of the Service, including damages from unauthorized scanning, legal
          consequences from misuse, or false positives/negatives in scan
          results.
        </p>
        <p className="text-xs font-medium text-foreground mt-2">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY SHALL NOT
          EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE TWELVE (12)
          MONTHS PRECEDING THE CLAIM, OR (B) $100 USD.
        </p>
      </LegalSection>

      <LegalSection id="indemnification" title="9. Indemnification">
        <p>
          You agree to indemnify, defend, and hold harmless {APP_NAME} and its
          operators from any claims, damages, or expenses arising from your use
          of the Service or violation of these Terms.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="10. Termination">
        <p>
          We reserve the right to suspend or terminate your access at any time
          for violation of these Terms. Upon termination, your right to use the
          Service ceases immediately. You may delete your account at any time.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" title="11. Governing Law">
        <p>
          These Terms shall be governed by and construed in accordance with the
          laws of the State of Missouri, United States. Any legal action shall
          be brought exclusively in the state or federal courts located in
          Missouri.
        </p>
      </LegalSection>

      <LegalSection id="dispute-resolution" title="12. Dispute Resolution">
        <p className="text-xs font-medium text-foreground">
          PLEASE READ THIS SECTION CAREFULLY. IT AFFECTS YOUR LEGAL RIGHTS.
        </p>
        <p>
          You and {APP_NAME} agree that any dispute will be resolved through
          binding arbitration, rather than in court, except for claims in small
          claims court. Before initiating arbitration, contact us at{" "}
          {legalEmail} to attempt informal resolution.
        </p>
      </LegalSection>

      <LegalSection id="class-action-waiver" title="13. Class Action Waiver">
        <p className="text-xs font-medium text-foreground">
          YOU AND {APP_NAME.toUpperCase()} AGREE THAT EACH MAY BRING CLAIMS ONLY
          IN YOUR INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN
          ANY CLASS OR REPRESENTATIVE PROCEEDING.
        </p>
      </LegalSection>

      <LegalSection id="changes-to-terms" title="14. Changes to Terms">
        <p>
          We may update these Terms at any time. When we make material changes,
          we will notify you by displaying a prominent notice within the Service
          or by email. Continued use constitutes acceptance of the revised
          Terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="15. Contact">
        <p>
          For questions about these Terms, please contact us at{" "}
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
