import { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, LEGAL_EMAIL } from "@/lib/config/constants";
import {
  LegalPageHeader,
  LegalSection,
  LegalList,
  LegalCallout,
} from "@/components/legal";

export const metadata: Metadata = {
  title: `DMCA & Copyright Policy | ${APP_NAME}`,
  description: `Digital Millennium Copyright Act (DMCA) policy and copyright infringement procedures for ${APP_NAME}.`,
};

export default function DMCAPage() {
  return (
    <article className="space-y-8">
      <LegalPageHeader
        title="DMCA & Copyright Policy"
        lastUpdated="March 16, 2026"
        type="dmca"
      />

      <p className="text-sm text-muted-foreground leading-relaxed">
        {APP_NAME} respects the intellectual property rights of others and
        expects our users to do the same. This policy outlines our procedures
        for responding to claims of copyright infringement in accordance with
        the Digital Millennium Copyright Act of 1998 (&quot;DMCA&quot;).
      </p>

      <LegalSection title="1. Reporting Copyright Infringement">
        <p>
          If you believe that your copyrighted work has been copied in a way
          that constitutes copyright infringement and is accessible through our
          Service, please notify our designated DMCA agent. For your complaint
          to be valid under the DMCA, you must provide:
        </p>
        <LegalList
          items={[
            "A physical or electronic signature of a person authorized to act on behalf of the copyright owner.",
            "Identification of the copyrighted work claimed to have been infringed.",
            "Identification of the material that is claimed to be infringing and where it is located on the Service.",
            "Your contact information, including address, telephone number, and email address.",
            "A statement that you have a good faith belief that use of the material is not authorized.",
            "A statement, made under penalty of perjury, that the information is accurate and that you are authorized to act on the copyright owner's behalf.",
          ]}
        />
      </LegalSection>

      <LegalSection title="2. Designated DMCA Agent">
        <p>Please send DMCA notices to our designated agent:</p>
        <LegalCallout variant="info" title="Contact Information">
          <p>
            <strong>Email:</strong>{" "}
            <a
              href={`mailto:${LEGAL_EMAIL}?subject=DMCA%20Notice`}
              className="text-primary hover:underline"
            >
              {LEGAL_EMAIL}
            </a>
          </p>
          <p className="mt-1">
            <strong>Subject Line:</strong> DMCA Takedown Notice
          </p>
        </LegalCallout>
      </LegalSection>

      <LegalSection title="3. Counter-Notification">
        <p>
          If you believe that your material was removed or disabled by mistake
          or misidentification, you may submit a counter-notification. Your
          counter-notification must include:
        </p>
        <LegalList
          items={[
            "Your physical or electronic signature.",
            "Identification of the material that was removed and where it appeared before removal.",
            "A statement under penalty of perjury that you have a good faith belief the material was removed by mistake.",
            "Your name, address, telephone number, and consent to the jurisdiction of the federal district court (Missouri if outside the US).",
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Repeat Infringers">
        <p>
          In accordance with the DMCA and other applicable law, we have adopted
          a policy of terminating, in appropriate circumstances, users who are
          deemed to be repeat infringers. We may also limit access to the
          Service and/or terminate accounts of users who infringe intellectual
          property rights of others.
        </p>
      </LegalSection>

      <LegalSection title="5. Good Faith">
        <p>
          Please note that under Section 512(f) of the DMCA, any person who
          knowingly materially misrepresents that material or activity is
          infringing, or that material was removed by mistake or
          misidentification, may be subject to liability for damages, including
          costs and attorneys&apos; fees.
        </p>
      </LegalSection>

      <LegalSection title="6. Modifications">
        <p>
          We reserve the right to modify this DMCA Policy at any time. Changes
          will be posted on this page with an updated revision date.
        </p>
      </LegalSection>

      <div className="pt-6 border-t border-border/50">
        <p className="text-xs text-muted-foreground">
          For general legal inquiries, please see our{" "}
          <Link href="/legal/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>{" "}
          or contact us at{" "}
          <a
            href={`mailto:${LEGAL_EMAIL}`}
            className="text-primary hover:underline"
          >
            {LEGAL_EMAIL}
          </a>
          .
        </p>
      </div>
    </article>
  );
}
