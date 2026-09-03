import Link from "next/link";
import { Card } from "@/components/ui/card";
import { APP_NAME } from "@/lib/config/constants";
import { PLANS } from "@/lib/billing/catalog";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  CodeBlock,
  DocsTable,
  EndpointCard,
  InlineCode,
} from "@/components/docs";

/**
 * The per-plan webhook cap, read off the catalog instead of typed out. It was
 * written by hand in three places on this page, which is three chances for it
 * to disagree with what the create endpoint enforces.
 */
function webhookCapLabel(limit: number): string {
  return limit === -1 ? "unlimited" : String(limit);
}

const WEBHOOK_CAPS = PLANS.map(
  (plan) => `${webhookCapLabel(plan.limits.webhooks)} on ${plan.name}`,
).join(", ");

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "supported-platforms", label: "Supported Platforms" },
  { id: "endpoints", label: "API Endpoints" },
  { id: "payloads", label: "Webhook Payloads" },
  { id: "security", label: "Security" },
  { id: "examples", label: "Integration Examples" },
];

export default function WebhooksPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Integrations"
        title="Webhooks"
        description={`Receive real-time notifications when scans complete. ${APP_NAME} auto-detects the platform type from the URL and formats the payload accordingly.`}
        stats={[
          { value: "1-∞", label: "Max per user, by plan" },
          { value: "3", label: "Platform types" },
          { value: "HTTPS", label: "Required" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Webhooks fire after every successful scan triggered by a session or an
          API key. Scans run as background jobs, so delivery happens when the
          job actually finishes, not when the original API call returned. Each
          delivery is signed (see Security below) and re-checks the destination
          URL against the SSRF rules again at delivery time, not just when you
          registered it. A delivery that fails (network error, timeout, or a
          non-2xx response) gets exactly one retry a few seconds later; if that
          also fails, the attempt is logged and, if you have the notification
          enabled, you get an email. The per-user cap is set by your plan, not a
          flat number:{" "}
          <strong className="text-foreground">{WEBHOOK_CAPS}</strong>. Free
          accounts do get a webhook: the step up you pay for is 1 to 5 at Pro
          Supporter.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A webhook can also be assigned to a team. A team-assigned webhook is
          visible to every co-member, editable by those with write access, and
          fires on a teammate&apos;s scans as well as its creator&apos;s.
        </p>
      </DocsSection>

      <DocsSection id="supported-platforms" title="Supported Platforms">
        <p className="text-sm text-muted-foreground">
          {APP_NAME} detects the platform by matching the URL pattern. Override
          with the <InlineCode>type</InlineCode> body field if needed.
        </p>

        {/* Three platforms with three parallel attributes each is a table,
          not three cards. As cards the reader had to scan across all three
          to line up the URL patterns, which is the exact comparison this
          section exists to answer. */}
        <DocsTable
          caption="Webhook platforms, the URL pattern each is detected by, and the payload shape it receives"
          columns={[
            { key: "platform", header: "Platform" },
            { key: "pattern", header: "URL pattern" },
            { key: "payload", header: "Payload shape" },
          ]}
          data={[
            {
              platform: "Discord",
              pattern:
                "discord.com/api/webhooks/* or discordapp.com/api/webhooks/*",
              payload: "Rich embeds with colour-coded severity",
            },
            {
              platform: "Slack",
              pattern: "hooks.slack.com/*",
              payload: "Block Kit with section fields",
            },
            {
              platform: "Generic",
              pattern: "Any other HTTPS endpoint",
              payload: "Plain JSON { event, data }",
            },
          ]}
        />
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Generic is the row most integrations end up on: anything that is not
          Discord or Slack gets the plain{" "}
          <InlineCode>{`{ event, data }`}</InlineCode> body, which is the one
          documented in{" "}
          <a
            href="#payloads"
            className="text-primary underline-offset-2 hover:underline"
          >
            Webhook Payloads
          </a>{" "}
          below.
        </p>
      </DocsSection>

      <DocsSection id="endpoints" title="API Endpoints">
        <p className="text-sm text-muted-foreground mb-6">
          Manage webhooks through these session-authenticated endpoints (the{" "}
          <InlineCode>/api/v3/webhooks</InlineCode> family requires a logged-in
          user; API keys are not accepted). Two more exist and are documented in
          full on the{" "}
          <Link
            href="/docs/api#post-webhooks-rotate-secret"
            className="text-primary underline-offset-2 hover:underline"
          >
            API reference
          </Link>
          : <InlineCode>POST /webhooks/{"{id}"}/rotate-secret</InlineCode>{" "}
          (issue a new signing secret in place, owner only) and{" "}
          <InlineCode>GET /webhooks/{"{id}"}/deliveries</InlineCode> (the 50
          most recent delivery attempts with their status).
        </p>

        <div className="space-y-6">
          <EndpointCard
            id="get-webhooks"
            method="GET"
            path="/webhooks"
            title="List Webhooks"
            description="Your own webhooks plus any assigned to a team you belong to. All team roles can read them."
            responseExample={`{
  "webhooks": [
    {
      "id": 1,
      "url": "https://discord.com/api/webhooks/xxx/yyy",
      "name": "Security Alerts",
      "type": "discord",
      "active": true,
      "created_at": "2026-03-10T15:30:00.000Z"
    }
  ]
}`}
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
  "created_at": "2026-03-10T15:30:00.000Z",
  "secret": "b6f2e1...9c4a"
}`}
            notes={[
              `Returns 201, not 200. Per-user limit is set by your plan: ${WEBHOOK_CAPS}`,
              "URL must be HTTPS (no localhost, no private IPs, no link-local)",
              "type defaults to auto-detect; allowed values are auto | discord | slack | generic. Only the detected value is stored.",
              "secret is returned on this response and, if you ever have to replace it, on POST /webhooks/{id}/rotate-secret. Nothing else returns it, so save it now: it signs every delivery.",
            ]}
            errors={[
              {
                code: 400,
                description: "Invalid URL, SSRF blocked, or plan limit reached",
              },
              { code: 401, description: "Unauthorized" },
              {
                code: 403,
                description: "Webhooks are disabled on this deployment",
              },
            ]}
          />

          <EndpointCard
            id="patch-webhooks"
            method="PATCH"
            path="/webhooks"
            title="Test Webhook"
            description="Sends a test payload to verify the webhook is reachable and accepts the format. A 200 means your endpoint answered with a 2xx; the response does not relay your endpoint's exact status code."
            requestBody={`{
  "id": 1
}`}
            responseExample={`{
  "success": true,
  "message": "Test webhook sent successfully"
}`}
            notes={[
              "The test delivery is NOT signed and carries no User-Agent: it goes out with Content-Type: application/json only. A consumer that rejects unsigned payloads will fail the Test button even though real deliveries would verify fine. Allow the test through, or verify against a real scan instead.",
            ]}
            errors={[
              {
                code: 400,
                description:
                  "Missing id, the target is now SSRF-blocked, or your endpoint returned a non-2xx status",
              },
              { code: 401, description: "Unauthorized" },
              {
                code: 403,
                description:
                  "You can read this webhook but have no write access to it",
              },
              { code: 404, description: "Webhook not found, or no access" },
            ]}
          />

          <EndpointCard
            id="patch-webhooks-id"
            method="PATCH"
            path="/webhooks/{id}"
            title="Edit or Pause Webhook"
            description="Update a webhook in place: pause/resume delivery, or change its name, URL, and type. Only fields you send are changed."
            requestBody={`{
  "active": false
}`}
            responseExample={`{
  "id": 1,
  "url": "https://discord.com/api/webhooks/xxx/yyy",
  "name": "Security Alerts",
  "type": "discord",
  "active": false,
  "created_at": "2026-03-10T15:30:00.000Z"
}`}
            notes={[
              "Send { active: true|false } alone to pause or resume without touching the URL",
              "url, name, type and teamId are all optional and independent -- send only what changed",
              "A new url goes through the same HTTPS + SSRF checks as creation",
              "The owner, or a team co-member with write access, may edit. A read-only co-member gets 403 because they legitimately know it exists; anyone with no access at all gets 404. Changing teamId is owner-only.",
            ]}
            errors={[
              {
                code: 400,
                description: "Nothing to update, or the new URL was rejected",
              },
              { code: 401, description: "Unauthorized" },
              {
                code: 403,
                description:
                  "Read access but not write access, or not the owner when changing teamId",
              },
              { code: 404, description: "Webhook not found, or no access" },
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
            notes={[
              "An id that does not exist returns { success: true } with a 200, not a 404: there is nothing to delete and nothing to reveal about whose id it might be.",
            ]}
            errors={[
              { code: 401, description: "Unauthorized" },
              {
                code: 403,
                description: "No write access to this webhook",
              },
            ]}
          />
        </div>
      </DocsSection>

      <DocsSection id="payloads" title="Webhook Payloads">
        <p className="text-sm text-muted-foreground">
          Each platform receives a tailored payload. The{" "}
          <InlineCode>summary</InlineCode> object is the same in all three:
          critical, high, medium, low, info, total.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Discord</h3>
          <CodeBlock
            code={`{
  "embeds": [
    {
      "title": "${APP_NAME} Scan Complete",
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
      "footer": { "text": "${APP_NAME} Security Scanner" },
      "timestamp": "2026-03-10T15:30:00.000Z"
    }
  ]
}`}
            language="json"
          />
          <p className="text-xs text-muted-foreground mt-3">
            Embed color follows the scan&rsquo;s safety verdict, the same
            safe/caution/unsafe tier the badge and the host page use, not a raw
            severity count: <InlineCode>0x22c55e</InlineCode> (green, safe),{" "}
            <InlineCode>0xeab308</InlineCode> (yellow, caution),{" "}
            <InlineCode>0xef4444</InlineCode> (red, unsafe). A count-based rule
            cannot tell an exploitable high from a hardening one like a missing
            HSTS header, so it used to paint scans red that the scorer calls
            safe.
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Slack</h3>
          <CodeBlock
            code={`{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "${APP_NAME} Scan Complete"
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
        { "type": "mrkdwn", "text": "Sent by ${APP_NAME} Security Scanner" }
      ]
    }
  ]
}`}
            language="json"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Generic</h3>
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
            Delivered with{" "}
            <InlineCode>Content-Type: application/json</InlineCode>,{" "}
            <InlineCode>{`User-Agent: ${APP_NAME}-Webhook/1.0`}</InlineCode>,
            and (if the webhook has a secret) an{" "}
            <InlineCode>X-VulnRadar-Signature</InlineCode> header -- see
            Security below.
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="security" title="Security">
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">HTTPS only:</strong> the create
            endpoint rejects <InlineCode>http://</InlineCode> URLs.
          </li>
          <li>
            <strong className="text-foreground">SSRF protection:</strong>{" "}
            webhooks cannot target localhost,
            <InlineCode>127.0.0.1</InlineCode>, <InlineCode>0.0.0.0</InlineCode>
            , <InlineCode>[::1]</InlineCode>,
            <InlineCode>169.254.169.254</InlineCode> (AWS metadata),{" "}
            <InlineCode>metadata.google.internal</InlineCode>,{" "}
            <InlineCode>*.local</InlineCode>, private IP ranges (10/8,
            172.16/12, 192.168/16), or any hostname that resolves to them. This
            is checked again before every delivery attempt, not just at
            registration or edit time, in case DNS or routing changed in
            between.
          </li>
          <li>
            <strong className="text-foreground">Signed payloads:</strong> each
            webhook gets a secret at creation time, returned once in the create
            response and never shown again. Every delivery includes{" "}
            <InlineCode>{`X-VulnRadar-Signature: sha256=<hex>`}</InlineCode>, an
            HMAC-SHA256 of the exact request body using that secret -- compute
            the same HMAC on your end and compare to verify a payload actually
            came from {APP_NAME}. The one exception is the Test button, whose
            delivery is unsigned and carries no{" "}
            <InlineCode>User-Agent</InlineCode>. Lost or leaked the secret? Call{" "}
            <InlineCode>
              POST /api/v3/webhooks/{"{id}"}/rotate-secret
            </InlineCode>{" "}
            (owner only) for a new one on the same row: the id and the URL
            survive, so your consumer&rsquo;s configuration does not have to
            change. Every signature it is currently verifying stops matching the
            moment that returns, so deploy the new secret first.
          </li>
          <li>
            <strong className="text-foreground">Timeout:</strong> 10 seconds per
            delivery attempt (
            <InlineCode>AbortSignal.timeout(10000)</InlineCode>).
          </li>
          <li>
            <strong className="text-foreground">One retry, then logged:</strong>{" "}
            a network error, an SSRF block, or a non-2xx response gets exactly
            one retry a few seconds later. Every attempt (including the retry)
            is recorded with its status. If both attempts fail and you have the
            notification enabled, you get an email -- this is still best-effort
            delivery, not a guaranteed queue, so build idempotency into your
            consumer regardless.
          </li>
          <li>
            <strong className="text-foreground">Per-user cap, by plan:</strong>{" "}
            {WEBHOOK_CAPS}. Delete or upgrade to add more.
          </li>
          <li>
            <strong className="text-foreground">Session-only API:</strong>{" "}
            Bearer keys cannot manage webhooks: only logged-in users can create,
            list, edit, pause, test, and delete them. Every write is scoped to
            webhooks the caller owns or has team write access to; rotating the
            secret and reassigning the team are owner-only.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="examples" title="Integration Examples">
        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Creating a Discord webhook
          </h3>
          <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              In Discord: Server Settings → Integrations → Webhooks → New
              Webhook. Copy the URL.
            </li>
            <li>
              Log in to {APP_NAME}, open <InlineCode>/profile</InlineCode> →
              Webhooks → Add Webhook.
            </li>
            <li>Paste the URL and an optional label. Type is auto-detected.</li>
            <li>
              Click <strong className="text-foreground">Test</strong>. A test
              payload posts to Discord; you should see a colored embed within a
              few seconds.
            </li>
          </ol>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Local development: receive on <InlineCode>webhook.site</InlineCode>
          </h3>
          <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              Open <InlineCode>https://webhook.site</InlineCode> and copy the
              URL.
            </li>
            <li>
              Paste it as a webhook in {APP_NAME}. It is detected as{" "}
              <InlineCode>generic</InlineCode>.
            </li>
            <li>
              Run any scan. The full JSON payload appears at the top of your
              <InlineCode>webhook.site</InlineCode> page.
            </li>
          </ol>
        </Card>
      </DocsSection>
    </div>
  );
}
