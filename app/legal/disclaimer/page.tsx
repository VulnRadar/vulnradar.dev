import { TOTAL_CHECKS_LABEL } from "@/lib/constants"

export default function DisclaimerPage() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold text-foreground">Disclaimer</h1>
      <p className="text-sm text-muted-foreground">Last updated: February 8, 2026</p>

      <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-6 my-6">
        <h2 className="text-lg font-bold text-destructive mt-0">Important Notice</h2>
        <p className="leading-relaxed text-foreground/90 mb-0">
          VulnRadar is provided strictly for <strong>authorized security testing, research, and
          educational purposes</strong>. The operators of VulnRadar are <strong>NOT responsible</strong> for
          any misuse, damages, legal consequences, or any other outcome resulting from the use
          of this tool. You use VulnRadar entirely at your own risk.
        </p>
      </div>

      <h2 className="text-lg font-semibold text-foreground mt-8">1. No Warranty</h2>
      <p className="leading-relaxed text-foreground/90">
        THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
        INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, AND NONINFRINGEMENT. We make no warranty that:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Scan results are complete, accurate, or free from errors.</li>
        <li>The Service will identify all vulnerabilities present on a target.</li>
        <li>The Service will be uninterrupted, timely, or error-free.</li>
        <li>Remediation guidance will resolve all security issues.</li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8">2. Not Professional Security Advice</h2>
      <p className="leading-relaxed text-foreground/90">
        VulnRadar scan results and remediation guidance do <strong>NOT</strong> constitute
        professional security advice, a security audit, or a penetration test. The results
        should be used as a starting point for further investigation. For comprehensive
        security assessments, consult a qualified cybersecurity professional.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">3. Accuracy of Results</h2>
      <p className="leading-relaxed text-foreground/90">
        VulnRadar performs {TOTAL_CHECKS_LABEL} automated vulnerability checks based on publicly observable
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
        IN NO EVENT SHALL VULNRADAR, ITS OPERATORS, CONTRIBUTORS, OR AFFILIATES BE LIABLE
        FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES
        (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF
        USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
        LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
        OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SERVICE, EVEN IF ADVISED OF THE
        POSSIBILITY OF SUCH DAMAGE.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">6. Legal Compliance</h2>
      <p className="leading-relaxed text-foreground/90">
        Unauthorized computer scanning may violate criminal and civil laws including:
      </p>
      <ul className="flex flex-col gap-2 text-foreground/90">
        <li>Computer Fraud and Abuse Act (CFAA): United States</li>
        <li>Computer Misuse Act 1990: United Kingdom</li>
        <li>Strafgesetzbuch (StGB) Section 202c: Germany</li>
        <li>Equivalent cybercrime legislation in other jurisdictions</li>
      </ul>
      <p className="leading-relaxed text-foreground/90">
        It is your responsibility to understand and comply with the laws applicable in your
        jurisdiction. VulnRadar does not provide legal advice and is not responsible for
        ensuring your compliance.
      </p>

      <h2 className="text-lg font-semibold text-foreground mt-8">7. Contact</h2>
      <p className="leading-relaxed text-foreground/90">
        For questions about this Disclaimer, please contact us at{" "}
        <a href="mailto:legal@vulnradar.dev" className="text-primary hover:underline">
          legal@vulnradar.dev
        </a>.
      </p>
    </article>
  )
}
