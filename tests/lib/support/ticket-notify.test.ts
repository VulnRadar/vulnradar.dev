/**
 * The mail the ticket system sends, and what it says when one cannot be sent.
 *
 * Two properties, both about what a staffer or an operator can trust:
 * the staff alert carries no Reply-To (a ticket owner's own mailbox was being
 * set as the reply target on mail sent from our domain), and a failed send is
 * logged with the ticket's id and never with an address, where it used to be
 * swallowed without a line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("@/lib/email/email", () => ({
  supportTicketStaffAlertEmail: (opts: { ticketId: number }) => ({
    subject: `Ticket #${opts.ticketId}`,
    html: "<p>staff</p>",
    text: "staff",
  }),
  supportTicketReceivedEmail: (opts: { ticketId: number }) => ({
    subject: `Received #${opts.ticketId}`,
    html: "<p>received</p>",
    text: "received",
  }),
  supportTicketReplyEmail: (opts: { ticketId: number }) => ({
    subject: `Reply #${opts.ticketId}`,
    html: "<p>reply</p>",
    text: "reply",
  }),
  supportTicketStatusChangedEmail: (opts: { ticketId: number }) => ({
    subject: `Status #${opts.ticketId}`,
    html: "<p>status</p>",
    text: "status",
  }),
}));

const mockCreateNotification = vi.fn();
vi.mock("@/lib/notifications/user-notifications", () => ({
  createUserNotification: (...args: unknown[]) =>
    mockCreateNotification(...args),
}));

const {
  notifyStaffOfTicketActivity,
  confirmTicketToUser,
  notifyUserOfStaffReply,
  notifyUserOfTicketStatus,
} = await import("@/lib/support/ticket-notify");

const OWNER_EMAIL = "owner.private@example.com";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);
  mockCreateNotification.mockReset();
  mockCreateNotification.mockResolvedValue(undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

/** Everything console.error was handed, flattened to one searchable string. */
function logged(): string {
  return errorSpy.mock.calls
    .map((call: unknown[]) =>
      call
        .map((arg) =>
          arg instanceof Error ? arg.message : JSON.stringify(arg),
        )
        .join(" "),
    )
    .join("\n");
}

describe("notifyStaffOfTicketActivity", () => {
  const opts = {
    ticketId: 42,
    subject: "Cannot scan",
    category: "scanning" as const,
    fromEmail: OWNER_EMAIL,
    body: "It hangs.",
    isNew: true,
  };

  it("sends no Reply-To, so the owner's mailbox is not a reply target on our mail", async () => {
    await notifyStaffOfTicketActivity(opts);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent).not.toHaveProperty("replyTo");
    expect(sent.subject).toBe("Ticket #42");
  });

  it("logs a failed send by ticket id, with the error, and never the address", async () => {
    const failure = new Error("550 5.7.0 Blocked by SpamAssassin");
    mockSendEmail.mockRejectedValue(failure);
    await notifyStaffOfTicketActivity(opts);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, ctx, err] = errorSpy.mock.calls[0];
    expect(message).toBe("[support] could not email staff about a ticket");
    expect(ctx).toEqual({ ticketId: 42, isNew: true });
    // The Error itself, not its message: the capture keeps a stack only for one.
    expect(err).toBe(failure);
    expect(logged()).not.toContain(OWNER_EMAIL);
  });
});

describe("confirmTicketToUser", () => {
  it("logs a failed confirmation by ticket id and never throws", async () => {
    mockSendEmail.mockRejectedValue(new Error("connection refused"));
    await expect(
      confirmTicketToUser({
        ticketId: 7,
        subject: "s",
        category: "billing",
        ownerEmail: OWNER_EMAIL,
        body: "b",
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy.mock.calls[0][0]).toBe(
      "[support] could not confirm a ticket to its owner",
    );
    expect(errorSpy.mock.calls[0][1]).toEqual({ ticketId: 7 });
    expect(logged()).not.toContain(OWNER_EMAIL);
  });
});

describe("notifyUserOfStaffReply", () => {
  const opts = {
    ticketId: 9,
    subject: "s",
    ownerUserId: 3,
    ownerEmail: OWNER_EMAIL,
    body: "b",
  };

  it("still emails when the bell notification fails, and logs the bell", async () => {
    mockCreateNotification.mockRejectedValue(new Error("notifications down"));
    await notifyUserOfStaffReply(opts);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe(
      "[support] could not create the reply notification",
    );
    expect(errorSpy.mock.calls[0][1]).toEqual({ ticketId: 9, userId: 3 });
  });

  it("logs a failed reply email by ticket and user id", async () => {
    mockSendEmail.mockRejectedValue(new Error("smtp down"));
    await notifyUserOfStaffReply(opts);
    expect(errorSpy.mock.calls[0][0]).toBe(
      "[support] could not email a ticket reply",
    );
    expect(errorSpy.mock.calls[0][1]).toEqual({ ticketId: 9, userId: 3 });
    expect(logged()).not.toContain(OWNER_EMAIL);
  });
});

describe("notifyUserOfTicketStatus", () => {
  it("logs a failed status email by ticket id and status", async () => {
    mockSendEmail.mockRejectedValue(new Error("smtp down"));
    await notifyUserOfTicketStatus({
      ticketId: 5,
      subject: "s",
      ownerEmail: OWNER_EMAIL,
      status: "closed",
    });
    expect(errorSpy.mock.calls[0][0]).toBe(
      "[support] could not email a ticket status change",
    );
    expect(errorSpy.mock.calls[0][1]).toEqual({
      ticketId: 5,
      status: "closed",
    });
    expect(logged()).not.toContain(OWNER_EMAIL);
  });

  it("is silent when the send works", async () => {
    await notifyUserOfTicketStatus({
      ticketId: 5,
      subject: "s",
      ownerEmail: OWNER_EMAIL,
      status: "resolved",
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
