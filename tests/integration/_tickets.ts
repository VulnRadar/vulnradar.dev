import pool from "@/lib/database/db";

/**
 * A support ticket row, written straight to the table so a test controls the
 * columns the code under test orders and counts by. Shared by the suites that
 * read tickets back through the inbox query and the abuse cap.
 */
export interface SeedTicket {
  subject: string;
  /** Written as given, so a test controls the ordering key exactly. */
  lastMessageAt: string;
  status?: string;
  assignedTo?: number | null;
  updatedAt?: string;
}

export async function seedTicket(
  userId: number,
  t: SeedTicket,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO support_tickets
       (user_id, subject, category, status, assigned_to, last_message_at, updated_at)
     VALUES ($1, $2, 'other', $3, $4, $5::timestamptz, COALESCE($6::timestamptz, NOW()))
     RETURNING id`,
    [
      userId,
      t.subject,
      t.status ?? "open",
      t.assignedTo ?? null,
      t.lastMessageAt,
      t.updatedAt ?? null,
    ],
  );
  return rows[0].id;
}
