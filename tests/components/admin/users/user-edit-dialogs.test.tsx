/**
 * The admin user edit dialogs, rendered: what each one shows when it opens,
 * and the pure rules behind its Save button.
 *
 * The dialog primitive renders through a portal, which renderToStaticMarkup
 * leaves empty, so it is mocked to pass its children through. What a click
 * does is covered in user-detail-panel-saves.test.tsx.
 */
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});

const {
  EditAccountDialog,
  ChangeStaffRoleDialog,
  EditBadgesDialog,
  EditNoteDialog,
  accountChanges,
  accountDraftFrom,
  accountEmailMissing,
  badgeChanges,
  noteCanSave,
  staffRoleOptions,
  toggleId,
} = await import("@/components/admin/users/user-edit-dialogs");

const user = {
  name: "Ada",
  email: "ada@example.com",
  plan: "core_supporter",
  role: "support",
  gifted_plan: null,
  gift_end_date: null,
};
const save = async () => ({ ok: true });

/** The one opening tag of `name` that carries `attr`, whatever the order. */
function tag(html: string, name: string, attr: string): string {
  const found = (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).filter(
    (t) => t.includes(attr),
  );
  expect(found).toHaveLength(1);
  return found[0];
}
const noop = () => {};

const badge = (id: number, display_name: string) => ({
  id,
  name: display_name.toLowerCase(),
  display_name,
  description: null,
  icon: null,
  color: "#336699",
  priority: 0,
  is_limited: false,
});

describe("EditAccountDialog", () => {
  it("opens on the saved values with Cancel and Save", () => {
    const html = renderToStaticMarkup(
      <EditAccountDialog
        user={user}
        canEditEmailAndPlan
        onSave={save}
        onClose={noop}
      />,
    );
    expect(html).toContain("Edit account");
    expect(tag(html, "input", 'name="name"')).toContain('value="Ada"');
    const email = tag(html, "input", 'name="email"');
    expect(email).toContain('type="email"');
    expect(email).toContain('value="ada@example.com"');
    expect(html).toMatch(
      /<option value="core_supporter" selected="">Core Supporter<\/option>/,
    );
    expect(html).toContain(">Display name</label>");
    expect(html).toContain(">Email address</label>");
    expect(html).toContain(">Plan</label>");
    expect(html).toContain("Changes are logged in the audit log.");
    expect(html).toContain("They get one email listing what changed.");
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">Save changes</button>");
  });

  it("shows the name only to a role that cannot manage staff", () => {
    const html = renderToStaticMarkup(
      <EditAccountDialog
        user={user}
        canEditEmailAndPlan={false}
        onSave={save}
        onClose={noop}
      />,
    );
    expect(html).toMatch(/name="name"/);
    expect(html).not.toMatch(/name="email"/);
    expect(html).not.toMatch(/name="plan"/);
  });

  it("shows a gifted plan read-only, with where to change it", () => {
    const html = renderToStaticMarkup(
      <EditAccountDialog
        user={{
          ...user,
          gifted_plan: "elite_supporter",
          gift_end_date: "2027-03-04T12:00:00Z",
        }}
        canEditEmailAndPlan
        onSave={save}
        onClose={noop}
      />,
    );
    expect(html).not.toMatch(/name="plan"/);
    expect(html).toContain("Elite Supporter");
    expect(html).toContain(
      "Gifted until Mar 4, 2027. Use the Gift button above to modify.",
    );
  });
});

describe("the account draft", () => {
  const draft = accountDraftFrom(user);

  it("starts from the saved record", () => {
    expect(draft).toEqual({
      name: "Ada",
      email: "ada@example.com",
      plan: "core_supporter",
    });
    expect(accountDraftFrom({ ...user, name: null, plan: "" })).toMatchObject({
      name: "",
      plan: "free",
    });
  });

  it("sends only what changed, with the name trimmed and the email lowercased", () => {
    expect(accountChanges(user, draft, true)).toEqual({});
    expect(
      accountChanges(
        user,
        { ...draft, name: "  Grace ", email: " Grace@Example.COM " },
        true,
      ),
    ).toEqual({ name: "Grace", email: "grace@example.com" });
    expect(accountChanges(user, { ...draft, name: " Ada " }, true)).toEqual({});
    expect(
      accountChanges(user, { ...draft, email: "ADA@example.com" }, true),
    ).toEqual({});
  });

  it("does not send back a stored value nobody touched", () => {
    // Rows written before every path normalised them: an address in mixed
    // case, a name with a trailing space. Sent back, the address would come
    // in as an email change, which the server writes lowercased, unverifies
    // and announces to the old address, all from a dialog opened to fix the
    // name.
    const legacy = { ...user, email: "Ada@Example.com", name: "Ada " };
    expect(accountChanges(legacy, accountDraftFrom(legacy), true)).toEqual({});
    expect(
      accountChanges(
        legacy,
        { ...accountDraftFrom(legacy), name: "Grace" },
        true,
      ),
    ).toEqual({ name: "Grace" });
  });

  it("never sends email or plan for a role that cannot edit them", () => {
    expect(
      accountChanges(
        user,
        { name: "Ada", email: "x@example.com", plan: "free" },
        false,
      ),
    ).toEqual({});
  });

  it("never sends a plan over a gifted one", () => {
    expect(
      accountChanges(
        { ...user, gifted_plan: "elite_supporter" },
        { ...draft, plan: "free" },
        true,
      ),
    ).toEqual({});
  });

  it("holds Save while the email is empty", () => {
    expect(accountEmailMissing({ ...draft, email: "  " }, true)).toBe(true);
    expect(accountEmailMissing({ ...draft, email: "  " }, false)).toBe(false);
    expect(accountEmailMissing(draft, true)).toBe(false);
  });
});

describe("ChangeStaffRoleDialog", () => {
  it("opens on the current role, offers no super admin, and defaults to telling them", () => {
    const html = renderToStaticMarkup(
      <ChangeStaffRoleDialog user={user} onSave={save} onClose={noop} />,
    );
    expect(html).toContain("Change staff role");
    expect(html).toContain(">Staff role</label>");
    expect(html).toMatch(
      /<option value="support" selected="">Support \(current\)<\/option>/,
    );
    expect(html).not.toContain('value="super_admin"');
    expect(html).toContain("Email them about the change");
    expect(html).toMatch(/role="checkbox" aria-checked="true"/);
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">Change role</button>");
  });

  it("lists super admin only for an account that already is one", () => {
    expect(staffRoleOptions("admin")).not.toContain("super_admin");
    expect(staffRoleOptions(null)).not.toContain("super_admin");
    expect(staffRoleOptions("super_admin")).toContain("super_admin");
  });
});

describe("EditBadgesDialog", () => {
  it("lists awarded badges as removals and the rest as awards", () => {
    const html = renderToStaticMarkup(
      <EditBadgesDialog
        user={user}
        awarded={[badge(1, "Owl")]}
        allBadges={[badge(1, "Owl"), badge(2, "Bee")]}
        onSave={save}
        onClose={noop}
      />,
    );
    expect(html).toContain("Edit badges");
    expect(html).toMatch(/aria-pressed="false" aria-label="Remove badge Owl"/);
    expect(html).toMatch(/aria-pressed="false" aria-label="Award Bee"/);
    expect(html).not.toContain('aria-label="Award Owl"');
    expect(html).toContain("Email them about the change");
    expect(html).toContain(">Save badges</button>");
    // Nothing toggled yet, so there is nothing to save.
    expect(tag(html, "button", 'type="submit"')).toContain('disabled=""');
  });

  it("sends a toggle once, and only against what is awarded now", () => {
    expect(toggleId([], 2)).toEqual([2]);
    expect(toggleId([2, 3], 2)).toEqual([3]);
    expect(badgeChanges([1], [2], [1])).toEqual({ awards: [2], revokes: [1] });
    // A partly failed save already awarded 2 and removed 1.
    expect(badgeChanges([2], [2], [1])).toEqual({ awards: [], revokes: [] });
  });
});

describe("EditNoteDialog", () => {
  it("edits in a textarea, so a note keeps its line breaks", () => {
    const html = renderToStaticMarkup(
      <EditNoteDialog
        note={{ id: 4, text: "line one\nline two" }}
        onSave={save}
        onClose={noop}
      />,
    );
    expect(html).toContain(">Note</label>");
    expect(html).toMatch(/<textarea[^>]*name="note"[^>]*>line one\nline two</);
    expect(html).toContain(">Save note</button>");
    expect(html).toContain(">Cancel</button>");
  });

  it("saves a real change only", () => {
    expect(noteCanSave("a", "a")).toBe(false);
    expect(noteCanSave("a", "  a ")).toBe(false);
    expect(noteCanSave("a", "   ")).toBe(false);
    expect(noteCanSave("a", "b")).toBe(true);
  });
});

describe("the dialogs file keeps the house rules", () => {
  const src = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "components",
      "admin",
      "users",
      "user-edit-dialogs.tsx",
    ),
    "utf8",
  );

  it("has no em or en dashes in its copy", () => {
    expect(src).not.toMatch(/[\u2013\u2014]/);
  });

  it("puts no panel radius inside a dialog", () => {
    expect(src).not.toContain("rounded-xl");
    expect(src).not.toContain("rounded-2xl");
  });

  it("never sets admin text below 11px", () => {
    expect(src).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
  });
});
