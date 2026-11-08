import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
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
import { extractRootDomain } from "@/lib/scanner/root-domain";
import { isDiscordHost } from "@/lib/net/discord-webhook";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import { getClientIp } from "@/lib/api/request-utils";
import { burstLimitedResponse } from "@/lib/api/rate-limit-response";
import { TOO_MANY_ATTEMPTS } from "@/lib/api/retry-in";
import {
  getUserPlanLimits,
  withinPlanLimit,
  planLimitMessage,
} from "@/lib/billing/plan-limits";
import {
  deliveryFormat,
  detectWebhookType,
  resolveWebhookType,
  WEBHOOK_TYPE_ERROR,
} from "@/lib/webhooks/detect-type";
import { encryptWebhookSecret, readWebhookSecret } from "@/lib/webhooks/secret";
import {
  buildDeliveryHeaders,
  readResponseSnippet,
} from "@/lib/webhooks/delivery";
import {
  DELIVERY_TIMEOUT_MS,
  newDeliveryEnvelope,
  TEST_SEND_TARGET_LIMIT,
  TEST_SEND_USER_LIMIT,
} from "@/lib/webhooks/delivery-contract";
import {
  getTeamResourceAccess,
  type TeamResourceAccess,
} from "@/lib/auth/team-resource-access";

const TEST_ERROR_SNIPPET_MAX = 100;

const TEST_TARGET_REFUSED =
  "This webhook's address is not a public endpoint, so nothing was sent.";

function parseStoredUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function testRateLimited(rl: { retryAfterSeconds: number }) {
  return burstLimitedResponse(
    rl,
    TOO_MANY_ATTEMPTS("test deliveries", rl.retryAfterSeconds),
    { success: false },
  );
}

/**
 * The bucket for the place a test is sent. Normally the registrable domain, so
 * that subdomains cannot be used to dodge it, and the whole address for an IP,
 * whose last two octets are not a domain. Discord and Slack are the exception:
 * every webhook on the deployment shares those domains, and one bucket there
 * would let a single account spend everybody's Test button, so those count per
 * webhook. By id, because the URL is a credential and this key is stored in
 * plain text.
 *
 * Discord goes by its host rather than the detected type: its /github endpoint
 * is detected as generic and would otherwise land in one discord.com bucket.
 * The trailing dot comes off because new URL() keeps it, and example.com. is
 * example.com to DNS but a second bucket to a string comparison.
 */
function testTargetLimitKey(webhookId: number, url: string): string {
  const parsedHost = parseStoredUrl(url)?.hostname;
  const hostname = parsedHost?.endsWith(".")
    ? parsedHost.slice(0, -1)
    : parsedHost;
  const perWebhook =
    !hostname || isDiscordHost(hostname) || detectWebhookType(url) === "slack";
  const scope = perWebhook
    ? `id-${webhookId}`
    : isIP(hostname)
      ? hostname
      : extractRootDomain(hostname).toLowerCase();
  return `webhook-test-target:${scope}`;
}

/**
 * The answer for a test that never got a response. Written out rather than
 * passed through: the underlying message can name internal addresses and
 * socket errors, and this body goes straight to the browser.
 */
function testFailure(err: unknown): { status: number; error: string } {
  switch ((err as { code?: unknown } | null)?.code) {
    case "timeout":
      return {
        status: 504,
        error: `Your endpoint did not answer within ${DELIVERY_TIMEOUT_MS / 1000} seconds.`,
      };
    case "tls":
      return {
        status: 502,
        error: "Your endpoint's TLS certificate or handshake was refused.",
      };
    case "unreachable":
      return { status: 502, error: "Could not connect to your endpoint." };
    case "cross_host_redirect":
    case "redirect":
      return {
        status: 502,
        error:
          "Your endpoint answered with a redirect to another host, and deliveries do not follow those.",
      };
    case "blocked":
      return { status: 400, error: TEST_TARGET_REFUSED };
    default:
      return { status: 502, error: "Could not reach your endpoint." };
  }
}

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  // Team co-membership alone is enough to see that a webhook exists -- every
  // team role grants "view_reports" (see TEAM_ROLE_PERMISSIONS in
  // lib/config/client-constants.ts). The URL itself is
  // redacted per row below.
  // user_id is selected because the list mixes the caller's own webhooks with
  // teammates', and only the creator may change a webhook's team (PATCH
  // /webhooks/[id] answers 403 to anyone else). Without it the client cannot
  // tell the two apart, so it would either hide the team control from owners
  // or offer everyone a control that 403s.
  const result = await pool.query(
    `SELECT id, url, name, type, active, user_id, team_id, created_at FROM webhooks
     WHERE user_id = $1
        OR team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
     ORDER BY created_at DESC`,
    [session.userId],
  );

  // Whoever can write to a webhook keeps its address; anyone else gets the
  // host, because the path of a Discord or Slack webhook is the credential for
  // posting there. Asked of getTeamResourceAccess rather than worked out from the roles
  // here, because that function is what decides who may write, and a second
  // copy of the rule is one that can drift into showing a credential. Memoised
  // per creator and team: a creator's own rows answer without a query, and
  // everything else is at most one lookup per teammate per team.
  const accessByOwnerAndTeam = new Map<string, Promise<TeamResourceAccess>>();
  const webhooks = await Promise.all(
    result.rows.map(async (row) => {
      const key = `${row.user_id}:${row.team_id}`;
      let access = accessByOwnerAndTeam.get(key);
      if (!access) {
        access = getTeamResourceAccess(
          session.userId,
          row.user_id,
          row.team_id,
        );
        accessByOwnerAndTeam.set(key, access);
      }
      const { canWrite } = await access;
      return {
        ...row,
        url: canWrite ? row.url : null,
        url_host: parseStoredUrl(row.url)?.host ?? null,
      };
    }),
  );

  // Named-key envelope, matching every other collection endpoint. See the
  // same note on GET /api/v3/schedules: a bare array cannot carry a count or
  // a truncation flag later without breaking its callers.
  return NextResponse.json({ webhooks });
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

  // Detected from the URL unless the caller pinned one of the three real
  // types. Anything else is refused rather than stored: see
  // resolveWebhookType for what silently accepting it used to cost.
  const webhookType = resolveWebhookType(userType, url);
  if (webhookType === null) {
    return NextResponse.json({ error: WEBHOOK_TYPE_ERROR }, { status: 400 });
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

  const webhookName = name || "Default";

  // Generated here (not left to the column's migration-backfill DEFAULT)
  // so every webhook created through this route gets a fresh secret from
  // Node's own CSPRNG, the same primitive api-keys.ts uses for API keys.
  // Returned once in the response below and never selected by GET --
  // same "shown once" contract as an API key's raw_key.
  const secret = randomBytes(32).toString("hex");

  // The column stores ciphertext (AUDIT-009#webhook-01), so the plaintext is
  // attached to the response here instead of coming back through RETURNING:
  // a RETURNING secret would hand the caller the ciphertext.
  //
  // The plan cap is re-checked INSIDE the INSERT, not only by the count
  // above. Count-then-insert is check-then-act: two requests that both read
  // the same count before either writes both pass the gate, and the account
  // ends up over its plan's webhook cap with no way for anything to notice
  // afterwards. The guarded form is the one schedules/route.ts and
  // lib/rate-limiting/daily-limits.ts already use. A null cap means unlimited
  // (billing off, or the plan's own -1) and the WHERE then always holds.
  const webhookCap =
    planLimits && planLimits.webhooks !== -1 ? planLimits.webhooks : null;
  const result = await pool.query(
    `INSERT INTO webhooks (user_id, url, name, type, secret)
     SELECT $1, $2, $3, $4, $5
     WHERE $6::int IS NULL
        OR (SELECT COUNT(*) FROM webhooks WHERE user_id = $1) < $6::int
     RETURNING id, url, name, type, active, user_id, team_id, created_at`,
    [
      session.userId,
      url,
      webhookName,
      webhookType,
      encryptWebhookSecret(secret),
      webhookCap,
    ],
  );
  if (result.rows.length === 0) {
    // The guard refused: another request took the last slot between the
    // count above and this statement. Answered exactly as the count would
    // have answered it.
    return NextResponse.json(
      { error: planLimitMessage("Webhooks", planLimits?.webhooks ?? 0) },
      { status: 400 },
    );
  }

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

  return NextResponse.json({ ...result.rows[0], secret }, { status: 201 });
}

// Test a webhook by sending a test payload
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  if (!(await getSetting("FEATURE_WEBHOOKS"))) {
    return NextResponse.json(
      { success: false, error: "Webhooks are disabled on this deployment." },
      { status: 403 },
    );
  }

  const userLimit = await checkRateLimit({
    key: `webhook-test:${session.userId}`,
    ...TEST_SEND_USER_LIMIT,
  });
  if (!userLimit.allowed) return testRateLimited(userLimit);

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json(
      { error: "Webhook ID is required" },
      { status: 400 },
    );
  }

  // Get webhook details
  const result = await pool.query(
    "SELECT id, url, name, type, user_id, team_id, secret FROM webhooks WHERE id = $1",
    [id],
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const webhook = result.rows[0];
  const access = await getTeamResourceAccess(
    session.userId,
    webhook.user_id,
    webhook.team_id,
  );
  if (!access.canRead) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json(
      { error: "You don't have permission to test this webhook." },
      { status: 403 },
    );
  }

  // After the access checks, so a stranger cannot spend a target's bucket by
  // guessing webhook ids.
  const targetLimit = await checkRateLimit({
    key: testTargetLimitKey(webhook.id, webhook.url),
    ...TEST_SEND_TARGET_LIMIT,
  });
  if (!targetLimit.allowed) return testRateLimited(targetLimit);

  // ssrf: re-run validation on the stored URL — it may have been
  // written via DB migration, admin path, or any code path that
  // bypassed POST validation. DNS or routing may also have changed since
  // registration, and safeFetch separately blocks redirects to private IPs.
  const targetCheck = await validateScanTarget(webhook.url);
  if (!targetCheck.safe) {
    // Same reading safeFetch gives this result: a name that no longer resolves
    // is the far end being down (502), and only a real refusal is a 400.
    const { status, error } = testFailure({
      code: targetCheck.code ?? "blocked",
    });
    return NextResponse.json({ success: false, error }, { status });
  }

  const envelope = newDeliveryEnvelope();

  // The payload a real delivery to this row gets (deliveryFormat), not its
  // stored type: a row saved as discord before /slack and /github were told
  // apart still holds that type, and its test was sent an embed those
  // endpoints do not read, while its scan notifications already worked.
  const format = deliveryFormat(webhook.type, webhook.url);
  const testPayload =
    format === "discord"
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
      : format === "slack"
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
            ...envelope,
            event: "test",
            message: `This is a test webhook from ${APP_NAME}`,
            webhook_name: webhook.name,
            timestamp: new Date().toISOString(),
          };

  try {
    const body = JSON.stringify(testPayload);
    const res = await safeFetch(webhook.url, {
      method: "POST",
      headers: buildDeliveryHeaders(body, readWebhookSecret(webhook.secret), {
        id: envelope.id,
        event: "test",
        attempt: 1,
      }),
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (!res.ok) {
      const snippet = await readResponseSnippet(res, TEST_ERROR_SNIPPET_MAX);
      // The route worked and the far end did not, which is a bad gateway, not
      // a bad request. 400 also read as "you sent something wrong".
      return NextResponse.json(
        {
          success: false,
          error: `Webhook returned ${res.status}${snippet ? `: ${snippet}` : ""}`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Test webhook sent successfully",
    });
  } catch (err) {
    const { status, error } = testFailure(err);
    return NextResponse.json({ success: false, error }, { status });
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
    "SELECT name, user_id, team_id FROM webhooks WHERE id = $1",
    [id],
  );
  const webhook = webhookResult.rows[0];

  // An id that matches nothing is a 404, like every sibling route. It used to
  // fall through to a DELETE that removed no rows and then answer 200, which
  // inverted the very thing the line below is for: a webhook that EXISTS and
  // is not yours already answers 404 rather than 403 so that a caller cannot
  // tell one from the other, and answering 200 for "no such id" handed back
  // exactly that distinction.
  if (!webhook) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404 });
  }

  const access = await getTeamResourceAccess(
    session.userId,
    webhook.user_id,
    webhook.team_id,
  );
  if (!access.canWrite) {
    return NextResponse.json(
      { error: "You don't have permission to delete this webhook." },
      { status: access.canRead ? 403 : 404 },
    );
  }

  await pool.query("DELETE FROM webhooks WHERE id = $1", [id]);

  // The row existed: anything else returned 404 above.
  {
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
