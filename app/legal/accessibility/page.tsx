import { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/constants"

export const metadata: Metadata = {
  title: `Accessibility Statement | ${APP_NAME}`,
  description: `Our commitment to digital accessibility and WCAG 2.1 compliance for ${APP_NAME}.`,
}

export default function AccessibilityPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8 text-sm text-muted-foreground">
        <h1 className="text-2xl font-bold text-foreground mb-2">Accessibility Statement</h1>
        <p className="text-xs text-muted-foreground mb-6">Last updated: March 16, 2026</p>

        <p className="leading-relaxed text-foreground/90 mb-6">
          {APP_NAME}{" "}
          is committed to ensuring digital accessibility for people with disabilities. 
          We are continually improving the user experience for everyone and applying the relevant 
          accessibility standards to ensure we provide equal access to all users.
        </p>

        <h2 className="text-lg font-semibold text-foreground mt-8">1. Conformance Status</h2>
        <p className="leading-relaxed text-foreground/90">
          We strive to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA standards. 
          These guidelines explain how to make web content more accessible for people with disabilities 
          and more user-friendly for everyone.
        </p>

        <h2 className="text-lg font-semibold text-foreground mt-8">2. Accessibility Features</h2>
        <p className="leading-relaxed text-foreground/90">
          Our website includes the following accessibility features:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2">
          <li><strong>Keyboard Navigation:</strong> All interactive elements can be accessed using keyboard navigation</li>
          <li><strong>Screen Reader Compatibility:</strong> Our pages are structured with proper headings, landmarks, and ARIA labels for screen reader users</li>
          <li><strong>Color Contrast:</strong> We maintain sufficient color contrast ratios between text and backgrounds</li>
          <li><strong>Focus Indicators:</strong> Visible focus indicators help users navigate with keyboards</li>
          <li><strong>Alternative Text:</strong> Images include descriptive alt text where appropriate</li>
          <li><strong>Responsive Design:</strong> Content is accessible across different screen sizes and zoom levels</li>
          <li><strong>Form Labels:</strong> All form inputs have associated labels for clarity</li>
          <li><strong>Skip Links:</strong> Skip navigation links allow users to bypass repetitive content</li>
        </ul>

        <h2 className="text-lg font-semibold text-foreground mt-8">3. Technologies Used</h2>
        <p className="leading-relaxed text-foreground/90">
          Accessibility of {APP_NAME}{" "} 
          relies on the following technologies to work with your web browser 
          and any assistive technologies or plugins installed on your computer:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2">
          <li>HTML</li>
          <li>CSS</li>
          <li>JavaScript</li>
          <li>WAI-ARIA</li>
        </ul>
        <p className="leading-relaxed text-foreground/90 mt-3">
          These technologies are relied upon for conformance with the accessibility standards used.
        </p>

        <h2 className="text-lg font-semibold text-foreground mt-8">4. Known Limitations</h2>
        <p className="leading-relaxed text-foreground/90">
          Despite our best efforts to ensure accessibility, there may be some limitations. We are 
          actively working to identify and address any accessibility barriers. Known limitations include:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2">
          <li><strong>Third-party content:</strong> Some third-party integrations (such as CAPTCHA) may have accessibility limitations outside our control</li>
          <li><strong>Complex data visualizations:</strong> Some security scan result charts may require additional screen reader descriptions</li>
          <li><strong>PDF exports:</strong> Exported PDF reports may not be fully accessible; we recommend using the web interface for optimal accessibility</li>
        </ul>

        <h2 className="text-lg font-semibold text-foreground mt-8">5. Feedback</h2>
        <p className="leading-relaxed text-foreground/90">
          We welcome your feedback on the accessibility of {APP_NAME}. Please let us know if you 
          encounter accessibility barriers:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2">
          <li>
            <strong>Email:</strong>{" "}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Accessibility%20Feedback`} className="text-primary hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </li>
          <li>
            <strong>Contact Form:</strong>{" "}
            <Link href="/contact" className="text-primary hover:underline">
              vulnradar.dev/contact
            </Link>
          </li>
        </ul>
        <p className="leading-relaxed text-foreground/90 mt-3">
          We try to respond to accessibility feedback within 5 business days.
        </p>

        <h2 className="text-lg font-semibold text-foreground mt-8">6. Compatibility</h2>
        <p className="leading-relaxed text-foreground/90">
          {APP_NAME}{" "} 
          is designed to be compatible with the following assistive technologies:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2">
          <li>Screen readers (NVDA, JAWS, VoiceOver, TalkBack)</li>
          <li>Screen magnification software</li>
          <li>Speech recognition software</li>
          <li>Keyboard-only navigation</li>
        </ul>
        <p className="leading-relaxed text-foreground/90 mt-3">
          {APP_NAME} is not compatible with browsers older than 3 major versions or Internet Explorer.
        </p>

        <h2 className="text-lg font-semibold text-foreground mt-8">7. Assessment Approach</h2>
        <p className="leading-relaxed text-foreground/90">
          {APP_NAME} assessed the accessibility of our service by the following approach:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2">
          <li>Self-evaluation using automated accessibility testing tools</li>
          <li>Manual testing with screen readers and keyboard navigation</li>
          <li>Review against WCAG 2.1 success criteria</li>
        </ul>

        <h2 className="text-lg font-semibold text-foreground mt-8">8. Continuous Improvement</h2>
        <p className="leading-relaxed text-foreground/90">
          We are committed to maintaining and improving the accessibility of our service. As we 
          develop new features, we incorporate accessibility testing into our development process 
          to ensure ongoing compliance.
        </p>

        <div className="mt-10 pt-6 border-t border-border">
          <p className="text-xs text-muted-foreground">
            This statement was created on March 16, 2026. For more information, please see our{" "}
            <Link href="/legal/terms" className="text-primary hover:underline">Terms of Service</Link>.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
