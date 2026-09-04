/**
 * Every template in lib/email/email.ts, with representative input, in one
 * place.
 *
 * Two suites need the same list and neither should own it: email.test.ts
 * asserts the quality bar across all of them (a subject, a preheader that
 * says something the subject does not, a plain-text part, a rendered size
 * that still fits email_logs), and email-previews.test.ts renders the same
 * list to audits/email-previews/ so a human can open the files and look.
 *
 * A `_` prefix keeps vitest from collecting this as a suite; the include glob
 * is `tests/**\/*.test.ts`.
 *
 * The module namespace is passed in rather than imported here, because
 * lib/email/email.ts pulls in nodemailer and the database pool at load time
 * and both callers already mock those. Importing it here would resolve those
 * mocks in the wrong order.
 */
import type * as EmailModule from "@/lib/email/email";

export interface RenderedTemplate {
  /** Filename stem for the preview, and the label in a test failure. */
  name: string;
  subject: string;
  preheader?: string;
  text: string;
  html: string;
}

// A full, real-length user-agent header rather than a tidied one. The old
// value here was trimmed to 60 characters, which hid the thing that made the
// security notices look bad: a real header wraps onto two lines and reads as
// a machine dump. The Device row now leads with "Firefox 155 on Windows" and
// keeps this underneath in small type, and the preview has to show that.
const DETAILS = {
  ipAddress: "203.0.113.42",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0",
};

const WHEN = new Date("2026-09-01T14:30:00Z");

export function buildTemplateCorpus(
  email: typeof EmailModule,
): RenderedTemplate[] {
  const e = email;
  return [
    // Account and onboarding
    {
      name: "emailVerification",
      ...e.emailVerificationEmail(
        "Sam",
        "https://vulnradar.dev/verify-email?token=6f1c0b9e4a2d",
      ),
    },
    { name: "emailVerified", ...e.emailVerifiedEmail("Sam") },
    {
      name: "signupAttemptOnExistingAccount",
      ...e.signupAttemptOnExistingAccountEmail(
        "Sam",
        "https://vulnradar.dev/login",
        "https://vulnradar.dev/forgot-password",
      ),
    },
    {
      name: "passwordReset",
      ...e.passwordResetEmail(
        "https://vulnradar.dev/reset-password?token=a1b2c3d4e5f6",
      ),
    },
    { name: "passwordChanged", ...e.passwordChangedEmail(true, DETAILS) },
    { name: "accountDeleted", ...e.accountDeletedEmail("Sam") },
    {
      name: "profileNameChanged",
      ...e.profileNameChangedEmail("Sam Iyer", "Sam I.", DETAILS),
    },
    {
      name: "profileEmailChanged",
      ...e.profileEmailChangedEmail(
        "sam@old-domain.dev",
        "sam@new-domain.dev",
        DETAILS,
      ),
    },
    {
      name: "profilePasswordChanged",
      ...e.profilePasswordChangedEmail(DETAILS),
    },

    // Sign-in and second factor
    {
      name: "newLogin",
      ...e.newLoginEmail("Lisbon, Portugal", "203.0.113.42", DETAILS),
    },
    {
      name: "failedLoginAttempts",
      ...e.failedLoginAttemptsEmail(9, "198.51.100.7", DETAILS),
    },
    { name: "sessionRevoked", ...e.sessionRevokedEmail(DETAILS) },
    { name: "email2FACode", ...e.email2FACodeEmail("418246", 10) },
    { name: "email2FAEnabled", ...e.email2FAEnabledEmail(DETAILS) },
    { name: "email2FADisabled", ...e.email2FADisabledEmail(DETAILS) },
    { name: "twoFactorEnabled", ...e.twoFactorEnabledEmail(DETAILS) },
    { name: "twoFactorDisabled", ...e.twoFactorDisabledEmail(DETAILS) },
    {
      name: "backupCodesRegenerated",
      ...e.backupCodesRegeneratedEmail(DETAILS),
    },
    {
      name: "loginMethodConnected",
      ...e.loginMethodChangedEmail("GitHub", true, DETAILS),
    },
    {
      name: "loginMethodDisconnected",
      ...e.loginMethodChangedEmail("Google", false, DETAILS),
    },

    // API keys
    {
      name: "apiKeyCreated",
      ...e.apiKeyCreatedEmail("CI pipeline", "vr_live_9f2", DETAILS),
    },
    { name: "apiKeyDeleted", ...e.apiKeyDeletedEmail("CI pipeline", DETAILS) },
    {
      name: "apiKeyRotation",
      ...e.apiKeyRotationEmail("CI pipeline", "1 September 2026", DETAILS),
    },
    {
      name: "apiKeyBindingReset",
      ...e.apiKeyBindingResetEmail("CI pipeline", DETAILS),
    },
    { name: "rateLimited", ...e.rateLimitedEmail("203.0.113.42", DETAILS) },

    // Webhooks
    {
      name: "webhookCreated",
      ...e.webhookCreatedEmail(
        "Ops channel",
        "https://hooks.example.dev/services/T0/B0/xyz",
        "discord",
        DETAILS,
      ),
    },
    {
      name: "webhookDeleted",
      ...e.webhookDeletedEmail("Ops channel", DETAILS),
    },
    {
      name: "webhookSecretRotated",
      ...e.webhookSecretRotatedEmail("Ops channel", DETAILS),
    },
    {
      name: "webhookDeliveryFailed",
      ...e.webhookDeliveryFailedEmail("https://hooks.example.dev/services/T0", {
        firstStatus: 500,
        retryStatus: null,
        manageUrl: "https://vulnradar.dev/profile?tab=webhooks",
      }),
    },

    // Scanning
    {
      name: "scanComplete",
      ...e.scanCompleteEmail(
        "https://shop.example.dev/checkout",
        { critical: 1, high: 3, medium: 5, low: 2, info: 8, total: 19 },
        2840,
        4821,
      ),
    },
    {
      name: "scanCompleteClean",
      ...e.scanCompleteEmail(
        "https://docs.example.dev",
        { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
        1910,
        4822,
      ),
    },
    {
      name: "criticalFindings",
      ...e.criticalFindingsEmail(
        "https://shop.example.dev/checkout",
        [
          {
            title: "Reflected XSS in the search parameter",
            severity: "critical",
          },
          { title: "Session cookie missing the Secure flag", severity: "high" },
        ],
        [
          {
            title: "Content-Security-Policy allows unsafe-inline",
            severity: "high",
          },
        ],
        4821,
      ),
    },
    {
      name: "scheduledScanComplete",
      ...e.scheduledScanCompleteEmail(
        "Nightly production sweep",
        "https://shop.example.dev",
        { critical: 0, high: 2, medium: 1, low: 0, info: 4, total: 7 },
        3120,
        4830,
      ),
    },
    {
      name: "scheduleCreated",
      ...e.scheduleCreatedEmail("https://shop.example.dev", "daily", DETAILS),
    },
    {
      name: "scheduleDeleted",
      ...e.scheduleDeletedEmail("https://shop.example.dev", DETAILS),
    },
    {
      name: "scheduleDisabled",
      ...e.scheduleDisabledEmail(
        "https://internal.example.dev",
        "the host now resolves to a private address",
      ),
    },
    {
      name: "postureDigest",
      ...e.postureDigestEmail({
        siteCount: 6,
        newFindings: [
          {
            title: "Reflected XSS in the search parameter",
            severity: "critical",
            url: "https://shop.example.dev",
          },
          {
            title: "Session cookie missing the Secure flag",
            severity: "high",
            url: "https://app.example.dev",
          },
        ],
        newFindingsTotal: 5,
        newCriticalCount: 1,
        newHighCount: 4,
        currentOpenCount: 11,
        previousOpenCount: 7,
        trend: "up",
        windowDays: 7,
      }),
    },
    {
      name: "postureDigestQuiet",
      ...e.postureDigestEmail({
        siteCount: 3,
        newFindings: [],
        newFindingsTotal: 0,
        newCriticalCount: 0,
        newHighCount: 0,
        currentOpenCount: 2,
        previousOpenCount: 4,
        trend: "down",
        windowDays: 30,
      }),
    },

    // Teams
    {
      name: "teamInvite",
      ...e.teamInviteEmail(
        "Payments Platform",
        "https://vulnradar.dev/teams/join?token=b7d3e1",
        "Priya",
        7,
      ),
    },
    {
      name: "teamInviteAccepted",
      ...e.teamInviteResolvedEmail(
        "Payments Platform",
        "dev@example.dev",
        true,
      ),
    },
    {
      name: "teamInviteDeclined",
      ...e.teamInviteResolvedEmail(
        "Payments Platform",
        "dev@example.dev",
        false,
      ),
    },
    {
      name: "teamMemberRemoved",
      ...e.teamMemberRemovedEmail("Payments Platform"),
    },
    {
      name: "teamRoleChanged",
      ...e.teamRoleChangedEmail("Payments Platform", "viewer", "admin"),
    },
    { name: "teamDeleted", ...e.teamDeletedEmail("Payments Platform") },
    {
      name: "staffInvite",
      ...e.staffInviteEmail(
        "Security Analyst",
        "https://vulnradar.dev/staff/accept?token=c9a2f4",
        "Priya",
      ),
    },

    // Billing
    {
      name: "paymentReceipt",
      ...e.paymentReceiptEmail({
        planName: "Pro Supporter",
        amountCents: 1200,
        currency: "usd",
        date: "1 September 2026",
        invoiceUrl: "https://invoice.stripe.com/i/acct_1/live_abc",
      }),
    },
    {
      name: "paymentFailed",
      ...e.paymentFailedEmail({
        planName: "Pro Supporter",
        amountCents: 1200,
        currency: "usd",
        nextAttempt: "4 September 2026",
      }),
    },
    {
      name: "subscriptionUpgraded",
      ...e.subscriptionChangedEmail({
        kind: "upgraded",
        planName: "Elite Supporter",
        previousPlanName: "Pro Supporter",
        effectiveDate: "1 September 2026",
      }),
    },
    {
      name: "subscriptionDowngraded",
      ...e.subscriptionChangedEmail({
        kind: "downgraded",
        planName: "Core Supporter",
        previousPlanName: "Pro Supporter",
        effectiveDate: "1 October 2026",
      }),
    },
    {
      name: "subscriptionCanceled",
      ...e.subscriptionChangedEmail({
        kind: "canceled",
        planName: "Pro Supporter",
        effectiveDate: "1 October 2026",
      }),
    },
    {
      name: "subscriptionRenewed",
      ...e.subscriptionChangedEmail({
        kind: "renewed",
        planName: "Core Supporter",
      }),
    },
    {
      name: "billingVerificationCode",
      ...e.billingVerificationCodeEmail("730914", 10),
    },
    {
      name: "creditPurchaseReceipt",
      ...e.creditPurchaseReceiptEmail({
        creditLabel: "AI analysis tokens",
        quantity: 500000,
        amountCents: 500,
        currency: "usd",
        date: "1 September 2026",
        invoiceUrl: null,
      }),
    },
    {
      name: "creditRefund",
      ...e.creditRefundEmail({
        creditLabel: "AI analysis tokens",
        quantity: 500000,
        amountCents: 500,
        currency: "usd",
        disputed: false,
      }),
    },

    // Data and privacy
    {
      name: "dataRequestCreated",
      ...e.dataRequestCreatedEmail("export", DETAILS),
    },

    // Contact and support
    {
      name: "contact",
      ...e.contactEmail({
        name: "Dana Okafor",
        email: "dana@example.dev",
        subject: "Scan misses a header on a redirect chain",
        message:
          "Scanning https://example.dev returns clean, but the 301 hop sets\nStrict-Transport-Security and the final URL does not.",
        category: "bug",
      }),
    },
    {
      name: "contactConfirmation",
      ...e.contactConfirmationEmail({ name: "Dana", category: "Bug Report" }),
    },
    {
      name: "landingContact",
      ...e.landingContactEmail({
        email: "dana@example.dev",
        message: "Do you support scanning behind basic auth?",
      }),
    },
    {
      name: "landingContactConfirmation",
      ...e.landingContactConfirmationEmail(
        "Do you support scanning behind basic auth?",
      ),
    },
    {
      name: "supportTicketReceived",
      ...e.supportTicketReceivedEmail({
        ticketId: 3182,
        subject: "Scheduled scan stopped running on Tuesday",
        category: "help",
        body: "The nightly sweep of shop.example.dev has not produced a report since Tuesday.",
      }),
    },
    {
      name: "supportTicketStaffAlert",
      ...e.supportTicketStaffAlertEmail({
        ticketId: 3182,
        subject: "Scheduled scan stopped running on Tuesday",
        category: "help",
        fromEmail: "dana@example.dev",
        body: "The nightly sweep of shop.example.dev has not produced a report since Tuesday.",
        isNew: true,
      }),
    },
    {
      name: "supportTicketReply",
      ...e.supportTicketReplyEmail({
        ticketId: 3182,
        subject: "Scheduled scan stopped running on Tuesday",
        body: "The schedule was disabled automatically because the target started resolving to a private address. Re-add it once DNS is public again.",
      }),
    },
    {
      name: "supportTicketStatusChanged",
      ...e.supportTicketStatusChangedEmail({
        ticketId: 3182,
        subject: "Scheduled scan stopped running on Tuesday",
        status: "resolved",
      }),
    },

    // Administration
    {
      name: "adminNotification",
      ...e.adminNotificationEmail({
        userName: "Sam",
        adminName: "Priya",
        title: "Scheduled maintenance on Saturday",
        message:
          "Scanning is paused between 02:00 and 04:00 UTC on Saturday while we move the worker pool.\nQueued scans run automatically afterwards.",
        type: "warning",
        timestamp: WHEN,
      }),
    },
    {
      name: "adminAccountChange",
      ...e.adminAccountChangeEmail({
        userName: "Sam",
        adminName: "Priya",
        changes: [
          { field: "Plan", oldValue: "free", newValue: "pro_supporter" },
          { field: "Daily scan limit", oldValue: "25", newValue: "500" },
        ],
        timestamp: WHEN,
      }),
    },
  ];
}
