import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { withErrorHandling } from "@/lib/api/api-utils";
import {
  decodeTicketCursor,
  isAdminTicketView,
  listAdminTickets,
  ticketQueueCounts,
} from "@/lib/support/admin-ticket-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v3/admin/support-tickets
 *
 * Staff inbox: every user's support ticket, newest activity first. Gated on
 * MANAGE_SUPPORT_TICKETS (support role and up). Reading/replying to an
 * individual ticket goes through /api/v3/support-tickets/[id], which admits
 * staff too.
 *
 * Query:
 *   status  one of TICKET_STATUSES, or "all". Default: everything still open,
 *           so the queue shows what needs attention.
 *   q       subject or owner email (a literal substring), or "#<id>".
 *   mine    "1" for only the tickets assigned to the caller.
 *   before  the `nextCursor` of the previous page. Pages are 50 tickets,
 *           newest activity first, so the list is complete however long it is
 *           instead of stopping at the first 200.
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
  // An unknown status falls back to the default queue rather than 400ing, as
  // it always has: the chips are the only caller and they only send known ones.
  const view =
    statusParam && isAdminTicketView(statusParam) ? statusParam : "active";

  const beforeParam = params.get("before");
  const cursor = beforeParam ? decodeTicketCursor(beforeParam) : null;
  if (beforeParam && !cursor) {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }

  // perf: the GROUP BY count reads every support_tickets row and does not
  // depend on the listing, so it used to add a second full pass in series
  // with the page query on every inbox load. Independent queries, one wait.
  // A page past the first needs no counts, and skips the second query.
  const [page, queue] = await Promise.all([
    listAdminTickets({
      view,
      q: params.get("q"),
      assignedTo: params.get("mine") === "1" ? staff.userId : null,
      cursor,
    }),
    cursor ? null : ticketQueueCounts(staff.userId),
  ]);

  return NextResponse.json({
    tickets: page.tickets,
    nextCursor: page.nextCursor,
    ...(queue ? { counts: queue.counts, mine: queue.mine } : {}),
  });
});
