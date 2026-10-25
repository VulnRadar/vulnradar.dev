import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { withErrorHandling } from "@/lib/api/api-utils";
import {
  CONTACT_EMAIL_STATUSES,
  countContactSubmissions,
  listContactSubmissions,
  type ContactEmailStatus,
} from "@/lib/support/contact-submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v3/admin/contact-submissions
 *
 * The contact form's inbox. Every message from /contact is stored before
 * anything is emailed, and the staff email is only a pointer to it ("New
 * contact submission #123"), so this is where the message itself is read. It
 * also shows whether that pointer ever went out: `email_status` and
 * `email_error` are the record of a notification a mail filter ate.
 *
 * Same gate as the ticket inbox it sits beside (MANAGE_SUPPORT_TICKETS).
 *
 * Query:
 *   status  pending | sent | failed. Default: all of them.
 *   before  the `nextBefore` of the previous page (a submission id).
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const staff = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
  );
  if (!staff) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const params = request.nextUrl.searchParams;
  const statusParam = params.get("status");
  const status =
    statusParam &&
    CONTACT_EMAIL_STATUSES.includes(statusParam as ContactEmailStatus)
      ? (statusParam as ContactEmailStatus)
      : null;

  const beforeParam = params.get("before");
  let before: number | null = null;
  if (beforeParam) {
    before = Number.parseInt(beforeParam, 10);
    if (!Number.isInteger(before) || before <= 0) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
  }

  // Counts describe the whole table, not the page, so they are only worth
  // fetching with the first one.
  const [page, counts] = await Promise.all([
    listContactSubmissions({ status, before }),
    before === null ? countContactSubmissions() : null,
  ]);

  return NextResponse.json({
    submissions: page.submissions,
    nextBefore: page.nextBefore,
    ...(counts ? { counts } : {}),
  });
});
