import { Metadata } from "next"
import Link from "next/link"
import { APP_NAME, LEGAL_EMAIL } from "@/lib/config/constants"

export const metadata: Metadata = {
  title: `DMCA & Copyright Policy | ${APP_NAME}`,
  description: `Digital Millennium Copyright Act (DMCA) policy and copyright infringement procedures for ${APP_NAME}.`,
}

export default function DMCAPage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground">
        <h1 className="text-2xl font-bold text-foreground mb-2">DMCA & Copyright Policy</h1>
        <p className="text-xs text-muted-foreground mb-6">Last updated: March 16, 2026</p>

        <p className="leading-relaxed text-foreground/90 mb-6">
          {APP_NAME} respects the intellectual property rights of others and expects our users to do the same. 
          This policy outlines our procedures for responding to claims of copyright infringement in accordance 
          with the Digital Millennium Copyright Act of 1998 (&quot;DMCA&quot;).
        </p>

        <h2 className="text-lg font-semibold text-foreground mt-8">1. Reporting Copyright Infringement</h2>
        <p className="leading-relaxed text-foreground/90">
          If you believe that your copyrighted work has been copied in a way that constitutes copyright 
          infringement and is accessible through our Service, please notify our designated DMCA agent. 
          For your complaint to be valid under the DMCA, you must provide the following information in writing:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2">
          <li>A physical or electronic signature of a person authorized to act on behalf of the copyright owner</li>
          <li>Identification of the copyrighted work claimed to have been infringed</li>
          <li>Identification of the material that is claimed to be infringing and where it is located on the Service</li>
          <li>Your contact information, including address, telephone number, and email address</li>
          <li>A statement that you have a good faith belief that use of the material is not authorized by the copyright owner, its agent, or the law</li>
          <li>A statement, made under penalty of perjury, that the information in your notice is accurate and that you are the copyright owner or authorized to act on the copyright owner&apos;s behalf</li>
        </ul>

        <h2 className="text-lg font-semibold text-foreground mt-8">2. Designated DMCA Agent</h2>
        <p className="leading-relaxed text-foreground/90">
          Please send DMCA notices to our designated agent:
        </p>
        <div className="mt-3 p-4 bg-muted/30 rounded-lg border border-border">
          <p className="text-foreground/90">
            <strong>Email:</strong>{" "}
            <a href={`mailto:${LEGAL_EMAIL}?subject=DMCA%20Notice`} className="text-primary hover:underline">
              {LEGAL_EMAIL}
            </a>
          </p>
          <p className="text-foreground/90 mt-1">
            <strong>Subject Line:</strong> DMCA Takedown Notice
          </p>
        </div>

        <h2 className="text-lg font-semibold text-foreground mt-8">3. Counter-Notification</h2>
        <p className="leading-relaxed text-foreground/90">
          If you believe that your material was removed or disabled by mistake or misidentification, you may 
          submit a counter-notification. Your counter-notification must include:
        </p>
        <ul className="list-disc pl-6 mt-3 space-y-2">
          <li>Your physical or electronic signature</li>
          <li>Identification of the material that was removed and where it appeared before removal</li>
          <li>A statement under penalty of perjury that you have a good faith belief the material was removed by mistake or misidentification</li>
          <li>Your name, address, telephone number, and a statement consenting to the jurisdiction of the federal district court for your address (or Missouri if outside the US)</li>
        </ul>

        <h2 className="text-lg font-semibold text-foreground mt-8">4. Repeat Infringers</h2>
        <p className="leading-relaxed text-foreground/90">
          In accordance with the DMCA and other applicable law, we have adopted a policy of terminating, 
          in appropriate circumstances and at our sole discretion, users who are deemed to be repeat 
          infringers. We may also, at our sole discretion, limit access to the Service and/or terminate 
          the accounts of any users who infringe any intellectual property rights of others, whether or 
          not there is any repeat infringement.
        </p>

        <h2 className="text-lg font-semibold text-foreground mt-8">5. Good Faith</h2>
        <p className="leading-relaxed text-foreground/90">
          Please note that under Section 512(f) of the DMCA, any person who knowingly materially 
          misrepresents that material or activity is infringing, or that material or activity was 
          removed or disabled by mistake or misidentification, may be subject to liability for damages, 
          including costs and attorneys&apos; fees.
        </p>

        <h2 className="text-lg font-semibold text-foreground mt-8">6. Modifications</h2>
        <p className="leading-relaxed text-foreground/90">
          We reserve the right to modify this DMCA Policy at any time. Changes will be posted on this 
          page with an updated revision date.
        </p>

        <div className="mt-10 pt-6 border-t border-border">
          <p className="text-xs text-muted-foreground">
            For general legal inquiries, please see our{" "}
            <Link href="/legal/terms" className="text-primary hover:underline">Terms of Service</Link> or contact us at{" "}
            <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a>.
          </p>
        </div>
    </article>
  )
}
