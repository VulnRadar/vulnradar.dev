import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { scheduleCreatedEmail, scheduleDeletedEmail } from "@/lib/email/email";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { getClientIp } from "@/lib/api/request-utils";

const FREQ_INTERVALS: Record<string, string> = {
  daily: "1 day",
  weekly: "7 days",
  monthly: "30 days",
};

const FREQ_INTERVALS_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

// H-2: cap URL length on scheduled scans to prevent DoS / log abuse.
const MAX_SCHEDULE_URL_LENGTH = 2048;

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const result = await pool.query(
    "SELECT id, url, frequency, active, last_run_at, next_run_at, created_at FROM scheduled_scans WHERE user_id = $1 ORDER BY created_at DESC",
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

  const { url, frequency } = await request.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  if (url.length > MAX_SCHEDULE_URL_LENGTH) {
    return NextResponse.json(
      { error: `URL exceeds maximum length of ${MAX_SCHEDULE_URL_LENGTH}` },
      { status: 400 },
    );
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // H-2: validate the URL is a public HTTP(S) target before storing it.
  // The scheduled scan worker (future) will fetch this URL — we must not
  // allow private/loopback/link-local/metadata targets.
  const targetCheck = await validateScanTarget(url);
  if (!targetCheck.safe) {
    return NextResponse.json(
      { error: targetCheck.reason || "URL blocked" },
      { status: 400 },
    );
  }

  const freq = frequency && FREQ_INTERVALS[frequency] ? frequency : "weekly";
  const intervalDays = FREQ_INTERVALS_DAYS[freq];

  // Max 10 scheduled scans per user
  const countRes = await pool.query(
    "SELECT COUNT(*)::int as count FROM scheduled_scans WHERE user_id = $1",
    [session.userId],
  );
  if (countRes.rows[0].count >= 10) {
    return NextResponse.json(
      { error: "Maximum 10 scheduled scans allowed" },
      { status: 400 },
    );
  }

  const result = await pool.query(
    `INSERT INTO scheduled_scans (user_id, url, frequency, next_run_at)
     VALUES ($1, $2, $3, NOW() + make_interval(days => $4))
     RETURNING id, url, frequency, active, last_run_at, next_run_at, created_at`,
    [session.userId, url, freq, intervalDays],
  );

  // Send notification email
  // SECURITY-AUDIT-2026-06-28 / M-7: trusted client IP only.
  const ip = (await getClientIp()) || "Unknown";
  const userAgent = request.headers.get("user-agent") || "Unknown";
  const emailContent = scheduleCreatedEmail(url, freq, {
    ipAddress: ip,
    userAgent,
  });

  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "schedules",
    emailContent,
  }).catch((err) =>
    console.error("Failed to send schedule created notification:", err),
  );

  return NextResponse.json(result.rows[0], { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id } = await request.json();

  // Get schedule details before deleting for the email
  const scheduleResult = await pool.query(
    "SELECT url FROM scheduled_scans WHERE id = $1 AND user_id = $2",
    [id, session.userId],
  );

  await pool.query(
    "DELETE FROM scheduled_scans WHERE id = $1 AND user_id = $2",
    [id, session.userId],
  );

  // Send notification email if schedule was found
  if (scheduleResult.rows.length > 0) {
    // SECURITY-AUDIT-2026-06-28 / M-7: trusted client IP only.
    const ip = (await getClientIp()) || "Unknown";
    const userAgent = request.headers.get("user-agent") || "Unknown";
    const emailContent = scheduleDeletedEmail(scheduleResult.rows[0].url, {
      ipAddress: ip,
      userAgent,
    });

    sendNotificationEmail({
      userId: session.userId,
      userEmail: session.email,
      type: "schedules",
      emailContent,
    }).catch((err) =>
      console.error("Failed to send schedule deleted notification:", err),
    );
  }

  return NextResponse.json({ success: true });
}
