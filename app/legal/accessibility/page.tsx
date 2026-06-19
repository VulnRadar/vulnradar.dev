import { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/config/constants";
import { LegalPageHeader, LegalSection, LegalList } from "@/components/legal";

export const metadata: Metadata = {
  title: `Accessibility Statement | ${APP_NAME}`,
  description: `Our commitment to digital accessibility and WCAG 2.1 compliance for ${APP_NAME}.`,
};

export default function AccessibilityPage() {
  return (
    <article className="space-y-8">
      <LegalPageHeader
        title="Accessibility Statement"
        lastUpdated="March 16, 2026"
        type="accessibility"
      />

      <p className="text-sm text-muted-foreground leading-relaxed">
        {APP_NAME} is committed to ensuring digital accessibility for people
        with disabilities. We are continually improving the user experience for
        everyone and applying the relevant accessibility standards to ensure we
        provide equal access to all users.
      </p>

      <LegalSection title="1. Conformance Status">
        <p>
          We strive to conform to the Web Content Accessibility Guidelines
          (WCAG) 2.1 Level AA standards. These guidelines explain how to make
          web content more accessible for people with disabilities and more
          user-friendly for everyone.
        </p>
      </LegalSection>

      <LegalSection title="2. Accessibility Features">
        <p>Our website includes the following accessibility features:</p>
        <LegalList
          items={[
            <>
              <strong>Keyboard Navigation:</strong> All interactive elements can
              be accessed using keyboard navigation.
            </>,
            <>
              <strong>Screen Reader Compatibility:</strong> Our pages are
              structured with proper headings, landmarks, and ARIA labels.
            </>,
            <>
              <strong>Color Contrast:</strong> We maintain sufficient color
              contrast ratios between text and backgrounds.
            </>,
            <>
              <strong>Focus Indicators:</strong> Visible focus indicators help
              users navigate with keyboards.
            </>,
            <>
              <strong>Alternative Text:</strong> Images include descriptive alt
              text where appropriate.
            </>,
            <>
              <strong>Responsive Design:</strong> Content is accessible across
              different screen sizes and zoom levels.
            </>,
            <>
              <strong>Form Labels:</strong> All form inputs have associated
              labels for clarity.
            </>,
            <>
              <strong>Skip Links:</strong> Skip navigation links allow users to
              bypass repetitive content.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Technologies Used">
        <p>Accessibility of {APP_NAME} relies on:</p>
        <LegalList items={["HTML", "CSS", "JavaScript", "WAI-ARIA"]} />
        <p className="mt-2">
          These technologies are relied upon for conformance with accessibility
          standards.
        </p>
      </LegalSection>

      <LegalSection title="4. Known Limitations">
        <p>Despite our best efforts, there may be some limitations:</p>
        <LegalList
          items={[
            <>
              <strong>Third-party content:</strong> Some integrations (such as
              CAPTCHA) may have limitations. If unable to complete a CAPTCHA
              challenge, please contact us at{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Accessibility%20CAPTCHA%20Issue`}
                className="text-primary hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </>,
            <>
              <strong>Complex data visualizations:</strong> Some security scan
              result charts may require additional screen reader descriptions.
            </>,
            <>
              <strong>PDF exports:</strong> Exported PDF reports may not be
              fully accessible. We recommend using the web interface for the
              most accessible experience.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Feedback">
        <p>
          We welcome your feedback on the accessibility of {APP_NAME}. Please
          let us know if you encounter barriers:
        </p>
        <LegalList
          items={[
            <>
              <strong>Email:</strong>{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Accessibility%20Feedback`}
                className="text-primary hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>
            </>,
            <>
              <strong>Contact Form:</strong>{" "}
              <Link href="/contact" className="text-primary hover:underline">
                vulnradar.dev/contact
              </Link>
            </>,
          ]}
        />
        <p className="mt-2">
          We try to respond to accessibility feedback within 5 business days.
        </p>
      </LegalSection>

      <LegalSection title="6. Compatibility">
        <p>{APP_NAME} is designed to be compatible with:</p>
        <LegalList
          items={[
            "Screen readers (NVDA, JAWS, VoiceOver, TalkBack)",
            "Screen magnification software",
            "Speech recognition software",
            "Keyboard-only navigation",
          ]}
        />
        <p className="mt-2">
          {APP_NAME} is not compatible with browsers older than 3 major versions
          or Internet Explorer.
        </p>
      </LegalSection>

      <LegalSection title="7. Assessment Approach">
        <p>{APP_NAME} assessed accessibility by:</p>
        <LegalList
          items={[
            "Self-evaluation using automated accessibility testing tools",
            "Manual testing with screen readers and keyboard navigation",
            "Review against WCAG 2.1 success criteria",
          ]}
        />
      </LegalSection>

      <LegalSection title="8. Continuous Improvement">
        <p>
          We are committed to maintaining and improving accessibility. As we
          develop new features, we incorporate accessibility testing into our
          development process.
        </p>
      </LegalSection>

      <div className="pt-6 border-t border-border/50">
        <p className="text-xs text-muted-foreground">
          This statement was created on March 16, 2026. For more information,
          please see our{" "}
          <Link href="/legal/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </article>
  );
}
