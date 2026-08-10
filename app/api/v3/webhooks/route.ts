import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { webhookCreatedEmail, webhookDeletedEmail } from "@/lib/email/email";
import {
  ERROR_MESSAGES,
  APP_NAME,
  BRANDING_PRIMARY_COLOR,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { safeFetch, validateScanTarget } from "@/lib/scanner/safe-fetch";
import { getClientIp } from "@/lib/api/request-utils";
import {
  getUserPlanLimits,
  withinPlanLimit,
  planLimitMessage,
} from "@/lib/billing/plan-limits";
import { detectWebhookType } from "@/lib/webhooks/detect-type";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const result = await pool.query(
    "SELECT id, url, name, type, active, created_at FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC",
    [session.userId],
  );
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  if (!(await getSetting("FEATURE_WEBHOOKS"))) {
    return NextResponse.json(
      { error: "Webhooks are disabled on this deployment." },
      { status: 403 },
    );
  }

  const { url, name, type: userType } = await request.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { error: "Webhook URL is required" },
      { status: 400 },
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // ssrf: defer to the canonical private-IP / private-hostname guard
  // in lib/scanner/safe-fetch.ts. The previous hand-rolled blocklist
  // missed 127.0.0.2, 169.254.0.1, IPv6 ULA, IPv4-mapped IPv6, NAT64,
  // and any future CIDR the canonical guard adds.
  if (parsedUrl.protocol !== "https:") {
    return NextResponse.json(
      { error: "Webhook URL must be a public HTTPS endpoint." },
      { status: 400 },
    );
  }
  const scanSafety = await validateScanTarget(parsedUrl.href);
  if (!scanSafety.safe) {
    return NextResponse.json(
      {
        error: scanSafety.reason || "Webhook URL blocked for security reasons.",
      },
      { status: 400 },
    );
  }

  const countRes = await pool.query(
    "SELECT COUNT(*)::int as count FROM webhooks WHERE user_id = $1",
    [session.userId],
  );
  const planLimits = await getUserPlanLimits(session.userId);
  if (
    planLimits &&
    !withinPlanLimit(countRes.rows[0].count, planLimits.webhooks)
  ) {
    return NextResponse.json(
      { error: planLimitMessage("Webhooks", planLimits.webhooks) },
      { status: 400 },
    );
  }

  // Auto-detect type from URL if user didn't specify or chose "auto"
  const webhookType =
    userType && userType !== "auto" ? userType : detectWebhookType(url);
  const webhookName = name || "Default";

  // Generated here (not left to the column's migration-backfill DEFAULT)
  // so every webhook created through this route gets a fresh secret from
  // Node's own CSPRNG, the same primitive api-keys.ts uses for API keys.
  // Returned once in the response below and never selected by GET --
  // same "shown once" contract as an API key's raw_key.
  const secret = randomBytes(32).toString("hex");

  const result = await pool.query(
    "INSERT INTO webhooks (user_id, url, name, type, secret) VALUES ($1, $2, $3, $4, $5) RETURNING id, url, name, type, active, created_at, secret",
    [session.userId, url, webhookName, webhookType, secret],
  );

  // Send notification email
  // audit-log: getClientIp respects
  // TRUSTED_PROXY_CIDR so a forged X-Forwarded-For can't poison
  // the audit-log IP.
  const ip = (await getClientIp()) || "Unknown";
  const userAgent = request.headers.get("user-agent") || "Unknown";
  const emailContent = webhookCreatedEmail(webhookName, url, webhookType, {
    ipAddress: ip,
    userAgent,
  });

  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "webhooks",
    emailContent,
  }).catch((err) =>
    console.error("Failed to send webhook created notification:", err),
  );

  return NextResponse.json(result.rows[0], { status: 201 });
}

// Test a webhook by sending a test payload
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json(
      { error: "Webhook ID is required" },
      { status: 400 },
    );
  }

  // Get webhook details
  const result = await pool.query(
    "SELECT id, url, name, type FROM webhooks WHERE id = $1 AND user_id = $2",
    [id, session.userId],
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const webhook = result.rows[0];

  // ssrf: re-run validation on the stored URL — it may have been
  // written via DB migration, admin path, or any code path that
  // bypassed POST validation.
  const targetCheck = await validateScanTarget(webhook.url);
  if (!targetCheck.safe) {
    return NextResponse.json(
      {
        success: false,
        error: targetCheck.reason || "Webhook target blocked",
      },
      { status: 400 },
    );
  }

  // Build test payload based on webhook type
  const testPayload =
    webhook.type === "discord"
      ? {
          content: null,
          embeds: [
            {
              title: `${APP_NAME} Test Webhook`,
              description: `This is a test message from ${APP_NAME} to verify your webhook is working correctly.`,
              color: parseInt(BRANDING_PRIMARY_COLOR.slice(1), 16),
              fields: [
                { name: "Status", value: "Connected", inline: true },
                { name: "Webhook Name", value: webhook.name, inline: true },
              ],
              footer: { text: `${APP_NAME} Security Scanner` },
              timestamp: new Date().toISOString(),
            },
          ],
        }
      : webhook.type === "slack"
        ? {
            text: `${APP_NAME} Test Webhook`,
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: `${APP_NAME} Test Webhook`,
                  emoji: true,
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `This is a test message from ${APP_NAME} to verify your webhook is working correctly.`,
                },
              },
              {
                type: "section",
                fields: [
                  { type: "mrkdwn", text: "*Status:*\nConnected" },
                  { type: "mrkdwn", text: `*Webhook Name:*\n${webhook.name}` },
                ],
              },
            ],
          }
        : {
            event: "test",
            message: `This is a test webhook from ${APP_NAME}`,
            webhook_name: webhook.name,
            timestamp: new Date().toISOString(),
          };

  try {
    // SSRF guard: re-validate the user-supplied webhook URL via safeFetch so
    // a registered webhook can't be used to probe internal services
    // (the URL was validated at registration but DNS or routing could have
    // changed since, and safeFetch also blocks redirects to private IPs).
    const safety = await validateScanTarget(webhook.url);
    if (!safety.safe) {
      return NextResponse.json(
        {
          success: false,
          error: `Webhook target blocked: ${safety.reason || "unsafe URL"}`,
        },
        { status: 400 },
      );
    }
    const res = await safeFetch(webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      return NextResponse.json(
        {
          success: false,
          error: `Webhook returned ${res.status}: ${text.slice(0, 100)}`,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Test webhook sent successfully",
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `Failed to reach webhook: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id } = await request.json();

  // Get webhook details before deleting for the email
  const webhookResult = await pool.query(
    "SELECT name FROM webhooks WHERE id = $1 AND user_id = $2",
    [id, session.userId],
  );

  await pool.query("DELETE FROM webhooks WHERE id = $1 AND user_id = $2", [
    id,
    session.userId,
  ]);

  // Send notification email if webhook was found
  if (webhookResult.rows.length > 0) {
    // audit-log: trusted client IP only.
    const ip = (await getClientIp()) || "Unknown";
    const userAgent = request.headers.get("user-agent") || "Unknown";
    const emailContent = webhookDeletedEmail(webhookResult.rows[0].name, {
      ipAddress: ip,
      userAgent,
    });

    sendNotificationEmail({
      userId: session.userId,
      userEmail: session.email,
      type: "webhooks",
      emailContent,
    }).catch((err) =>
      console.error("Failed to send webhook deleted notification:", err),
    );
  }

  return NextResponse.json({ success: true });
}
