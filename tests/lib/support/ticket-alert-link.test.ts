/**
 * The staff alert's button opens the ticket it is about.
 *
 * Uses the real template (the sibling ticket-notify suite fakes it) so the
 * assertion is on the link a staffer actually receives.
 */
import { describe, it, expect, vi } from "vitest";
import { VALID_TABS } from "@/components/admin/nav";
import { INBOX_TICKET_PARAM } from "@/lib/support/inbox-deep-link";

vi.mock("server-only", () => ({}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: async () => ({ rows: [] }) },
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: vi.fn() }) },
}));

const { supportTicketStaffAlertEmail } = await import("@/lib/email/email");
const { staffTicketUrl } = await import("@/lib/support/ticket-notify");
const { SUPPORT_EMAIL } = await import("@/lib/config/constants");

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  };
});

const { notifyStaffOfTicketActivity } =
  await import("@/lib/support/ticket-notify");

const alert = {
  ticketId: 3182,
  subject: "Scheduled scan stopped running",
  category: "scanning" as const,
  fromEmail: "dana@example.dev",
  body: "The nightly sweep has not produced a report.",
  isNew: false,
};

describe("staffTicketUrl", () => {
  it("names the support tab and the ticket", () => {
    const url = new URL(staffTicketUrl(3182));
    expect(url.pathname).toBe("/admin");
    expect(url.searchParams.get("tab")).toBe("support-tickets");
    expect(url.searchParams.get(INBOX_TICKET_PARAM)).toBe("3182");
    expect(VALID_TABS).toContain(url.searchParams.get("tab"));
  });
});

describe("the staff alert for a ticket", () => {
  it("links the thread in both the text and the HTML button", async () => {
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);

    await notifyStaffOfTicketActivity(alert);

    const sent = mockSendEmail.mock.calls[0][0];
    const link = staffTicketUrl(3182);
    expect(sent.text).toContain(link);
    // The HTML escapes the ampersand in an attribute.
    expect(sent.html).toContain(link.replace(/&/g, "&amp;"));
  });

  it("goes to the support mailbox", async () => {
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);

    await notifyStaffOfTicketActivity(alert);

    expect(mockSendEmail.mock.calls[0][0].to).toBe(SUPPORT_EMAIL);
  });

  it("still opens the plain queue when the template is given no link", () => {
    const mail = supportTicketStaffAlertEmail(alert);
    expect(mail.text).toContain("/admin?tab=support-tickets");
    expect(mail.text).not.toContain(`${INBOX_TICKET_PARAM}=`);
  });
});
