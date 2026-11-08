import pool from "@/lib/database/db";
import { OAUTH_IDENTITY_COLUMNS } from "@/lib/auth/auth";

/**
 * Whether linking this identity would put somebody else's sign-in into the
 * columns a password reset leaves alone.
 *
 * reset-password evicts every linked provider except the one named by
 * users.auth_provider, on the reasoning that it created the account and so is
 * the owner's. That holds only while nothing else can get into those columns,
 * and the link callbacks wrote them unconditionally: anyone past the link
 * re-authentication could replace the identity, or disconnect it and link
 * their own, and the owner's next reset would keep theirs.
 *
 * So the creating provider's columns take the identity already there, or one
 * whose verified email is the account's address, which is the proof the
 * sign-in backfill asks for before it fills an empty column. Every other
 * provider's columns are not kept by a reset and stay unconstrained.
 */
export async function linkWouldTakeCreatingSlot(
  userId: number,
  provider: string,
  identity: { id: string; email?: string | null; emailVerified: boolean },
): Promise<boolean> {
  const column = OAUTH_IDENTITY_COLUMNS[provider]?.id;
  if (!column) return false;

  // column comes from the fixed map, never from the request.
  const { rows } = await pool.query<{
    auth_provider: string | null;
    email: string;
    linked_id: string | null;
  }>(
    `SELECT auth_provider, email, ${column} AS linked_id FROM users WHERE id = $1`,
    [userId],
  );
  const account = rows[0];
  if (!account || account.auth_provider !== provider) return false;
  if (account.linked_id === identity.id) return false;

  const provesAddress =
    identity.emailVerified &&
    identity.email?.trim().toLowerCase() === account.email.trim().toLowerCase();
  return !provesAddress;
}
