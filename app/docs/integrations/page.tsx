import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { DocsSection, DocsHero, DocsCallout, CodeBlock, EndpointCard } from "@/components/docs"
import { Shield, Webhook, GitBranch, Zap } from "lucide-react"

export const metadata = {
  title: "Integrations | VulnRadar Docs",
  description: "Integrate VulnRadar with your favorite tools and platforms",
}

export default function IntegrationsPage() {
  return (
    <div className="space-y-12">
      <DocsHero
        title="Integrations"
        description="Connect VulnRadar with your favorite tools, platforms, and services to streamline your security workflow."
      />

      <DocsSection
        id="overview"
        title="Integration Overview"
        description="VulnRadar provides multiple ways to integrate with your existing infrastructure."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <Card className="p-6 border-border/50 bg-card/50">
            <div className="flex items-start gap-3">
              <Webhook className="h-5 w-5 text-primary mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-medium text-foreground mb-1">Webhooks</h3>
                <p className="text-sm text-muted-foreground">Receive real-time notifications when scans complete or issues are found</p>
              </div>
            </div>
          </Card>
          <Card className="p-6 border-border/50 bg-card/50">
            <div className="flex items-start gap-3">
              <Zap className="h-5 w-5 text-primary mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-medium text-foreground mb-1">API</h3>
                <p className="text-sm text-muted-foreground">Direct API access for custom integrations and automation</p>
              </div>
            </div>
          </Card>
          <Card className="p-6 border-border/50 bg-card/50">
            <div className="flex items-start gap-3">
              <GitBranch className="h-5 w-5 text-primary mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-medium text-foreground mb-1">CI/CD</h3>
                <p className="text-sm text-muted-foreground">Integrate scanning into your continuous integration pipeline</p>
              </div>
            </div>
          </Card>
          <Card className="p-6 border-border/50 bg-card/50">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-primary mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-medium text-foreground mb-1">Team Collaboration</h3>
                <p className="text-sm text-muted-foreground">Share scans and manage access across your organization</p>
              </div>
            </div>
          </Card>
        </div>
      </DocsSection>

      <DocsSection
        id="webhooks"
        title="Webhook Integrations"
        description="Set up webhooks to receive real-time notifications about scan events."
      >
        <DocsCallout type="info">
          Webhooks require a Team plan or higher. See the <a href="/pricing" className="text-primary hover:underline">pricing page</a> for details.
        </DocsCallout>

        <div className="mt-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Supported Events</h3>
          <div className="space-y-2">
            {[
              { event: "scan.completed", description: "Triggered when a scan completes" },
              { event: "scan.failed", description: "Triggered when a scan fails" },
              { event: "finding.created", description: "Triggered when a new finding is discovered" },
              { event: "finding.resolved", description: "Triggered when a finding is resolved" },
            ].map((item) => (
              <div key={item.event} className="flex justify-between items-start p-3 rounded-lg bg-muted/30 border border-border/30">
                <div>
                  <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded">{item.event}</code>
                  <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-sm font-semibold text-foreground mb-4">Webhook Payload</h3>
          <DocsCodeBlock
            language="json"
            code={`{
  "event": "scan.completed",
  "timestamp": "2024-03-30T10:30:00Z",
  "data": {
    "scanId": "scan_abc123",
    "url": "https://example.com",
    "status": "completed",
    "findingsCount": 5,
    "criticalCount": 1,
    "highCount": 2
  }
}`}
          />
        </div>

        <div className="mt-8">
          <h3 className="text-sm font-semibold text-foreground mb-4">Webhook Verification</h3>
          <p className="text-sm text-muted-foreground mb-4">
            All webhook requests include an <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">X-VulnRadar-Signature</code> header for verification.
          </p>
          <DocsCodeBlock
            language="python"
            code={`import hmac
import hashlib

def verify_webhook(payload: bytes, signature: str, secret: str) -> bool:
    expected_signature = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected_signature)`}
          />
        </div>
      </DocsSection>

      <DocsSection
        id="ci-cd"
        title="CI/CD Integration"
        description="Integrate VulnRadar scanning into your CI/CD pipeline."
      >
        <div className="space-y-6 mt-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Badge>GitHub Actions</Badge>
            </h3>
            <CodeBlock
              language="yaml"
              code={"name: Security Scan\non: [push, pull_request]\n\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3\n      - name: Run VulnRadar Scan\n        run: |\n          curl -X POST https://api.vulnradar.dev/v2/scan/crawl \\\n            -H \"Authorization: Bearer ${{ secrets.VULNRADAR_API_KEY }}\" \\\n            -H \"Content-Type: application/json\" \\\n            -d '{\"url\": \"https://example.com\"}'"}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Badge>GitLab CI</Badge>
            </h3>
            <CodeBlock
              language="yaml"
              code={"scan_security:\n  stage: test\n  script:\n    - |\n      curl -X POST https://api.vulnradar.dev/v2/scan/crawl \\\n        -H \"Authorization: Bearer $CI_JOB_TOKEN\" \\\n        -H \"Content-Type: application/json\" \\\n        -d '{\"url\": \"$CI_PROJECT_URL\"}'\n  only:\n    - merge_requests"}
            />
          </div>
        </div>
      </DocsSection>

      <DocsSection
        id="api-automation"
        title="API Automation"
        description="Use the VulnRadar API to build custom automations and integrations."
      >
        <DocsCallout type="info">
          See the <a href="/docs/api" className="text-primary hover:underline">API Documentation</a> for complete endpoint reference.
        </DocsCallout>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Example: Automated Daily Scan</h3>
          <DocsCodeBlock
            language="python"
            code={`import requests
from datetime import datetime

API_BASE = "https://api.vulnradar.dev/v2"
API_KEY = "your_api_key"

def scan_url(url: str) -> dict:
    response = requests.post(
        f"{API_BASE}/scan/crawl",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={"url": url}
    )
    return response.json()

def get_scan_results(scan_id: str) -> dict:
    response = requests.get(
        f"{API_BASE}/scan/{scan_id}",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    return response.json()

# Run daily scan
urls = ["https://example.com", "https://api.example.com"]
for url in urls:
    result = scan_url(url)
    print(f"Scanning {url}: {result['id']}")`}
          />
        </div>
      </DocsSection>

      <DocsSection
        id="best-practices"
        title="Integration Best Practices"
        description="Follow these best practices when integrating VulnRadar."
      >
        <div className="space-y-4 mt-6">
          <Card className="p-4 border-border/50 bg-card/50">
            <h4 className="font-medium text-sm text-foreground mb-2">1. Use Environment Variables</h4>
            <p className="text-xs text-muted-foreground">Never hardcode API keys in your code. Use environment variables or secure vaults.</p>
          </Card>
          <Card className="p-4 border-border/50 bg-card/50">
            <h4 className="font-medium text-sm text-foreground mb-2">2. Implement Retry Logic</h4>
            <p className="text-xs text-muted-foreground">Add exponential backoff to handle rate limits and transient failures gracefully.</p>
          </Card>
          <Card className="p-4 border-border/50 bg-card/50">
            <h4 className="font-medium text-sm text-foreground mb-2">3. Monitor Webhooks</h4>
            <p className="text-xs text-muted-foreground">Track webhook delivery status and set up alerts for failed deliveries.</p>
          </Card>
          <Card className="p-4 border-border/50 bg-card/50">
            <h4 className="font-medium text-sm text-foreground mb-2">4. Verify Signatures</h4>
            <p className="text-xs text-muted-foreground">Always verify webhook signatures to ensure requests are legitimate.</p>
          </Card>
        </div>
      </DocsSection>
    </div>
  )
}
