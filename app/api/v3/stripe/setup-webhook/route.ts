import { NextResponse } from "next/server";
import { ensureStripeWebhook } from "@/lib/billing/stripe-webhook-setup";
import { getSetting } from "@/lib/config/runtime-config";
import { requireAdmin } from "@/lib/auth/authorization";
import { ERROR_MESSAGES } from "@/lib/config/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/v3/stripe/setup-webhook
 *
 * Ensures the Stripe webhook is configured for this app instance.
 * Creates one if it doesn't exist, or returns existing webhook info.
 *
 * This endpoint is idempotent - safe to call multiple times.
 *
 * IMPORTANT: If a new webhook is created, you'll need to manually copy
 * the webhook secret to your STRIPE_WEBHOOK_SECRET environment variable.
 * The secret is only returned when the webhook is first created.
 *
 * SECURITY: Only admins can access this endpoint when not configured.
 * When configured, only returns a simple success message.
 */
export async function GET() {
  // Always require admin authentication: even the "already configured"
  // status reveals Stripe integration presence to unauthenticated callers.
  //
  // requireAdmin, not a hand-rolled `role !== "admin"`. The hand-rolled
  // version skipped ENFORCE_STAFF_2FA (so an admin without 2FA, refused
  // everywhere else in the admin surface, could still create a live Stripe
  // webhook endpoint here) and its exact string comparison locked out
  // super_admin. It also removes a duplicate `SELECT role FROM users`.
  const admin = await requireAdmin();
  if (!admin) {
    // requireAdmin returns null for both "no session" and "not an admin",
    // so this cannot honestly claim the caller is unauthenticated. 403 also
    // matches the sibling setup-products route and app/api/v3/admin/teams.
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 },
    );
  }

  const hasWebhookSecret = !!process.env.STRIPE_WEBHOOK_SECRET;

  if (hasWebhookSecret) {
    return NextResponse.json({
      success: true,
      message: "Webhook is configured",
      configured: true,
    });
  }

  // Admin is authenticated - proceed with setup
  const billingEnabled = await getSetting("BILLING_ENABLED");
  if (!billingEnabled) {
    return NextResponse.json({
      success: true,
      message: "Billing is disabled in config.yaml - webhook setup skipped",
      billingEnabled: false,
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const hasSecretKey = !!process.env.STRIPE_SECRET_KEY;

  if (!hasSecretKey) {
    return NextResponse.json(
      {
        success: false,
        error: "STRIPE_SECRET_KEY environment variable is not set",
        billingEnabled,
      },
      { status: 500 },
    );
  }

  if (!appUrl) {
    return NextResponse.json(
      {
        success: false,
        error: "NEXT_PUBLIC_APP_URL environment variable is not set",
        billingEnabled,
      },
      { status: 500 },
    );
  }

  const result = await ensureStripeWebhook();

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        billingEnabled,
      },
      { status: 500 },
    );
  }

  // Build response
  const response: Record<string, unknown> = {
    success: true,
    billingEnabled,
    webhookUrl: `${appUrl}/api/v3/webhooks/stripe`,
    webhookId: result.webhookId,
    alreadyExists: result.alreadyExists,
    webhookSecretConfigured: false,
  };

  // Only include webhook secret if it was just created (for manual copying)
  if (result.webhookSecret && !result.alreadyExists) {
    response.webhookSecret = result.webhookSecret;
    response.message =
      "NEW WEBHOOK CREATED! Copy the webhookSecret to your STRIPE_WEBHOOK_SECRET environment variable.";
  } else if (result.alreadyExists) {
    response.message =
      "Webhook already exists. Make sure STRIPE_WEBHOOK_SECRET is set in your environment.";
  }

  return NextResponse.json(response);
}
