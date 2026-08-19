import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/constants";
import { getClientIp } from "@/lib/api/request-utils";

// POST - Update staff member's activity heartbeat
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Verify user is staff
    const userResult = await pool.query(
      "SELECT role FROM users WHERE id = $1",
      [session.userId],
    );
    const user = userResult.rows[0];
    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const role = user.role || "user";
    if (
      (STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.support || 1)
    ) {
      return NextResponse.json(
        { error: "Not authorized as staff" },
        { status: 403 },
      );
    }

    let section = "dashboard";
    try {
      const body = await request.json();
      if (body?.section && typeof body.section === "string")
        section = body.section.slice(0, 100);
    } catch {
      // No body or invalid JSON - use default section
    }
    const ip = await getClientIp();
    const userAgent = request.headers.get("user-agent") || "unknown";

    // Update or insert activity record
    const result = await pool.query(
      `INSERT INTO staff_activity (user_id, last_heartbeat, current_section, ip_address, user_agent, updated_at)
       VALUES ($1, NOW(), $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         last_heartbeat = NOW(),
         current_section = $2,
         ip_address = $3,
         user_agent = $4,
         updated_at = NOW()
       RETURNING user_id, last_heartbeat, current_section`,
      [session.userId, section || "dashboard", ip, userAgent],
    );

    return NextResponse.json({
      success: true,
      activity: {
        ...result.rows[0],
        is_active: true, // Just sent heartbeat, so is active
      },
    });
  } catch (error) {
    console.error("[Admin Activity] Heartbeat error:", error);
    return NextResponse.json(
      { error: "Failed to update activity" },
      { status: 500 },
    );
  }
}
