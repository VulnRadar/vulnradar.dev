import { it, expect } from "vitest";
import {
  countTicketsAgainstCap,
  MAX_OPEN_TICKETS_PER_USER,
} from "@/lib/support/ticket-limits";
import { describeIntegration, createUser, unique } from "./_db";
import { seedTicket } from "./_tickets";

/**
 * The per-account ticket cap, against the real schema.
 *
 * The cap used to count open tickets only, so open-close-open never moved it.
 * The unit tier fakes pool.query and can only compare the SQL text; whether a
 * ticket closed a minute ago still holds its slot, and one closed two days ago
 * does not, is a claim about what PostgreSQL does with the window.
 */
describeIntegration("the per-account ticket cap", () => {
  it("keeps counting a ticket for a day after it is closed, then lets the slot go", async () => {
    const owner = await createUser();
    const tag = unique("cap");
    await seedTicket(owner.id, {
      subject: `${tag} open`,
      lastMessageAt: "2026-10-01 00:00:00+00",
      status: "awaiting_user",
    });
    // Closed just now: still holds a slot. This is the open-close-open loop.
    await seedTicket(owner.id, {
      subject: `${tag} closed now`,
      lastMessageAt: "2026-10-01 00:00:00+00",
      status: "closed",
    });
    await seedTicket(owner.id, {
      subject: `${tag} resolved now`,
      lastMessageAt: "2026-10-01 00:00:00+00",
      status: "resolved",
    });
    // Closed two days ago: the slot is free again.
    await seedTicket(owner.id, {
      subject: `${tag} closed long ago`,
      lastMessageAt: "2026-10-01 00:00:00+00",
      status: "closed",
      updatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    });

    expect(await countTicketsAgainstCap(owner.id)).toBe(3);
  });

  it("counts only the asking account's tickets", async () => {
    const owner = await createUser();
    const bystander = await createUser();
    await seedTicket(bystander.id, {
      subject: unique("not-yours"),
      lastMessageAt: "2026-10-02 00:00:00+00",
    });
    expect(await countTicketsAgainstCap(owner.id)).toBe(0);
  });

  it("reaches the cap by opening and closing tickets, which the open-only count never did", async () => {
    const owner = await createUser();
    for (let i = 0; i < MAX_OPEN_TICKETS_PER_USER; i++) {
      await seedTicket(owner.id, {
        subject: unique("loop"),
        lastMessageAt: "2026-10-03 00:00:00+00",
        status: "closed",
      });
    }
    expect(await countTicketsAgainstCap(owner.id)).toBeGreaterThanOrEqual(
      MAX_OPEN_TICKETS_PER_USER,
    );
  });
});
