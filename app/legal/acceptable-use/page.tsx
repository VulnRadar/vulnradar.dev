import Link from "next/link";
import { APP_NAME } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import {
  LegalPageHeader,
  LegalSection,
  LegalList,
  LegalCallout,
  LegalToc,
} from "@/components/legal";

const SECTIONS = [
  { id: "permitted-uses", label: "1. Permitted Uses" },
  { id: "prohibited-uses", label: "2. Prohibited Uses" },
  {
    id: "authorization-documentation",
    label: "3. Authorization Documentation",
  },
  { id: "bug-bounty-programs", label: "4. Bug Bounty Programs" },
  { id: "safe-harbor", label: "5. Security Research Safe Harbor" },
  { id: "responsible-disclosure", label: "6. Responsible Disclosure" },
  { id: "rate-limits", label: "7. Rate Limits and Fair Use" },
  { id: "enforcement", label: "8. Enforcement" },
  { id: "reporting-abuse", label: "9. Reporting Abuse" },
];

export default async function AcceptableUsePage() {
  const {
    LEGAL_EMAIL: legalEmail,
    SECURITY_EMAIL: securityEmail,
    TERMS_UPDATED_AT: termsUpdatedAt,
  } = await getSettings([
    "LEGAL_EMAIL",
    "SECURITY_EMAIL",
    "TERMS_UPDATED_AT",
  ] as const);
  return (
    <article className="space-y-8">
      <LegalPageHeader
        title="Acceptable Use Policy"
        lastUpdated={termsUpdatedAt}
        type="acceptable-use"
      />

      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        This Acceptable Use Policy (&quot;AUP&quot;) outlines the rules and
        guidelines for using {APP_NAME}. By using the Service, you agree to
        comply with this policy.
      </p>

      <LegalCallout variant="warning" title="Authorization Requirement">
        <p>
          You <strong>MUST</strong> have explicit written authorization from the
          website owner before scanning any target. Scanning websites without
          authorization is strictly prohibited and may constitute a criminal
          offense under laws including the Computer Fraud and Abuse Act (CFAA).
        </p>
      </LegalCallout>

      <LegalToc items={SECTIONS} />

      <LegalSection id="permitted-uses" title="1. Permitted Uses">
        <p>You may use {APP_NAME} to:</p>
        <LegalList
          items={[
            "Scan websites that you own and operate.",
            "Scan websites for which you have explicit, documented written permission.",
            "Perform security assessments as part of an authorized bug bounty program where automated scanning is permitted.",
            "Conduct security research on your own infrastructure or test environments.",
            "Educate yourself about web security best practices using your own test sites.",
          ]}
        />
      </LegalSection>

      <LegalSection id="prohibited-uses" title="2. Prohibited Uses">
        <p>
          You may <strong className="text-foreground">NOT</strong> use{" "}
          {APP_NAME} to:
        </p>
        <LegalList
          items={[
            "Scan any website without authorization from its owner.",
            "Discover vulnerabilities for exploitation, unauthorized access, data theft, or extortion.",
            "Perform reconnaissance for malicious purposes.",
            "Conduct denial-of-service attacks or disrupt any service.",
            "Bypass rate limits or abuse the API.",
            "Perform large-scale internet-wide scanning without authorization.",
            "Scan government, military, financial, healthcare, or critical infrastructure systems without explicit authorization.",
            "Share scan results publicly that could enable exploitation before remediation.",
            "Use scan results to blackmail, extort, or coerce website owners.",
          ]}
        />
      </LegalSection>

      <LegalSection
        id="authorization-documentation"
        title="3. Authorization Documentation"
      >
        <p>
          When scanning websites you do not own, you must maintain
          documentation. Acceptable forms include:
        </p>
        <LegalList
          items={[
            "Written permission (email, letter, or contract) from the website owner.",
            "Active participation in a bug bounty program that permits automated scanning.",
            "A penetration testing agreement or security assessment contract.",
            "Employment where security testing is part of your job duties.",
          ]}
        />
        <p className="mt-3">
          <strong className="text-foreground">
            You are solely responsible
          </strong>{" "}
          for obtaining and maintaining proof of authorization. {APP_NAME} may
          request proof at any time. Failure to provide adequate documentation
          may result in account suspension.
        </p>
      </LegalSection>

      <LegalSection id="bug-bounty-programs" title="4. Bug Bounty Programs">
        <p>If you use {APP_NAME} for bug bounty hunting:</p>
        <LegalList
          items={[
            "Verify that the program scope explicitly permits automated scanning tools.",
            "Comply with all program rules, including rate limiting and out-of-scope areas.",
            "Do not scan targets that are explicitly listed as out-of-scope.",
            "Report findings through the program's designated channels.",
            "Do not publicly disclose vulnerabilities without following the program's disclosure policy.",
          ]}
        />
        <p className="mt-3">
          <strong className="text-foreground">Disclaimer:</strong> {APP_NAME}{" "}
          does not guarantee that any particular bug bounty program permits our
          service. You are responsible for verifying program rules.
        </p>
      </LegalSection>

      <LegalSection id="safe-harbor" title="5. Security Research Safe Harbor">
        <p>
          We support good-faith security research. If conducting legitimate
          research in compliance with this policy:
        </p>
        <LegalList
          items={[
            "You must have proper authorization as described above.",
            "You must not access, modify, or exfiltrate data beyond demonstrating a vulnerability.",
            "You must report findings responsibly and allow reasonable remediation time.",
            "You must not conduct research on critical infrastructure without explicit authorization.",
          ]}
        />
        <p className="mt-3">
          <strong className="text-foreground">Important:</strong> This safe
          harbor applies only to your use of {APP_NAME}. We cannot provide legal
          protection for your interactions with third-party targets.
        </p>
      </LegalSection>

      <LegalSection
        id="responsible-disclosure"
        title="6. Responsible Disclosure"
      >
        <p>
          If you discover vulnerabilities while performing authorized testing,
          we encourage responsible disclosure:
        </p>
        <LegalList
          items={[
            "Report findings privately to the website owner before any public disclosure.",
            "Allow reasonable time (typically 90 days) for remediation before disclosure.",
            "Do not exploit discovered vulnerabilities beyond demonstrating the issue.",
            "Follow the target's vulnerability disclosure policy if one exists.",
          ]}
        />
      </LegalSection>

      <LegalSection id="rate-limits" title="7. Rate Limits and Fair Use">
        <p>
          Your account has a daily scan quota and a cap on how many API keys you
          may have at once, both set by your subscription plan. These limits
          prevent abuse and ensure fair access. Attempting to circumvent rate
          limits may result in immediate account suspension.
        </p>
        <p className="text-xs">
          Full quota table: see{" "}
          <Link
            href="/docs/rate-limits"
            className="text-primary hover:underline"
          >
            Rate Limits
          </Link>{" "}
          in the docs.
        </p>
      </LegalSection>

      <LegalSection id="enforcement" title="8. Enforcement">
        <p>Violations of this Acceptable Use Policy may result in:</p>
        <LegalList
          items={[
            "Temporary or permanent suspension of your account.",
            "Revocation of all API keys.",
            "Reporting to appropriate law enforcement authorities if illegal activity is suspected.",
            "Legal action to recover damages.",
            "Cooperation with law enforcement investigations.",
          ]}
        />
      </LegalSection>

      <LegalSection id="reporting-abuse" title="9. Reporting Abuse">
        <p>
          If you believe {APP_NAME} is being used in violation of this policy,
          please report it to{" "}
          <a
            href={`mailto:${securityEmail}`}
            className="text-primary hover:underline"
          >
            {securityEmail}
          </a>
          . For general legal inquiries, contact{" "}
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
