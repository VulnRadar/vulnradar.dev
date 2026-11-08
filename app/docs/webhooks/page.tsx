import Link from "next/link";
import { Card } from "@/components/ui/card";
import { APP_NAME, ROUTES } from "@/lib/config/constants";
import { PLANS } from "@/lib/billing/catalog";
import {
  DELIVERY_TIMEOUT_MS,
  RETRY_DELAY_MS,
  TEST_SEND_TARGET_LIMIT,
  TEST_SEND_USER_LIMIT,
} from "@/lib/webhooks/delivery-contract";
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

const DELIVERY_DEADLINE_SECONDS = DELIVERY_TIMEOUT_MS / 1000;
const RETRY_DELAY_SECONDS = RETRY_DELAY_MS / 1000;

/** Where a webhook is added, spelled the way the app labels each step. */
const ADD_WEBHOOK_PATH = "Profile > Developer > Webhooks > Add";

const NODE_VERIFY = `import crypto from "node:crypto";
import express from "express";

const app = express();
// The whole string you were shown, used as it is. Do not hex-decode it.
const secret = process.env.VULNRADAR_WEBHOOK_SECRET;

// express.raw, not express.json: the signature covers the exact bytes.
app.post("/hooks/vulnradar", express.raw({ type: "application/json" }), (req, res) => {
  const sent = Buffer.from(req.get("X-VulnRadar-Signature") ?? "");
  const expected = Buffer.from(
    "sha256=" + crypto.createHmac("sha256", secret).update(req.body).digest("hex"),
  );
  if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return res.sendStatus(401);
  }

  res.sendStatus(204); // answer first, then do the work
  handleDelivery(JSON.parse(req.body));
});`;

const PYTHON_VERIFY = `import hashlib
import hmac
import os

from flask import Flask, abort, request

app = Flask(__name__)
# The whole string you were shown, used as it is. Do not hex-decode it.
secret = os.environ["VULNRADAR_WEBHOOK_SECRET"].encode()

@app.post("/hooks/vulnradar")
def receive():
    body = request.get_data()  # the exact bytes, before any JSON parsing
    sent = request.headers.get("X-VulnRadar-Signature", "").encode()
    expected = b"sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest().encode()
    if not hmac.compare_digest(sent, expected):
        abort(401)

    handle_delivery(request.get_json())
    return "", 204`;

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "receive-and-verify", label: "Receive and verify a delivery" },
  { id: "supported-platforms", label: "Supported Platforms" },
  { id: "endpoints", label: "API Endpoints" },
  { id: "events", label: "Events" },
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
          API key. Most scans run as background jobs, so delivery happens when
          the job actually finishes rather than when the request that started it
          returned; an authenticated scan and a GitHub repo scan run inline, and
          fire as they finish. Each delivery is signed (see Security below) and
          re-checks the destination URL against the SSRF rules again at delivery
          time, not just when you registered it. A delivery that fails (network
          error, timeout, or a non-2xx response) gets exactly one retry a few
          seconds later; if that also fails, the attempt is logged and, if you
          have the notification enabled, you get an email. The per-user cap is
          set by your plan, not a flat number:{" "}
          <strong className="text-foreground">{WEBHOOK_CAPS}</strong>. Free
          accounts do get a webhook: the step up you pay for is 1 to 5 at Pro
          Supporter.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Every kind of scan fires them: a single-URL scan, a crawl (what{" "}
          <InlineCode>--crawl</InlineCode> runs in the CLI and the GitHub
          Action), a bulk run, an authenticated scan, and a GitHub repo scan.
          Only one of those used to, so if you registered a webhook and never
          saw a delivery from a crawl or an authenticated scan, that is why.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Failed, cancelled and timed-out scans never fire a webhook. The events
          below describe a scan that finished and was saved.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A webhook can also be assigned to a team. It then fires on any scan
          shared with that team, for as long as the person who created it is
          still a member; once they leave, it goes back to firing on their own
          scans only. Teammates whose role manages scans (team owner, admin,
          member) can see the full address, pause, rename, test and delete it. A
          viewer sees the name and the host only, because the URL of a Discord
          or Slack webhook is the credential for posting there. Only the creator
          can change the address, the type or the team, or rotate the signing
          secret.
        </p>
      </DocsSection>

      <DocsSection
        id="receive-and-verify"
        title="Receive and verify a delivery"
      >
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Each delivery is one POST with these headers. Check the signature
          before you trust the body, and answer with a 2xx within{" "}
          {DELIVERY_DEADLINE_SECONDS} seconds. Anything else gets one retry
          after {RETRY_DELAY_SECONDS} seconds, and then the delivery is given up
          on.
        </p>
        <DocsTable
          caption="Headers sent with every webhook delivery"
          columns={[
            { key: "header", header: "Header" },
            { key: "value", header: "Value" },
          ]}
          data={[
            { header: "Content-Type", value: "application/json" },
            { header: "User-Agent", value: `${APP_NAME}-Webhook/1.0` },
            {
              header: "X-VulnRadar-Signature",
              value:
                "sha256=<hex>, the HMAC-SHA256 of the exact body. Absent only on a webhook with no usable secret.",
            },
            {
              header: "X-VulnRadar-Delivery",
              value: "A UUID for this delivery. The retry sends the same one.",
            },
            {
              header: "X-VulnRadar-Event",
              value: "scan.completed, scan.regressed or test",
            },
            {
              header: "X-VulnRadar-Attempt",
              value: "1, or 2 on the retry",
            },
            {
              header: "X-VulnRadar-Timestamp",
              value: "Unix seconds when this attempt was sent",
            },
            {
              header: "X-VulnRadar-Signature-V2",
              value:
                "t=<unix>,v1=<hex>, the HMAC-SHA256 of the timestamp, a dot, then the body",
            },
          ]}
        />
        <CodeBlock code={NODE_VERIFY} language="javascript" />
        <CodeBlock code={PYTHON_VERIFY} language="python" />
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          No timestamp is signed in the first signature header, so a captured
          delivery still verifies later. Check that scanned_at is recent, or
          verify the V2 header when present and compare its{" "}
          <InlineCode>t</InlineCode> with your clock, which also covers the
          timestamp itself.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A retry can reach you after you already handled the first attempt, if
          your answer was lost on the way back. Treat the event together with
          data.scan_id as the idempotency key, or the{" "}
          <InlineCode>X-VulnRadar-Delivery</InlineCode> value, and ignore a
          repeat.
        </p>
        <DocsTable
          caption="What each event sends to a generic endpoint"
          columns={[
            { key: "event", header: "Event" },
            { key: "payload", header: "Payload" },
          ]}
          data={[
            {
              event: "scan.completed",
              payload:
                "id, event, created_at, api_version, scan_public_id, and data with the target, scan_id, summary, findings_count, duration, scanned_at",
            },
            {
              event: "scan.regressed",
              payload:
                "The same top-level keys, and data with the target, scan_id, scanned_at and the new and outstanding findings",
            },
            {
              event: "test",
              payload:
                "id, event, created_at, api_version, message, webhook_name, timestamp",
            },
          ]}
        />
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
                "/api/webhooks/* or /api/v<n>/webhooks/* on discord.com, discordapp.com, or a subdomain of either such as ptb. or canary.",
              payload:
                "Rich embeds with colour-coded severity. A Discord URL ending in /slack gets the Slack payload and one ending in /github the generic one, even on a webhook saved earlier as Discord.",
            },
            {
              platform: "Slack",
              pattern: "hooks.slack.com/*",
              payload:
                "Block Kit with section fields, plus a top-level text line that shows in the notification preview",
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
          most recent delivery attempts with their status). Both are also on the{" "}
          <Link
            href={`${ROUTES.PROFILE}?tab=developer&dtab=webhooks`}
            className="text-primary underline-offset-2 hover:underline"
          >
            Webhooks page
          </Link>
          , as the rotate and history buttons on each row. The same rows carry
          the team picker for <InlineCode>teamId</InlineCode>, so handing a
          webhook to a team no longer needs a PATCH of your own.
        </p>

        <div className="space-y-6">
          <EndpointCard
            id="get-webhooks"
            method="GET"
            path="/webhooks"
            title="List Webhooks"
            description="Your own webhooks plus any assigned to a team you belong to."
            responseExample={`{
  "webhooks": [
    {
      "id": 1,
      "url": "https://discord.com/api/webhooks/xxx/yyy",
      "url_host": "discord.com",
      "name": "Security Alerts",
      "type": "discord",
      "active": true,
      "created_at": "2026-03-10T15:30:00.000Z"
    },
    {
      "id": 2,
      "url": null,
      "url_host": "hooks.slack.com",
      "name": "Team alerts",
      "type": "slack",
      "active": true,
      "created_at": "2026-03-11T09:12:00.000Z"
    }
  ]
}`}
            notes={[
              "url is null, with only url_host to go on, for a teammate who cannot write to that webhook: a viewer, or anyone on a webhook whose creator is a super admin.",
            ]}
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
              "type defaults to auto-detect; allowed values are auto | discord | slack | generic, and anything else is a 400. auto means detect from the URL; the other three pin the payload format regardless of what the URL looks like, which is what you want for a proxy sitting in front of a Discord or Slack endpoint. The one exception is a discord type on a Discord /slack or /github URL, which always gets the format that endpoint reads.",
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
              "It is signed with the stored secret and carries the same headers as a real delivery, so a consumer that verifies signatures can be tested with it. It gets one attempt, no retry.",
              `Limited to ${TEST_SEND_USER_LIMIT.maxAttempts} tests per account in ${TEST_SEND_USER_LIMIT.windowSeconds / 60} minutes and ${TEST_SEND_TARGET_LIMIT.maxAttempts} per destination domain in ${TEST_SEND_TARGET_LIMIT.windowSeconds / 60} minutes. Discord and Slack count per webhook, since every webhook there shares one domain.`,
            ]}
            errors={[
              {
                code: 400,
                description: "Missing id, or the target is now SSRF-blocked",
              },
              { code: 401, description: "Unauthorized" },
              {
                code: 403,
                description:
                  "You can read this webhook but have no write access to it, or webhooks are disabled on this deployment",
              },
              { code: 404, description: "Webhook not found, or no access" },
              {
                code: 429,
                description:
                  "Too many tests. Retry-After says when to try again",
              },
              {
                code: 502,
                description:
                  "Your endpoint answered with a non-2xx, or could not be reached",
              },
              {
                code: 504,
                description: `Your endpoint did not answer within ${DELIVERY_DEADLINE_SECONDS} seconds`,
              },
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
              "The owner, or a team co-member with write access, may pause and rename. A read-only co-member gets 403 because they legitimately know it exists; anyone with no access at all gets 404.",
              "Only this webhook's creator can change its URL, type or teamId, since every delivery is signed with their secret. A co-member who sends any of the three gets 403, even with the current value.",
              "url: null is refused with a 400: it is the redacted form GET shows a read-only teammate, not a way to clear the address.",
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
                  "Read access but not write access, or not the creator when changing url, type or teamId",
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
              "An id that does not exist returns 404, the same answer as a webhook you have no access to, so a caller cannot tell the two apart.",
            ]}
            errors={[
              { code: 401, description: "Unauthorized" },
              {
                code: 403,
                description: "No write access to this webhook",
              },
              {
                code: 404,
                description: "No such webhook, or no access to it",
              },
            ]}
          />
        </div>
      </DocsSection>

      <DocsSection id="events" title="Events">
        <DocsTable
          caption="Webhook events, when each fires, and what its payload carries"
          columns={[
            { key: "event", header: "Event" },
            { key: "fires", header: "Fires when" },
            { key: "carries", header: "Payload carries" },
          ]}
          data={[
            {
              event: "scan.completed",
              fires: "Every scan that finishes and is persisted",
              carries: "Severity counts, duration, and what did not finish",
            },
            {
              event: "scan.regressed",
              fires:
                "A scan turns up a critical or high finding that was not in the previous scan of the same target",
              carries: "The new findings themselves, plus what is outstanding",
            },
            {
              event: "test",
              fires:
                "Someone presses the paper-plane Send test webhook button on the row",
              carries:
                "A message and the webhook's name, and no data key. Signed with the stored secret like any other delivery.",
            },
          ]}
        />
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A generic endpoint receives this for <InlineCode>test</InlineCode>.
          Discord and Slack get a short message in their own format.
        </p>
        <CodeBlock
          code={`{
  "id": "6f1d1c0e-8a43-4f0b-9b7e-1f1c2a3b4c5d",
  "created_at": "2026-03-10T15:30:00.000Z",
  "api_version": "1",
  "event": "test",
  "message": "This is a test webhook from ${APP_NAME}",
  "webhook_name": "Security Alerts",
  "timestamp": "2026-03-10T15:30:00.000Z"
}`}
          language="json"
        />
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Both go to the same registered webhooks, and{" "}
          <InlineCode>scan.regressed</InlineCode> is sent after that scan&apos;s{" "}
          <InlineCode>scan.completed</InlineCode>, never instead of it. It is
          the same diff the critical-findings email is built from: a finding you
          have marked a false positive, accepted the risk of, or decided not to
          fix does not count as new, so a persistent finding on an hourly
          schedule does not re-alert every run.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          It exists because <InlineCode>scan.completed</InlineCode> carries
          counts and not findings, so routing an alert to a person meant a
          second API call to work out what actually changed.{" "}
          <InlineCode>scan.regressed</InlineCode> carries the findings inline,
          which is what makes a Slack or Discord alert diff-driven rather than
          count-driven.
        </p>
      </DocsSection>

      <DocsSection id="payloads" title="Webhook Payloads">
        <p className="text-sm text-muted-foreground">
          Each platform receives a tailored payload. The{" "}
          <InlineCode>summary</InlineCode> object is the same in all three:
          critical, high, medium, low, info, total.
        </p>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          What identifies the target depends on what was scanned. A web scan
          sends <InlineCode>url</InlineCode> (and{" "}
          <InlineCode>normalizedUrl</InlineCode>, the same value, kept for
          consumers written against the older payload). A GitHub repo scan has
          no URL, so it sends <InlineCode>repository</InlineCode> and no{" "}
          <InlineCode>url</InlineCode> key at all rather than a URL-shaped
          string that is not one. Branch on whichever key is present.
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
          <h3 className="text-base font-semibold mb-4">
            Generic: scan.completed
          </h3>
          <CodeBlock
            code={`{
  "id": "6f1d1c0e-8a43-4f0b-9b7e-1f1c2a3b4c5d",
  "created_at": "2026-03-10T15:30:00.000Z",
  "api_version": "1",
  "scan_public_id": "9f2c41d7a0b34e6c8d15e27f6b3a904c",
  "event": "scan.completed",
  "data": {
    "url": "https://example.com",
    "normalizedUrl": "https://example.com",
    "scan_id": 4821,
    "summary": {
      "critical": 1, "high": 2, "medium": 1, "low": 1, "info": 0, "total": 5
    },
    "findings_count": 5,
    "duration": 1423,
    "scanned_at": "2026-03-10T15:30:00.000Z",
    "incomplete": ["dns", "tls"]
  }
}`}
            language="json"
          />
          <p className="text-xs text-muted-foreground mt-3">
            <InlineCode>incomplete</InlineCode> is present only when part of the
            scan did not finish, and it is the difference between &ldquo;we
            found nothing&rdquo; and &ldquo;we could not finish looking&rdquo;.
            An area listed there was not checked, so treat a{" "}
            <InlineCode>findings_count</InlineCode> of 0 alongside it as
            unknown, not clean. When every branch ran the key is absent
            entirely, so a consumer that only tests for the key can tell the two
            apart. The Discord embed carries the same fact as a{" "}
            <strong className="text-foreground">Coverage</strong> field and
            Slack as an extra section, since neither format has a key to read.
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            <InlineCode>id</InlineCode> is the same value as the{" "}
            <InlineCode>X-VulnRadar-Delivery</InlineCode> header.{" "}
            <InlineCode>api_version</InlineCode> is the version of this payload
            and moves separately from the REST API.{" "}
            <InlineCode>scan_public_id</InlineCode> is the id the app and its
            URLs use for the scan.
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Generic: scan.regressed
          </h3>
          <CodeBlock
            code={`{
  "id": "0b7f3a52-1c9e-4d27-a6e4-7c2f90d1b8aa",
  "created_at": "2026-03-10T15:30:00.000Z",
  "api_version": "1",
  "scan_public_id": "9f2c41d7a0b34e6c8d15e27f6b3a904c",
  "event": "scan.regressed",
  "data": {
    "url": "https://example.com",
    "normalizedUrl": "https://example.com",
    "scan_id": 4821,
    "scanned_at": "2026-03-10T15:30:00.000Z",
    "new_findings_count": 1,
    "outstanding_findings_count": 2,
    "new_findings": [
      {
        "id": "exposed-db-credentials--a1b2c3",
        "title": "Database credentials exposed in JavaScript bundle",
        "severity": "critical",
        "category": "secrets-extended"
      }
    ],
    "outstanding_findings": [
      {
        "id": "csp-unsafe-inline--a1b2c3",
        "title": "Content-Security-Policy allows unsafe-inline",
        "severity": "high",
        "category": "headers"
      }
    ]
  }
}`}
            language="json"
          />
          <p className="text-xs text-muted-foreground mt-3">
            <InlineCode>new_findings</InlineCode> is what changed since the
            previous scan of this target: critical and high only, with anything
            you have already triaged removed.{" "}
            <InlineCode>outstanding_findings</InlineCode> is what was already
            there and still is. Finding <InlineCode>id</InlineCode> is stable
            across scans of the same URL, so it works as a deduplication key in
            your own alerting. Discord and Slack receive the same diff as a
            formatted message listing the first ten new findings.
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
            came from {APP_NAME}. Test deliveries are signed with the stored
            secret too. Lost or leaked the secret? Call{" "}
            <InlineCode>
              POST /api/v3/webhooks/{"{id}"}/rotate-secret
            </InlineCode>{" "}
            (owner only) for a new one on the same row: the id and the URL
            survive, so your consumer&rsquo;s configuration does not have to
            change. There is no overlap: old signatures stop matching at once,
            so update your consumer as soon as that returns.
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
            notification enabled, the person who created the webhook gets an
            email, whoever&apos;s scan it was. This is still best-effort
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
            webhooks the caller owns or has team write access to; changing the
            URL or type, rotating the secret and reassigning the team are
            owner-only.
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
              Log in to {APP_NAME} and open{" "}
              <strong className="text-foreground">{ADD_WEBHOOK_PATH}</strong>.
            </li>
            <li>Paste the URL and an optional label. Type is auto-detected.</li>
            <li>
              Press the paper-plane{" "}
              <strong className="text-foreground">Send test webhook</strong>{" "}
              button on its row. A test payload posts to Discord; you should see
              a colored embed within a few seconds.
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
              Paste it as a webhook in {APP_NAME}, at{" "}
              <strong className="text-foreground">{ADD_WEBHOOK_PATH}</strong>.
              It is detected as <InlineCode>generic</InlineCode>.
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
