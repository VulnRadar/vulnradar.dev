import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  ADMIN_TICKET_PAGE_SIZE,
  decodeTicketCursor,
  listAdminTickets,
  ticketQueueCounts,
  type AdminTicketFilter,
} from "@/lib/support/admin-ticket-list";
import { describeIntegration, createUser, unique } from "./_db";
import { seedTicket } from "./_tickets";

/**
 * The staff ticket inbox, against the real schema.
 *
 * The unit tier fakes pool.query, so it can compare the SQL text and nothing
 * else. Everything worth claiming here is a claim about what PostgreSQL does
 * with it: that a cursor round-trips at microsecond precision, that the
 * row-value comparison neither repeats nor skips a ticket, and that a % in the
 * search box is a literal.
 */

/** Every page of a listing, followed through its cursors. */
async function collect(filter: AdminTicketFilter): Promise<number[][]> {
  const pages: number[][] = [];
  let cursor = filter.cursor ?? null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await listAdminTickets({ ...filter, cursor });
    pages.push(page.tickets.map((t) => t.id));
    if (!page.nextCursor) return pages;
    cursor = decodeTicketCursor(page.nextCursor);
    expect(cursor).not.toBeNull();
  }
  throw new Error("pagination did not terminate");
}

describeIntegration("the staff ticket inbox", () => {
  it("pages through every ticket once, in order, even when many share a timestamp", async () => {
    const owner = await createUser();
    const tag = unique("page");
    // Five tickets with the SAME last_message_at: only the id tiebreak keeps a
    // page boundary from repeating or skipping them.
    const same = "2026-03-01 10:00:00.500000+00";
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await seedTicket(owner.id, {
          subject: `${tag} same`,
          lastMessageAt: same,
        }),
      );
    }
    // And two more, newer and older, so the order across timestamps is real.
    ids.push(
      await seedTicket(owner.id, {
        subject: `${tag} newer`,
        lastMessageAt: "2026-03-02 10:00:00+00",
      }),
    );
    ids.push(
      await seedTicket(owner.id, {
        subject: `${tag} older`,
        lastMessageAt: "2026-02-01 10:00:00+00",
      }),
    );

    const pages = await collect({ view: "all", q: tag, limit: 3 });
    const flat = pages.flat();

    // Complete, and no ticket twice.
    expect([...flat].sort((a, b) => a - b)).toEqual(
      [...ids].sort((a, b) => a - b),
    );
    expect(new Set(flat).size).toBe(flat.length);
    expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);

    // Newest activity first, ties broken by id descending.
    const rows = await pool.query<{ id: number }>(
      `SELECT id FROM support_tickets WHERE subject LIKE $1
        ORDER BY last_message_at DESC, id DESC`,
      [`${tag}%`],
    );
    expect(flat).toEqual(rows.rows.map((r) => r.id));
  });

  it("does not skip tickets that differ only below the millisecond", async () => {
    // A JavaScript Date holds milliseconds and the column holds microseconds,
    // so a cursor carried as a Date would resume at .123 and drop the rows
    // at .123456 and .123789. The cursor carries Postgres's own text.
    const owner = await createUser();
    const tag = unique("micro");
    const a = await seedTicket(owner.id, {
      subject: `${tag} a`,
      lastMessageAt: "2026-04-01 09:00:00.123789+00",
    });
    const b = await seedTicket(owner.id, {
      subject: `${tag} b`,
      lastMessageAt: "2026-04-01 09:00:00.123456+00",
    });
    const c = await seedTicket(owner.id, {
      subject: `${tag} c`,
      lastMessageAt: "2026-04-01 09:00:00.123100+00",
    });

    const pages = await collect({ view: "all", q: tag, limit: 1 });
    expect(pages).toEqual([[a], [b], [c]]);
  });

  it("gives a full page a cursor only when there is more", async () => {
    const owner = await createUser();
    const tag = unique("exact");
    for (let i = 0; i < 2; i++) {
      await seedTicket(owner.id, {
        subject: `${tag} ${i}`,
        lastMessageAt: `2026-05-0${i + 1} 00:00:00+00`,
      });
    }
    const exact = await listAdminTickets({ view: "all", q: tag, limit: 2 });
    expect(exact.tickets).toHaveLength(2);
    expect(exact.nextCursor).toBeNull();

    const short = await listAdminTickets({ view: "all", q: tag, limit: 1 });
    expect(short.tickets).toHaveLength(1);
    expect(short.nextCursor).not.toBeNull();
  });

  it("uses the shipped page size by default", async () => {
    const page = await listAdminTickets({ view: "all" });
    expect(page.tickets.length).toBeLessThanOrEqual(ADMIN_TICKET_PAGE_SIZE);
  });

  it("searches the subject, the owner's email, and the ticket number", async () => {
    const owner = await createUser();
    const other = await createUser();
    const tag = unique("find");
    const bySubject = await seedTicket(owner.id, {
      subject: `${tag} refund please`,
      lastMessageAt: "2026-06-01 00:00:00+00",
    });
    const byOther = await seedTicket(other.id, {
      subject: "unrelated",
      lastMessageAt: "2026-06-02 00:00:00+00",
    });

    const subjectHit = await listAdminTickets({
      view: "all",
      q: `${tag} refund`,
    });
    expect(subjectHit.tickets.map((t) => t.id)).toEqual([bySubject]);

    const emailHit = await listAdminTickets({ view: "all", q: other.email });
    expect(emailHit.tickets.map((t) => t.id)).toContain(byOther);
    expect(emailHit.tickets.map((t) => t.id)).not.toContain(bySubject);

    for (const q of [String(byOther), `#${byOther}`]) {
      const idHit = await listAdminTickets({ view: "all", q });
      expect(idHit.tickets.map((t) => t.id)).toContain(byOther);
    }
  });

  it("treats % and _ in the search as literal characters", async () => {
    const owner = await createUser();
    const tag = unique("lit");
    const percent = await seedTicket(owner.id, {
      subject: `${tag} 100% sure`,
      lastMessageAt: "2026-07-01 00:00:00+00",
    });
    await seedTicket(owner.id, {
      subject: `${tag} 100 times sure`,
      lastMessageAt: "2026-07-02 00:00:00+00",
    });
    const underscore = await seedTicket(owner.id, {
      subject: `${tag} a_b`,
      lastMessageAt: "2026-07-03 00:00:00+00",
    });
    await seedTicket(owner.id, {
      subject: `${tag} axb`,
      lastMessageAt: "2026-07-04 00:00:00+00",
    });

    // Unescaped, "100%" would match "100 times" and "a_b" would match "axb".
    const p = await listAdminTickets({ view: "all", q: `${tag} 100% s` });
    expect(p.tickets.map((t) => t.id)).toEqual([percent]);
    const u = await listAdminTickets({ view: "all", q: `${tag} a_b` });
    expect(u.tickets.map((t) => t.id)).toEqual([underscore]);

    // A bare % is a literal percent sign, not "everything".
    const bare = await listAdminTickets({ view: "all", q: `${tag}%` });
    expect(bare.tickets).toEqual([]);
  });

  it("filters to one staffer's assignments, and by view", async () => {
    const owner = await createUser();
    const staffA = await createUser({ role: "support" });
    const staffB = await createUser({ role: "support" });
    const tag = unique("mine");
    const mineOpen = await seedTicket(owner.id, {
      subject: `${tag} 1`,
      lastMessageAt: "2026-08-01 00:00:00+00",
      assignedTo: staffA.id,
    });
    const mineClosed = await seedTicket(owner.id, {
      subject: `${tag} 2`,
      lastMessageAt: "2026-08-02 00:00:00+00",
      assignedTo: staffA.id,
      status: "closed",
    });
    await seedTicket(owner.id, {
      subject: `${tag} 3`,
      lastMessageAt: "2026-08-03 00:00:00+00",
      assignedTo: staffB.id,
    });
    await seedTicket(owner.id, {
      subject: `${tag} 4`,
      lastMessageAt: "2026-08-04 00:00:00+00",
    });

    const active = await listAdminTickets({
      view: "active",
      q: tag,
      assignedTo: staffA.id,
    });
    expect(active.tickets.map((t) => t.id)).toEqual([mineOpen]);
    expect(active.tickets[0].assigned_to).toBe(staffA.id);

    const all = await listAdminTickets({
      view: "all",
      q: tag,
      assignedTo: staffA.id,
    });
    expect(all.tickets.map((t) => t.id)).toEqual([mineClosed, mineOpen]);

    const closedOnly = await listAdminTickets({ view: "closed", q: tag });
    expect(closedOnly.tickets.map((t) => t.id)).toEqual([mineClosed]);
  });

  it("counts a staffer's own assignments among ACTIVE tickets only", async () => {
    const owner = await createUser();
    const staff = await createUser({ role: "support" });
    const tag = unique("cnt");
    const before = await ticketQueueCounts(staff.id);
    await seedTicket(owner.id, {
      subject: `${tag} open`,
      lastMessageAt: "2026-09-01 00:00:00+00",
      assignedTo: staff.id,
    });
    await seedTicket(owner.id, {
      subject: `${tag} done`,
      lastMessageAt: "2026-09-02 00:00:00+00",
      assignedTo: staff.id,
      status: "resolved",
    });
    const after = await ticketQueueCounts(staff.id);
    expect(after.mine - before.mine).toBe(1);
    expect((after.counts.open ?? 0) - (before.counts.open ?? 0)).toBe(1);
    expect((after.counts.resolved ?? 0) - (before.counts.resolved ?? 0)).toBe(
      1,
    );
  });

  it("puts a ticket back in the shared queue when its assignee's account is deleted", async () => {
    // ON DELETE SET NULL: a staff account leaving must not take the customer's
    // thread with it, and must not leave it assigned to nobody-in-particular.
    const owner = await createUser();
    const staff = await createUser({ role: "support" });
    const id = await seedTicket(owner.id, {
      subject: unique("orphan"),
      lastMessageAt: "2026-09-03 00:00:00+00",
      assignedTo: staff.id,
    });
    await pool.query("DELETE FROM users WHERE id = $1", [staff.id]);
    const { rows } = await pool.query<{ assigned_to: number | null }>(
      "SELECT assigned_to FROM support_tickets WHERE id = $1",
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].assigned_to).toBeNull();
  });
});
