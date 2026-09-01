import { randomBytes, createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { STAFF_INVITE_EXPIRY_DAYS } from "@/lib/config/constants";

/**
 * Staff invite-by-email (AUDIT-010 admin-feature-gap): lets an admin invite
 * someone straight into a staff role by email, instead of requiring them to
 * self-register first and be promoted separately afterward.
 *
 * See app/api/v3/admin/staff-invites/route.ts (POST, admin-gated: create +
 * send) and app/api/v3/auth/staff-invite/[token]/route.ts (public GET to
 * validate a token, POST to accept it).
 *
 * Table shape mirrors team_invites (see instrumentation.ts's TEAMS block):
 * a token, the target email/role, who sent it, and a lifecycle
 * (created_at -> expires_at -> accepted_at). Like team_invites.token, the
 * `token` column here stores the SHA-256 hash of the emailed value, never
 * the plaintext -- see hashStaffInviteToken below and every other
 * emailed-token table in this codebase (password_reset_tokens,
 * email_verification_tokens, team_invites).
 *
 * This is the schema owner for staff_invites. instrumentation.ts calls it
 * once at boot (see its STAFF INVITES + ADMIN AUDIT LOG ARCHIVE block) and
 * scripts/_lib/_lib.schema-parity.mjs parses the DDL below out of this file
 * as part of the canonical schema, so the table is covered by the
 * boot/migration parity guard exactly like an inline CREATE TABLE would be.
 * Nothing on a request path calls it: the table exists before the first
 * request, so re-running DDL per request would be pure catalog churn
 * (AUDIT-013 schema-02).
 *
 * No separate index on `token`: the UNIQUE constraint above already is a
 * unique b-tree on that column, so a CREATE INDEX on it would be a second
 * copy of an index the database maintains anyway (AUDIT-013 schema-05).
 * The name is in instrumentation.ts's REDUNDANT_INDEXES so databases that
 * grew it before this shed it on the next boot.
 */
export async function ensureStaffInvitesTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_invites (
      id SERIAL PRIMARY KEY,
      token VARCHAR(64) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL,
      invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      accepted_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_staff_invites_email ON staff_invites(email);
  `);
}

/** 256 bits of entropy, hex-encoded -- same shape as team_invites' token
 *  (see app/api/v3/teams/members/route.ts). */
export function generateStaffInviteToken(): string {
  return randomBytes(32).toString("hex");
}

/** Hash a plaintext invite token the same way at creation and lookup time,
 *  so the plaintext is never compared against (or stored in) the DB. */
export function hashStaffInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function staffInviteExpiresAt(): Date {
  return new Date(Date.now() + STAFF_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}
