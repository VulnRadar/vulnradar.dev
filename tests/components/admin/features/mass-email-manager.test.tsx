/**
 * The broadcast composer must not describe its default audience as unfiltered.
 *
 * Its default category read "No filter (everyone in segment)", and the server
 * did exactly that: no preference check, so the Unsubscribe link in one
 * broadcast did not stop the next. The server now gates every audience but a
 * single named address on Product Updates, and the composer has to say so,
 * or an admin picks the default believing it reaches people who opted out.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MassEmailManager,
  audienceFilterNote,
  audienceLabel,
  deliverySummary,
  sendConfirmCopy,
  type Broadcast,
} from "@/components/admin/features/mass-email-manager";

describe("audienceFilterNote", () => {
  it("names Product Updates for a segment sent with no category", () => {
    for (const segment of ["all", "premium", "free"]) {
      expect(audienceFilterNote(segment, "none")).toBe(
        "Only users who have not turned off Product Updates.",
      );
    }
  });

  it("names the chosen category when there is one", () => {
    expect(audienceFilterNote("all", "email_tips_guides")).toBe(
      "Only users opted into Tips & Guides.",
    );
    expect(audienceFilterNote("specific", "email_tips_guides")).toBe(
      "Only users opted into Tips & Guides.",
    );
  });

  it("says a single address is sent regardless of preferences, but not to a disabled account", () => {
    const note = audienceFilterNote("specific", "none");
    expect(note).toMatch(/whatever this address's email preferences are/);
    expect(note).toMatch(/disabled account is still skipped/);
  });
});

describe("MassEmailManager composer", () => {
  const html = renderToStaticMarkup(<MassEmailManager />);

  it("no longer offers a category that reads as everyone in the segment", () => {
    expect(html).not.toMatch(/everyone in segment/i);
    expect(html).not.toMatch(/No filter/);
    expect(html).toContain(
      '<option value="none" selected="">General announcement (Product Updates opt-ins)</option>',
    );
  });

  it("states the preference gate under the default All Users audience", () => {
    expect(html).toContain("Every verified, active account, free and paid.");
    expect(html).toContain(
      "Only users who have not turned off Product Updates.",
    );
  });

  // The admin tab description says a resend "retries the recipients that
  // failed and reaches anyone who joined the audience since". The panel used
  // to say it went to the whole audience again, which it never did.
  it("describes a resend the way it behaves", () => {
    expect(html).toContain(
      "A resend retries the deliveries that failed and reaches anyone who joined the audience since.",
    );
    expect(html).not.toMatch(/whole audience again/);
  });
});

describe("audienceLabel", () => {
  it("names a segment, a single address and a category the way the composer did", () => {
    expect(audienceLabel(null)).toBe("All Users");
    expect(audienceLabel({ segment: "premium" })).toBe("All Premium Users");
    expect(audienceLabel({ segment: "email:a@example.com" })).toBe(
      "a@example.com",
    );
    expect(
      audienceLabel({ segment: "free", preference_col: "email_tips_guides" }),
    ).toBe("Free Users, Tips & Guides opt-ins");
  });
});

describe("deliverySummary", () => {
  const base: Broadcast = {
    id: "1",
    title: "T",
    status: "sent",
    created_at: "2026-10-01T00:00:00Z",
  };

  it("says nothing for a draft", () => {
    expect(deliverySummary({ ...base, status: "draft" })).toBeNull();
  });

  it("names delivered and failed for a sent broadcast", () => {
    expect(deliverySummary({ ...base, sent_count: 1, failed_count: 0 })).toBe(
      "Delivered to 1 recipient",
    );
    expect(deliverySummary({ ...base, sent_count: 4, failed_count: 2 })).toBe(
      "Delivered to 4 recipients, 2 failed",
    );
    expect(deliverySummary({ ...base, sent_count: 0 })).toBe(
      "Delivered to nobody",
    );
  });

  it("reports progress while sending", () => {
    expect(deliverySummary({ ...base, state: "sending", sent_count: 3 })).toBe(
      "Sending: 3 delivered so far",
    );
  });
});

describe("sendConfirmCopy", () => {
  const draft: Broadcast = {
    id: "1",
    title: "Hello",
    status: "draft",
    created_at: "2026-10-01T00:00:00Z",
    segment_filter: { segment: "all" },
  };
  const sentOne: Broadcast = { ...draft, status: "sent", state: "sent" };
  const counts = {
    audience: 5,
    newRecipients: 5,
    failed: 0,
    alreadySent: 0,
    pending: 0,
    toReach: 5,
  };

  it("offers nothing to confirm until the recipients are counted", () => {
    expect(sendConfirmCopy(draft, null).changes).toEqual([]);
  });

  it("names the number a send will reach", () => {
    const copy = sendConfirmCopy(draft, counts);
    expect(copy.description).toContain("emails 5 people");
    expect(copy.changes).toContainEqual(
      expect.objectContaining({
        label: "Recipients",
        newValue: "5 recipients",
      }),
    );
  });

  it("has nothing to confirm for an empty audience", () => {
    const copy = sendConfirmCopy(draft, {
      ...counts,
      audience: 0,
      newRecipients: 0,
      toReach: 0,
    });
    expect(copy.changes).toEqual([]);
    expect(copy.description).toMatch(/Nobody in this audience/);
  });

  it("describes a resend as a retry plus newcomers, never as everyone again", () => {
    const copy = sendConfirmCopy(sentOne, {
      ...counts,
      newRecipients: 1,
      failed: 1,
      alreadySent: 3,
      toReach: 2,
    });
    expect(copy.description).toContain("retries 1 failed delivery");
    expect(copy.description).toContain("mails 1 person who joined");
    expect(copy.description).toContain("3 recipients who already have it");
    expect(copy.description).not.toMatch(/everyone|again, including/i);
  });

  it("has nothing to confirm when a resend would reach nobody", () => {
    const copy = sendConfirmCopy(sentOne, {
      ...counts,
      newRecipients: 0,
      alreadySent: 5,
      toReach: 0,
    });
    expect(copy.changes).toEqual([]);
    expect(copy.description).toMatch(/Nothing to resend/);
  });

  it("still lets an uncounted send through to the server's own check", () => {
    expect(sendConfirmCopy(draft, "error").changes).toHaveLength(1);
  });
});
