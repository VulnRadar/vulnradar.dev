import {
  TOTAL_CHECKS_LABEL,
  LEGAL_EMAIL,
  APP_NAME,
} from "@/lib/config/constants";
import {
  LegalPageHeader,
  LegalSection,
  LegalList,
  LegalCallout,
} from "@/components/legal";

export default function DisclaimerPage() {
  return (
    <article className="space-y-8">
      <LegalPageHeader
        title="Disclaimer"
        lastUpdated="March 16, 2026"
        type="disclaimer"
      />

      <LegalCallout variant="danger" title="Important Notice">
        <p>
          {APP_NAME} is provided strictly for{" "}
          <strong>
            authorized security testing, research, and educational purposes
          </strong>
          . The operators of {APP_NAME} are <strong>NOT responsible</strong> for
          any misuse, damages, legal consequences, or any other outcome
          resulting from the use of this tool. You use {APP_NAME} entirely at
          your own risk.
        </p>
      </LegalCallout>

      <LegalSection title="1. No Warranty">
        <p className="uppercase text-xs font-medium text-foreground">
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;
          WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
        </p>
        <p>We make no warranty that:</p>
        <LegalList
          items={[
            "Scan results are complete, accurate, or free from errors.",
            "The Service will identify all vulnerabilities present on a target.",
            "The Service will be uninterrupted, timely, or error-free.",
            "Remediation guidance will resolve all security issues.",
            "The Service will meet your specific requirements.",
          ]}
        />
      </LegalSection>

      <LegalSection title="2. Not Professional Security Advice">
        <p>
          {APP_NAME} scan results do{" "}
          <strong className="text-foreground">NOT</strong> constitute
          professional security advice, a security audit, or a penetration test.
          The results should be used as a starting point for further
          investigation. For comprehensive security assessments, consult a
          qualified cybersecurity professional.
        </p>
      </LegalSection>

      <LegalSection title="3. Accuracy of Results">
        <p>
          {APP_NAME} performs {TOTAL_CHECKS_LABEL} automated vulnerability
          checks based on publicly observable information. Results may include:
        </p>
        <LegalList
          items={[
            <>
              <strong>False positives</strong>: issues flagged that are not
              actual vulnerabilities in your context.
            </>,
            <>
              <strong>False negatives</strong>: real vulnerabilities that the
              scanner does not detect.
            </>,
            <>
              <strong>Incomplete coverage</strong>: the scanner checks specific
              known issues, not all vulnerability classes.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Your Responsibility">
        <p>You are solely responsible for:</p>
        <LegalList
          items={[
            "Ensuring you have proper authorization before scanning any website.",
            "Verifying scan results before taking any action.",
            "Any consequences resulting from scanning a website.",
            "Compliance with all applicable laws and regulations.",
            "Any damages to systems or data resulting from actions based on scan results.",
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Limitation of Liability">
        <p className="uppercase text-xs font-medium text-foreground">
          IN NO EVENT SHALL {APP_NAME.toUpperCase()}, ITS OPERATORS,
          CONTRIBUTORS, OR AFFILIATES BE LIABLE FOR ANY DIRECT, INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES.
        </p>
        <p className="text-xs font-medium text-foreground mt-3">
          OUR TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE GREATER OF (A) THE
          AMOUNTS YOU HAVE PAID IN THE TWELVE (12) MONTHS PRIOR TO THE CLAIM, OR
          (B) $100 USD.
        </p>
      </LegalSection>

      <LegalSection title="6. Indemnification">
        <p>
          You agree to indemnify, defend, and hold harmless {APP_NAME} and its
          operators from any claims, damages, or expenses arising from:
        </p>
        <LegalList
          items={[
            "Your use of and access to the Service.",
            "Your violation of any term of these Terms or related policies.",
            "Your violation of any third-party right.",
            "Any claim that your use of the Service caused damage to a third party.",
            "Unauthorized scanning of websites you do not own or have permission to test.",
          ]}
        />
      </LegalSection>

      <LegalSection title="7. Legal Compliance">
        <p>
          Unauthorized computer scanning may violate criminal and civil laws
          including:
        </p>
        <LegalList
          items={[
            <>
              <strong>United States</strong>: Computer Fraud and Abuse Act
              (CFAA), 18 U.S.C. § 1030
            </>,
            <>
              <strong>Missouri</strong>: Missouri Computer Tampering Laws, Mo.
              Rev. Stat. § 569.095-569.099
            </>,
            <>
              <strong>United Kingdom</strong>: Computer Misuse Act 1990
            </>,
            <>
              <strong>Germany</strong>: Strafgesetzbuch (StGB) Section 202c
            </>,
            <>
              <strong>European Union</strong>: Directive 2013/40/EU on attacks
              against information systems
            </>,
          ]}
        />
        <p className="mt-3">
          It is your responsibility to understand and comply with the laws
          applicable in your jurisdiction and the jurisdiction where the target
          systems are located.
        </p>
      </LegalSection>

      <LegalSection title="8. Governing Law">
        <p>
          This Disclaimer shall be governed by the laws of the State of
          Missouri, United States. Any disputes shall be subject to the
          exclusive jurisdiction of the courts located in Missouri.
        </p>
      </LegalSection>

      <LegalSection title="9. Contact">
        <p>
          For questions about this Disclaimer, please contact us at{" "}
          <a
            href={`mailto:${LEGAL_EMAIL}`}
            className="text-primary hover:underline"
          >
            {LEGAL_EMAIL}
          </a>
          .
        </p>
        <p className="mt-2">
          {APP_NAME} is operated from Missouri, United States.
        </p>
      </LegalSection>
    </article>
  );
}
