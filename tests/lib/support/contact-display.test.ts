import { describe, it, expect } from "vitest";
import {
  CONTACT_PENDING_STALE_MS,
  contactEmailState,
} from "@/lib/support/contact-display";

/**
 * The contact inbox's wording for "did the staff email go out". The message
 * itself is stored before any mail is sent, so this is the only signal on the
 * screen that a pointer to it never arrived.
 */
describe("contactEmailState", () => {
  const created = "2026-10-25T12:00:00.000Z";
  const at = (ms: number) => new Date(created).getTime() + ms;

  it("says the staff email went out", () => {
    expect(
      contactEmailState({ email_status: "sent", created_at: created }, at(0)),
    ).toEqual({ tone: "ok", label: "Staff emailed" });
  });

  it("says plainly when it did not", () => {
    expect(
      contactEmailState({ email_status: "failed", created_at: created }, at(0)),
    ).toEqual({ tone: "crit", label: "Email failed" });
  });

  it("calls a fresh pending row a send in progress", () => {
    expect(
      contactEmailState(
        { email_status: "pending", created_at: created },
        at(30_000),
      ),
    ).toEqual({ tone: "info", label: "Sending" });
  });

  it("does not leave a pending row reading 'Sending' forever", () => {
    // A row is written pending before the send and settled after it. One still
    // pending long after means the process died in between, and the message may
    // have reached nobody's inbox.
    expect(
      contactEmailState(
        { email_status: "pending", created_at: created },
        at(CONTACT_PENDING_STALE_MS + 1),
      ),
    ).toEqual({ tone: "warn", label: "Send never finished" });
  });

  it("keeps a row exactly at the threshold as still sending", () => {
    expect(
      contactEmailState(
        { email_status: "pending", created_at: created },
        at(CONTACT_PENDING_STALE_MS),
      ).label,
    ).toBe("Sending");
  });

  it("never marks a sent or failed row stale, however old", () => {
    const week = 7 * 24 * 3600 * 1000;
    expect(
      contactEmailState({ email_status: "sent", created_at: created }, at(week))
        .tone,
    ).toBe("ok");
    expect(
      contactEmailState(
        { email_status: "failed", created_at: created },
        at(week),
      ).tone,
    ).toBe("crit");
  });
});
