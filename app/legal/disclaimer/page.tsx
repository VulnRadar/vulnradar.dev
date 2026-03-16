import { TOTAL_CHECKS_LABEL, LEGAL_EMAIL, APP_NAME } from "@/lib/constants"

export default function DisclaimerPage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold text-foreground">Disclaimer</h1>
      <p className="text-sm text-muted-foreground">Last updated: March 16, 2026</p>

      <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-6 my-6">
        <h2 className="text-lg font-bold text-destructive mt-0">Important Notice</h2>
        <p className="leading-relaxed text-foreground/90 mb-0">
          {APP_NAME}{" "}} 
          is provided strictly for <strong>authorized security testing, research, and
          educational purposes</strong>.         The operators of {APP_NAME}{" "}} 
        are <strong>NOT responsible</strong> for
        any misuse, damages, legal consequences, or any other outcome resulting from the use
        of this tool. You use {APP_NAME}{" "}} 
        entirely at your own risk.
        </p>
      </div>

      <h2 className="text-lg font-semibold text-foreground mt-8">1. No Warranty</h2>
      <p className="leading-relaxed text-foreground/90">
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
        INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, AND NONINFRINGEMENT. TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, 
        WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED. We make no warranty that:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Scan results are complete, accurate, or free from errors.</li>
        <li>The Service will identify all vulnerabilities present on a target.</li>
        <li>The Service will be uninterrupted, timely, or error-free.</li>
        <li>Remediation guidance will resolve all security issues.</li>
        <li>The Service will meet your specific requirements or expectations.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">2. Not Professional Security Advice</h2>
      <p className="leading-relaxed text-foreground/90">
        {APP_NAME}{" "}} 
        scan results and remediation guidance do <strong>NOT</strong> constitute
        professional security advice, a security audit, or a penetration test. The results
        should be used as a starting point for further investigation. For comprehensive
        security assessments, consult a qualified cybersecurity professional.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">3. Accuracy of Results</h2>
      <p className="leading-relaxed text-foreground/90">
        {APP_NAME}{" "}} 
        performs {TOTAL_CHECKS_LABEL} automated vulnerability checks based on publicly observable
        information (HTTP headers, HTML content, SSL/TLS configuration, JavaScript analysis,
        and more). Results may include:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li><strong>False positives</strong>: issues flagged that are not actual vulnerabilities in your specific context.</li>
        <li><strong>False negatives</strong>: real vulnerabilities that the scanner does not detect.</li>
        <li><strong>Incomplete coverage</strong>: the scanner checks a specific set of known issues and does not cover all possible vulnerability classes.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">4. Your Responsibility</h2>
      <p className="leading-relaxed text-foreground/90">
        You are solely responsible for:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Ensuring you have proper authorization before scanning any website.</li>
        <li>Verifying scan results before taking any action.</li>
        <li>Any consequences resulting from scanning a website, whether authorized or unauthorized.</li>
        <li>Compliance with all applicable laws and regulations in your jurisdiction.</li>
        <li>Any damages to systems or data that may result from actions taken based on scan results.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">5. Limitation of Liability</h2>
      <p className="leading-relaxed text-foreground/90">
        IN NO EVENT SHALL {APP_NAME.toUpperCase()}, ITS OPERATORS, CONTRIBUTORS, OR AFFILIATES BE LIABLE
        FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES
        (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF
        USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
        LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
        OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SERVICE, EVEN IF ADVISED OF THE
        POSSIBILITY OF SUCH DAMAGE.
      </p>
      <p className="leading-relaxed text-foreground/90 mt-4">
        <strong>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OUR TOTAL AGGREGATE LIABILITY 
        TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE USE OF OR INABILITY TO USE THE 
        SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU HAVE PAID TO US IN THE TWELVE 
        (12) MONTHS PRIOR TO THE CLAIM, OR (B) ONE HUNDRED DOLLARS ($100 USD).</strong>
      </p>
      <p className="leading-relaxed text-foreground/90 mt-4">
        Some jurisdictions do not allow the exclusion or limitation of incidental or consequential 
        damages, so the above limitation or exclusion may not apply to you. In such jurisdictions, 
        our liability shall be limited to the maximum extent permitted by law.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">6. Indemnification</h2>
      <p className="leading-relaxed text-foreground/90">
        You agree to indemnify, defend, and hold harmless {APP_NAME}, its operators, employees, 
        agents, and affiliates from and against any and all claims, damages, obligations, losses, 
        liabilities, costs, debt, and expenses (including but not limited to attorney&apos;s fees) arising from:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Your use of and access to the Service.</li>
        <li>Your violation of any term of these Terms or related policies.</li>
        <li>Your violation of any third-party right, including without limitation any copyright, 
        property, or privacy right.</li>
        <li>Any claim that your use of the Service caused damage to a third party.</li>
        <li>Unauthorized scanning of websites you do not own or have permission to test.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">7. Legal Compliance</h2>
      <p className="leading-relaxed text-foreground/90">
        Unauthorized computer scanning may violate criminal and civil laws including:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li><strong>United States</strong>: Computer Fraud and Abuse Act (CFAA), 18 U.S.C. § 1030</li>
        <li><strong>Missouri</strong>: Missouri Computer Tampering Laws, Mo. Rev. Stat. § 569.095-569.099</li>
        <li><strong>United Kingdom</strong>: Computer Misuse Act 1990</li>
        <li><strong>Germany</strong>: Strafgesetzbuch (StGB) Section 202c</li>
        <li><strong>European Union</strong>: Directive 2013/40/EU on attacks against information systems</li>
        <li>Equivalent cybercrime legislation in other jurisdictions</li>
      </ul>
      <p className="leading-relaxed text-foreground/90">
        It is your responsibility to understand and comply with the laws applicable in your
        jurisdiction and the jurisdiction where the target systems are located. {APP_NAME}{" "}} 
        does not provide legal advice and is not responsible for ensuring your compliance.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">8. Governing Law</h2>
      <p className="leading-relaxed text-foreground/90">
        This Disclaimer and your use of the Service shall be governed by and construed in accordance 
        with the laws of the State of Missouri, United States, without regard to its conflict of law 
        provisions. Any disputes arising under or in connection with this Disclaimer shall be subject 
        to the exclusive jurisdiction of the state and federal courts located in Missouri.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">9. Severability</h2>
      <p className="leading-relaxed text-foreground/90">
        If any provision of this Disclaimer is found to be unenforceable or invalid by a court of 
        competent jurisdiction, such provision shall be limited or eliminated to the minimum extent 
        necessary so that this Disclaimer shall otherwise remain in full force and effect and enforceable.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">10. Entire Agreement</h2>
      <p className="leading-relaxed text-foreground/90">
        This Disclaimer, together with the Terms of Service, Privacy Policy, and Acceptable Use Policy, 
        constitutes the entire agreement between you and {APP_NAME} regarding the use of the Service 
        and supersedes all prior agreements and understandings.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">11. Contact</h2>
      <p className="leading-relaxed text-foreground/90">
        For questions about this Disclaimer, please contact us at{" "}
        <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">
          {LEGAL_EMAIL}
        </a>.
      </p>
      <p className="leading-relaxed text-foreground/90 mt-3">
        {APP_NAME}{" "}} 
        is operated from Missouri, United States.
      </p>
    </article>
  )
}
