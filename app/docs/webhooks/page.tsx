"use client";

import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, Zap, Shield } from "lucide-react";
import { APP_NAME } from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  CodeBlock,
  EndpointCard,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "supported-platforms", label: "Supported Platforms" },
  { id: "endpoints", label: "API Endpoints" },
  { id: "payloads", label: "Webhook Payloads" },
  { id: "security", label: "Security" },
  { id: "examples", label: "Integration Examples" },
];

export default function WebhooksPage() {
  const { setActiveSection, setTocItems } = useDocsContext();
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setTocItems(tocItems);
    return () => setTocItems([]);
  }, [setTocItems]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observerRef.current?.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, [setActiveSection]);

  return (
    <div className="space-y-16">
      <DocsHero
        badge="Integrations"
        title="Webhooks"
        description={`Receive real-time notifications when scans complete. ${APP_NAME} auto-detects the platform type from the URL and formats the payload accordingly.`}
        stats={[
          { value: "5", label: "Max per user" },
          { value: "3", label: "Platform types" },
          { value: "HTTPS", label: "Required" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p>
          Webhooks fire after every successful scan triggered by a session or an
          API key. Delivery is best-effort: one POST per webhook with a
          10-second timeout. Failures are logged but not retried. The server
          enforces a per-user cap of <strong>5</strong> webhooks.
        </p>
      </DocsSection>

      <DocsSection
        id="supported-platforms"
        title="Supported Platforms"
        icon={Bell}
      >
        <p className="text-muted-foreground">
          {APP_NAME} detects the platform by matching the URL pattern. Override
          with the <code>type</code> body field if needed.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              name: "Discord",
              pattern:
                "discord.com/api/webhooks/* or discordapp.com/api/webhooks/*",
              description: "Rich embeds with color-coded severity",
              color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
            },
            {
              name: "Slack",
              pattern: "hooks.slack.com/*",
              description: "Block Kit with section fields",
              color: "bg-green-500/10 text-green-500 border-green-500/20",
            },
            {
              name: "Generic",
              pattern: "Any other HTTPS endpoint",
              description: "Plain JSON { event, data }",
              color: "bg-muted text-muted-foreground border-border/50",
            },
          ].map((platform) => (
            <Card
              key={platform.name}
              className="p-4 border-border/50 bg-card/50"
            >
              <div className="flex items-center gap-3 mb-3">
                <Badge variant="outline" className={platform.color}>
                  {platform.name}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                {platform.description}
              </p>
              <code className="text-xs bg-secondary px-2 py-1 rounded block truncate">
                {platform.pattern}
              </code>
            </Card>
          ))}
        </div>
      </DocsSection>

      <DocsSection id="endpoints" title="API Endpoints" icon={Zap}>
        <p className="text-muted-foreground mb-6">
          Manage webhooks through these session-authenticated endpoints (the{" "}
          <code>/api/v3/webhooks</code> family requires a logged-in user; API
          keys are not accepted).
        </p>

        <div className="space-y-6">
          <EndpointCard
            id="get-webhooks"
            method="GET"
            path="/webhooks"
            title="List Webhooks"
            description="Retrieve all webhooks for the authenticated user."
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
            description="Create a new webhook. URL must be a public HTTPS endpoint. Type is auto-detected if not specified."
            requestBody={`{
  "url": "https://discord.com/api/webhooks/xxx/yyy",
  "name": "Security Alerts",
  "type": "auto"
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
              "URL must be HTTPS (no localhost, no private IPs, no link-local)",
              "type defaults to auto-detect; allowed values are auto | discord | slack | generic. Only the detected value is stored.",
            ]}
            errors={[
              {
                code: 400,
                description: "Invalid URL, SSRF blocked, or maximum reached",
              },
              { code: 401, description: "Unauthorized" },
            ]}
          />

          <EndpointCard
            id="patch-webhooks"
            method="PATCH"
            path="/webhooks"
            title="Test Webhook"
            description="Sends a test payload to verify the webhook is reachable and accepts the format. Returns the response status from your endpoint."
            requestBody={`{
  "id": 1
}`}
            responseExample={`{
  "success": true,
  "status": 204
}`}
            errors={[
              {
                code: 400,
                description: "Your endpoint returned a non-2xx status",
              },
              { code: 404, description: "Webhook not found" },
            ]}
          />

          <EndpointCard
            id="delete-webhooks"
            method="DELETE"
            path="/webhooks"
            title="Delete Webhook"
            description="Permanently delete a webhook."
            requestBody={`{
  "id": 1
}`}
            responseExample={`{
  "success": true
}`}
            errors={[
              { code: 401, description: "Unauthorized" },
              { code: 404, description: "Webhook not found" },
            ]}
          />
        </div>
      </DocsSection>

      <DocsSection id="payloads" title="Webhook Payloads">
        <p className="text-muted-foreground">
          Each platform receives a tailored payload. The <code>summary</code>{" "}
          object is the same in all three: critical, high, medium, low, info,
          total.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Discord</h3>
          <CodeBlock
            code={`{
  "embeds": [
    {
      "title": "VulnRadar Scan Complete",
      "description": "Scan finished for **https://example.com**",
      "color": 15158332,
      "fields": [
        { "name": "Critical", "value": "1", "inline": true },
        { "name": "High", "value": "2", "inline": true },
        { "name": "Medium", "value": "1", "inline": true },
        { "name": "Low", "value": "1", "inline": true },
        { "name": "Info", "value": "0", "inline": true },
        { "name": "Total Issues", "value": "5", "inline": true },
        { "name": "Duration", "value": "1.4s", "inline": true }
      ],
      "footer": { "text": "VulnRadar Security Scanner" },
      "timestamp": "2026-03-10T15:30:00.000Z"
    }
  ]
}`}
            language="json"
          />
          <p className="text-xs text-muted-foreground mt-3">
            Embed color: <code>0xef4444</code> (red, any critical),{" "}
            <code>0xf97316</code> (orange, any high), <code>0xeab308</code>{" "}
            (yellow, any medium), <code>0x22c55e</code> (green, otherwise).
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Slack</h3>
          <CodeBlock
            code={`{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "VulnRadar Scan Complete"
      }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*URL:* https://example.com" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Critical:* 1" },
        { "type": "mrkdwn", "text": "*High:* 2" },
        { "type": "mrkdwn", "text": "*Medium:* 1" },
        { "type": "mrkdwn", "text": "*Low:* 1" },
        { "type": "mrkdwn", "text": "*Total:* 5" },
        { "type": "mrkdwn", "text": "*Duration:* 1.4s" }
      ]
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Sent by VulnRadar Security Scanner" }
      ]
    }
  ]
}`}
            language="json"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Generic</h3>
          <CodeBlock
            code={`{
  "event": "scan.completed",
  "data": {
    "url": "https://example.com",
    "summary": {
      "critical": 1, "high": 2, "medium": 1, "low": 1, "info": 0, "total": 5
    },
    "findings_count": 5,
    "duration": 1423,
    "scanned_at": "2026-03-10T15:30:00.000Z"
  }
}`}
            language="json"
          />
          <p className="text-xs text-muted-foreground mt-3">
            Delivered with <code>Content-Type: application/json</code> and{" "}
            <code>User-Agent: VulnRadar-Webhook/1.0</code>.
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="security" title="Security" icon={Shield}>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong>HTTPS only:</strong> the create endpoint rejects{" "}
            <code>http://</code> URLs.
          </li>
          <li>
            <strong>SSRF protection:</strong> webhooks cannot target localhost,
            <code>127.0.0.1</code>, <code>0.0.0.0</code>, <code>[::1]</code>,
            <code>169.254.169.254</code> (AWS metadata),{" "}
            <code>metadata.google.internal</code>, <code>*.local</code>, private
            IP ranges (10/8, 172.16/12, 192.168/16), or any hostname that
            resolves to them.
          </li>
          <li>
            <strong>Timeout:</strong> 10 seconds per delivery (
            <code>AbortSignal.timeout(10000)</code>).
          </li>
          <li>
            <strong>No retries:</strong> failures are logged to stderr with the
            webhook URL, type, and error message. Build idempotency into your
            consumer.
          </li>
          <li>
            <strong>Per-user cap:</strong> 5 webhooks per user (
            <code>webhooks/route.ts:86</code>). Delete one before creating
            another.
          </li>
          <li>
            <strong>Session-only API:</strong> Bearer keys cannot manage
            webhooks — only logged-in users can create, list, test, and delete
            them.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="examples" title="Integration Examples">
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Creating a Discord webhook</h3>
          <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              In Discord: Server Settings → Integrations → Webhooks → New
              Webhook. Copy the URL.
            </li>
            <li>
              Log in to {APP_NAME}, open <code>/profile</code> → Webhooks → Add
              Webhook.
            </li>
            <li>Paste the URL and an optional label. Type is auto-detected.</li>
            <li>
              Click <strong>Test</strong>. A test payload posts to Discord; you
              should see a colored embed within a few seconds.
            </li>
          </ol>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">
            Local development: receive on <code>webhook.site</code>
          </h3>
          <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              Open <code>https://webhook.site</code> and copy the URL.
            </li>
            <li>
              Paste it as a webhook in {APP_NAME}. It is detected as{" "}
              <code>generic</code>.
            </li>
            <li>
              Run any scan. The full JSON payload appears at the top of your
              <code>webhook.site</code> page.
            </li>
          </ol>
        </Card>
      </DocsSection>
    </div>
  );
}
