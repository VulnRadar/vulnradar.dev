import { NextResponse } from "next/server";
import pool from "@/lib/database/db";

// Only show actual staff roles on staff page
// beta_tester is now a badge, not a staff role
const STAFF_ROLES_FOR_DISPLAY = ["admin", "moderator", "support"];

export async function GET() {
  try {
    // privacy: minimal exposure — return only display name + role. No
    // avatar, no email, no created_at ordering (which would leak
    // seniority / hiring order).
    // when name is null.
    const result = await pool.query(
      `SELECT name, role FROM users
       WHERE role = ANY($1)`,
      [STAFF_ROLES_FOR_DISPLAY],
    );

    const staff = result.rows.map((row) => ({
      displayName: row.name || "Staff Member",
      role: row.role,
    }));

    return NextResponse.json({ staff });
  } catch (err) {
    console.error("[staff] list failed:", err);
    return NextResponse.json({ staff: [] }, { status: 500 });
  }
}
