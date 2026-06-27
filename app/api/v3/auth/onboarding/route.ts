import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  await pool.query(
    "UPDATE users SET onboarding_completed = true WHERE id = $1",
    [session.userId],
  );

  return NextResponse.json({ success: true });
}
