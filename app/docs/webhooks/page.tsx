"use client"

import { useEffect, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Webhook, Bell, Zap, Shield } from "lucide-react"
import { APP_NAME, APP_URL } from "@/lib/config/constants"
import { useDocsContext, type TocItem } from "../layout"
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  CodeBlock,
  EndpointCard,
} from "@/components/docs"

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "supported-platforms", label: "Supported Platforms" },
  { id: "endpoints", label: "API Endpoints" },
  { id: "payloads", label: "Webhook Payloads" },
  { id: "security", label: "Security" },
  { id: "examples", label: "Integration Examples" },
]

export default function WebhooksPage() {
  const { setActiveSection, setTocItems } = useDocsContext()
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    setTocItems(tocItems)
    return () => setTocItems([])
  }, [setTocItems])

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        })
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    )

    tocItems.forEach((item) => {
      const el = document.getElementById(item.id)
      if (el) observerRef.current?.observe(el)
    })

    return () => observerRef.current?.disconnect()
  }, [setActiveSection])

  return (
    <div className="space-y-16">
      {/* Hero */}
      <DocsHero
        badge="Integrations"
        title="Webhooks"
        description={`Configure webhooks to receive real-time notifications when scans complete. ${APP_NAME} supports Discord, Slack, and custom webhook endpoints.`}
        stats={[
          { value: "5", label: "Max Webhooks" },
          { value: "3", label: "Platform Types" },
          { value: "HTTPS", label: "Required" },
        ]}
      />

      {/* Supported Platforms */}
      <DocsSection id="supported-platforms" title="Supported Platforms" icon={Bell}>
        <p className="text-muted-foreground">
          {APP_NAME} auto-detects webhook types based on URL patterns and formats payloads accordingly.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              name: "Discord",
              pattern: "discord.com/api/webhooks/*",
              description: "Rich embeds with color-coded severity indicators",
              color: "bg-indigo-600/20 text-indigo-600",
            },
            {
              name: "Slack",
              pattern: "hooks.slack.com/*",
              description: "Block Kit formatted messages with structured fields",
              color: "bg-green-600/20 text-green-600",
            },
            {
              name: "Generic",
              pattern: "Any HTTPS endpoint",
              description: "Standard JSON payload for custom integrations",
              color: "bg-gray-600/20 text-gray-400",
            },
          ].map((platform) => (
            <Card key={platform.name} className="p-4 border-border/40">
              <div className="flex items-center gap-3 mb-3">
                <Badge className={`${platform.color} border-0`}>{platform.name}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-2">{platform.description}</p>
              <code className="text-xs bg-secondary px-2 py-1 rounded block truncate">
                {platform.pattern}
              </code>
            </Card>
          ))}
        </div>
      </DocsSection>

      {/* API Endpoints */}
      <DocsSection id="endpoints" title="API Endpoints" icon={Zap}>
        <p className="text-muted-foreground mb-6">
          Manage webhooks programmatically through the REST API.
        </p>

        <div className="space-y-6">
          <EndpointCard
            id="get-webhooks"
            method="GET"
            path="/webhooks"
            title="List Webhooks"
            description="Retrieve all webhooks configured for the authenticated user."
            responseExample={`[
  {
    "id": 1,
    "url": "https://discord.com/api/webhooks/xxx/yyy",
    "name": "Security Alerts",
    "type": "discord",
    "active": true,
    "created_at": "2026-03-10T15:30:00.000Z"
  }
]`}
            errors={[{ code: 401, description: "Unauthorized" }]}
          />

          <EndpointCard
            id="post-webhooks"
            method="POST"
            path="/webhooks"
            title="Create Webhook"
            description="Create a new webhook. URL must be a public HTTPS endpoint. Type is auto-detected from URL if not specified."
            requestBody={`{
  "url": "https://discord.com/api/webhooks/xxx/yyy",  // Required
  "name": "Security Alerts",                          // Optional
  "type": "auto"                                      // Optional: auto, discord, slack, generic
}`}
            responseExample={`{
  "id": 1,
  "url": "https://discord.com/api/webhooks/xxx/yyy",
  "name": "Security Alerts",
  "type": "discord",
  "active": true,
  "created_at": "2026-03-10T15:30:00.000Z"
}`}
            notes={[
              "Maximum 5 webhooks per user",
              "URL must be HTTPS (no localhost or private IPs)",
              "Type auto-detection: Discord, Slack, or generic",
            ]}
            errors={[
              { code: 400, description: "Invalid URL or maximum webhooks reached" },
              { code: 401, description: "Unauthorized" },
            ]}
          />

          <EndpointCard
            id="patch-webhooks"
            method="PATCH"
            path="/webhooks"
            title="Test Webhook"
            description="Send a test payload to verify webhook connectivity. Returns success status and any error messages."
            requestBody={`{
  "id": 1  // Webhook ID to test
}`}
            responseExample={`{
  "success": true,
  "message": "Test webhook sent successfully"
}`}
            errors={[
              { code: 400, description: "Webhook returned an error" },
              { code: 404, description: "Webhook not found" },
            ]}
          />

          <EndpointCard
            id="delete-webhooks"
            method="DELETE"
            path="/webhooks"
            title="Delete Webhook"
            description="Delete a webhook by ID."
            requestBody={`{
  "id": 1  // Webhook ID to delete
}`}
            responseExample={`{
  "success": true
}`}
            errors={[{ code: 401, description: "Unauthorized" }]}
          />
        </div>
      </DocsSection>

      {/* Webhook Payloads */}
      <DocsSection id="payloads" title="Webhook Payloads" icon={Webhook}>
        <p className="text-muted-foreground">
          Payload format depends on the webhook type. Here are examples for each platform:
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Discord Payload</h3>
          <CodeBlock code={`{
  "content": null,
  "embeds": [{
    "title": "Scan Complete: example.com",
    "description": "Found 5 vulnerabilities",
    "color": 16744448,  // Orange for warnings
    "fields": [
      { "name": "Critical", "value": "0", "inline": true },
      { "name": "High", "value": "1", "inline": true },
      { "name": "Medium", "value": "2", "inline": true },
      { "name": "Low", "value": "2", "inline": true }
    ],
    "footer": { "text": "VulnRadar Security Scanner" },
    "timestamp": "2026-03-10T15:30:00.000Z"
  }]
}`} />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Slack Payload</h3>
          <CodeBlock code={`{
  "text": "Scan Complete: example.com",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Scan Complete: example.com" }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "Found *5 vulnerabilities*" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Critical:* 0" },
        { "type": "mrkdwn", "text": "*High:* 1" },
        { "type": "mrkdwn", "text": "*Medium:* 2" },
        { "type": "mrkdwn", "text": "*Low:* 2" }
      ]
    }
  ]
}`} />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Generic Payload</h3>
          <CodeBlock code={`{
  "event": "scan.complete",
  "scan_id": 12345,
  "url": "https://example.com",
  "summary": {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 2,
    "info": 0,
    "total": 5
  },
  "findings": [
    {
      "type": "hsts-missing",
      "title": "HSTS Header Missing",
      "severity": "medium"
    }
  ],
  "timestamp": "2026-03-10T15:30:00.000Z",
  "view_url": "${APP_URL}/history/12345"
}`} />
        </Card>
      </DocsSection>

      {/* Security */}
      <DocsSection id="security" title="Security" icon={Shield}>
        <Card className="p-6 border-border/40">
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold mb-3">URL Validation</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Webhook URLs are validated to prevent SSRF attacks. The following are blocked:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>localhost, 127.0.0.1, ::1</li>
                <li>Private IP ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x)</li>
                <li>Cloud metadata endpoints (169.254.169.254)</li>
                <li>Non-HTTPS URLs</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-3">Webhook Limits</h3>
              <p className="text-sm text-muted-foreground">
                Each user is limited to 5 active webhooks. This prevents abuse and ensures reliable delivery.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-3">Retry Policy</h3>
              <p className="text-sm text-muted-foreground">
                Webhook delivery is attempted once. If your endpoint returns a non-2xx status, the delivery is marked as failed. We recommend implementing your own retry logic or using a webhook relay service for critical integrations.
              </p>
            </div>
          </div>
        </Card>

        <DocsCallout variant="warning" title="Keep Your Webhook URLs Secret">
          <p>
            Webhook URLs often contain authentication tokens. Treat them as secrets and don&apos;t expose them in client-side code or public repositories.
          </p>
        </DocsCallout>
      </DocsSection>

      {/* Examples */}
      <DocsSection id="examples" title="Integration Examples">
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Creating a Discord Webhook</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground mb-4">
            <li>Open Discord and go to your server settings</li>
            <li>Navigate to Integrations → Webhooks</li>
            <li>Click &quot;New Webhook&quot; and configure the name and channel</li>
            <li>Copy the webhook URL</li>
            <li>Add it in {APP_NAME} settings → Webhooks</li>
          </ol>
          <CodeBlock code={`curl -X POST "${APP_URL}/api/v2/webhooks" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://discord.com/api/webhooks/xxx/yyy",
    "name": "Security Alerts"
  }'`} language="bash" />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Testing Your Webhook</h3>
          <CodeBlock code={`curl -X PATCH "${APP_URL}/api/v2/webhooks" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"id": 1}'`} language="bash" />
          <p className="text-xs text-muted-foreground mt-2">
            This sends a test payload to verify connectivity before running actual scans.
          </p>
        </Card>
      </DocsSection>
    </div>
  )
}
