import { describe, it, expect } from "vitest";
import {
  OPEN_TICKET_STATUSES,
  STAFF_TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_NEXT,
  type TicketStatus,
} from "@/lib/support/ticket-constants";

/**
 * These guard a copy rule, not a code path, which is why they are worth
 * having: a ticket thread draws the status badge and the "what happens next"
 * strip a couple of lines apart, and a closed ticket used to announce itself
 * in both plus a third time in place of the reply box. The rule the owner drew
 * from that is general: never state the same fact twice in one view. Nothing
 * else in the suite would notice the next person writing "Marked resolved."
 * back into the resolved sentence.
 */
describe("ticket status copy", () => {
  it("gives every status a requester label, a staff label and a next step", () => {
    for (const status of TICKET_STATUSES) {
      expect(TICKET_STATUS_LABELS[status]).toBeTruthy();
      expect(STAFF_TICKET_STATUS_LABELS[status]).toBeTruthy();
      expect(TICKET_STATUS_NEXT[status]).toBeTruthy();
    }
    expect(Object.keys(TICKET_STATUS_NEXT).sort()).toEqual(
      [...TICKET_STATUSES].sort(),
    );
  });

  it("never restates the badge inside the sentence next to it", () => {
    for (const status of TICKET_STATUSES) {
      const label = TICKET_STATUS_LABELS[status].toLowerCase();
      expect(TICKET_STATUS_NEXT[status].toLowerCase()).not.toContain(label);
    }
  });

  it("says what to do, so no next step is only a restatement of the state", () => {
    // Each sentence has to survive its own status word being removed, which is
    // the cheap way to say "this is an instruction, not a second badge".
    for (const status of TICKET_STATUSES) {
      const stateWord = status.split("_").pop() ?? status;
      const withoutState = TICKET_STATUS_NEXT[status]
        .toLowerCase()
        .replaceAll(stateWord, "")
        .trim();
      expect(withoutState.length).toBeGreaterThan(20);
    }
  });

  it("flips perspective for staff exactly where the requester wording would be backwards", () => {
    // awaiting_user reads "Awaiting your reply" to the requester, which on a
    // staff screen means the opposite of what is true; open and awaiting_staff
    // are one word to the requester but two different queues to staff.
    for (const status of [
      "open",
      "awaiting_staff",
      "awaiting_user",
    ] as TicketStatus[]) {
      expect(STAFF_TICKET_STATUS_LABELS[status]).not.toBe(
        TICKET_STATUS_LABELS[status],
      );
    }
    // Terminal states mean the same thing to both sides, so they must not
    // drift into two vocabularies for one state.
    for (const status of ["resolved", "closed"] as TicketStatus[]) {
      expect(STAFF_TICKET_STATUS_LABELS[status]).toBe(
        TICKET_STATUS_LABELS[status],
      );
    }
  });

  it("keeps closed terminal for the requester", () => {
    // The thread hides the reply box on exactly this set, and the POST route
    // 409s on a closed ticket. If `closed` ever joined this list the UI would
    // offer a reply box the API refuses.
    expect(OPEN_TICKET_STATUSES).not.toContain("closed");
    expect(OPEN_TICKET_STATUSES).not.toContain("resolved");
    expect([...OPEN_TICKET_STATUSES].sort()).toEqual([
      "awaiting_staff",
      "awaiting_user",
      "open",
    ]);
  });
});
