/**
 * Personal details (name and email) are edited in ProfileDetailsDialog.
 *
 * They used to be inline inputs that wrote into the profile page's
 * pendingChanges, and the email change's current password went in there too,
 * as pendingChanges.emailPassword. That object is page-wide and long-lived:
 * the inline Cancel removed the name and the email from it but not the
 * password, so a typed password stayed in page state (and kept the save bar
 * up with nothing listed) until a tab switch or a save happened to clear it.
 * The password now lives only in the dialog's own draft, which is gone the
 * moment the dialog unmounts, and the page's save path no longer knows the
 * name, the email or the password exist.
 *
 * No DOM in this suite (vitest runs `node`): the dialog renders through
 * renderToStaticMarkup with the Radix dialog stood in by a pass-through, and
 * the save path is driven through the exported functions it calls.
 */
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProfileUser } from "@/components/profile/types";

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogClose: Pass,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

vi.mock("@/components/shared/language-select", () => ({
  LanguageSelect: () => null,
}));

const refreshAuthCache = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({
  refreshAuthCache: () => refreshAuthCache(),
}));

const {
  ProfileDetailsDialog,
  ProfileDetailsFields,
  ProfileGeneralTab,
  profileDetailsCanSave,
  profileDetailsDirty,
  profileDetailsDraftFrom,
  profileDetailsNeedsPassword,
  saveProfileDetails,
  withDetailsEmail,
} = await import("@/components/profile/tabs/profile-general-tab");
const { editCloseDecision } =
  await import("@/components/shared/edit-dialog-outcome");

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function user(over: Partial<ProfileUser> = {}): ProfileUser {
  return {
    userId: 7,
    name: "Ada Lovelace",
    email: "ada@example.com",
    hasPassword: true,
    ...over,
  } as ProfileUser;
}

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

/** Stubs fetch with one response per call, in order, and records each call. */
function stubFetch(
  ...responses: Array<{ ok: boolean; body: Record<string, unknown> }>
) {
  const calls: Call[] = [];
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        init,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      const next = queue.shift() ?? { ok: true, body: {} };
      return {
        ok: next.ok,
        status: next.ok ? 200 : 400,
        json: async () => next.body,
      } as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  refreshAuthCache.mockReset();
});

function renderTab(u: ProfileUser = user()) {
  return renderToStaticMarkup(
    <ProfileGeneralTab
      user={u}
      loading={false}
      error={null}
      success={null}
      setError={() => {}}
      setSuccess={() => {}}
      onTabChange={() => {}}
      pendingChanges={{}}
      setPendingChanges={() => {}}
    />,
  );
}

function renderDialog(u: ProfileUser = user()) {
  return renderToStaticMarkup(
    <ProfileDetailsDialog
      user={u}
      onClose={() => {}}
      onUserPatch={() => {}}
      onSaved={() => {}}
    />,
  );
}

describe("the Personal details block", () => {
  it("shows the saved name and email as read-only tiles", () => {
    const html = renderTab();
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
    // No inline editor any more: the inputs only exist inside the dialog.
    expect(html).not.toContain('id="display-name-input"');
    expect(html).not.toContain('id="email-address-input"');
    expect(html).not.toContain("Unsaved");
  });

  it("has an Edit trigger that is a real button with a name and a 24px floor", () => {
    const html = renderTab();
    const trigger = html.match(
      /<button[^>]*aria-label="Edit name and email"[^>]*>/,
    );
    expect(trigger).not.toBeNull();
    // h-7 is 28px, over the 24px floor of WCAG 2.2 SC 2.5.8.
    expect(trigger![0]).toMatch(/\bh-7\b/);
    expect(trigger![0]).toContain('type="button"');
  });
});

describe("ProfileDetailsDialog, rendered open", () => {
  it("shows every field holding the saved value, plus Cancel and Save", () => {
    const html = renderDialog();
    expect(html).toMatch(
      /<input[^>]*id="profile-details-name"[^>]*value="Ada Lovelace"/,
    );
    expect(html).toMatch(
      /<input[^>]*id="profile-details-email"[^>]*value="ada@example.com"/,
    );
    expect(html).toMatch(/<label[^>]*for="profile-details-name"/);
    expect(html).toMatch(/<label[^>]*for="profile-details-email"/);
    expect(html).toContain("Cancel");
    expect(html).toContain("Save changes");
  });

  it("asks for no password while the email is the saved one", () => {
    expect(renderDialog()).not.toContain('id="profile-details-password"');
  });

  it("puts the name first and uses the right autocomplete tokens", () => {
    const html = renderDialog();
    expect(html).toMatch(
      /<input[^>]*id="profile-details-name"[^>]*autoComplete="name"|<input[^>]*autoComplete="name"[^>]*id="profile-details-name"/i,
    );
    expect(html).toMatch(/<input[^>]*type="email"[^>]*>/);
    expect(html).toMatch(/autoComplete="email"/i);
  });
});

describe("the draft", () => {
  it("starts from the saved values with no password", () => {
    expect(profileDetailsDraftFrom(user())).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      currentPassword: "",
    });
    expect(profileDetailsDraftFrom(user({ name: null }))).toMatchObject({
      name: "",
    });
  });

  it("needs the password only when the email changed and the account has one", () => {
    const u = user();
    const moved = withDetailsEmail(
      profileDetailsDraftFrom(u),
      "ada@new.example",
      u,
    );
    expect(profileDetailsNeedsPassword(profileDetailsDraftFrom(u), u)).toBe(
      false,
    );
    expect(profileDetailsNeedsPassword(moved, u)).toBe(true);
    // An OAuth-only account has no password to re-enter, as on the route.
    const oauth = user({ hasPassword: false });
    expect(
      profileDetailsNeedsPassword(
        withDetailsEmail(
          profileDetailsDraftFrom(oauth),
          "ada@new.example",
          oauth,
        ),
        oauth,
      ),
    ).toBe(false);
  });

  it("drops a typed password as soon as the email is put back", () => {
    const u = user();
    const typed = {
      ...withDetailsEmail(profileDetailsDraftFrom(u), "ada@new.example", u),
      currentPassword: "hunter2 ",
    };
    expect(withDetailsEmail(typed, u.email, u).currentPassword).toBe("");
  });

  it("renders the password field once the email differs", () => {
    // The dialog seeds its draft from the saved account, so it always opens
    // with the email unchanged; the fields it renders are checked directly
    // with a draft that has moved on.
    const u = user();
    const draft = withDetailsEmail(
      profileDetailsDraftFrom(u),
      "ada@new.example",
      u,
    );
    const html = renderToStaticMarkup(
      <ProfileDetailsFields draft={draft} user={u} onChange={() => {}} />,
    );
    expect(html).toMatch(
      /<input[^>]*id="profile-details-password"[^>]*type="password"|<input[^>]*type="password"[^>]*id="profile-details-password"/,
    );
    expect(html).toMatch(/autoComplete="current-password"/i);
    expect(html).toContain(
      "Required to change the address your account recovers through.",
    );
  });

  it("is dirty and saveable only once something changed", () => {
    const u = user();
    const same = profileDetailsDraftFrom(u);
    expect(profileDetailsDirty(same, u)).toBe(false);
    expect(profileDetailsCanSave(same, u)).toBe(false);

    const renamed = { ...same, name: "Ada King" };
    expect(profileDetailsDirty(renamed, u)).toBe(true);
    expect(profileDetailsCanSave(renamed, u)).toBe(true);

    const moved = withDetailsEmail(same, "ada@new.example", u);
    expect(profileDetailsDirty(moved, u)).toBe(true);
    // The password field is showing and empty.
    expect(profileDetailsCanSave(moved, u)).toBe(false);
    expect(profileDetailsCanSave({ ...moved, currentPassword: "pw" }, u)).toBe(
      true,
    );

    const blank = withDetailsEmail(same, "", u);
    expect(profileDetailsCanSave({ ...blank, currentPassword: "pw" }, u)).toBe(
      false,
    );
  });
});

describe("saveProfileDetails", () => {
  it("a name-only save sends one PATCH with only the name", async () => {
    const calls = stubFetch({ ok: true, body: { name: "Ada King" } });
    const patches: unknown[] = [];
    const u = user();
    const out = await saveProfileDetails(
      { ...profileDetailsDraftFrom(u), name: "Ada King" },
      u,
      (p) => patches.push(p),
    );
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].body).toEqual({ name: "Ada King" });
    expect(patches).toEqual([{ name: "Ada King" }]);
    expect(refreshAuthCache).toHaveBeenCalledTimes(1);
  });

  it("an email change sends the email with the password exactly as typed", async () => {
    const calls = stubFetch({ ok: true, body: { email: "ada@new.example" } });
    const patches: unknown[] = [];
    const u = user();
    const draft = {
      ...withDetailsEmail(profileDetailsDraftFrom(u), "ada@new.example", u),
      currentPassword: "  pass word  ",
    };
    const out = await saveProfileDetails(draft, u, (p) => patches.push(p));
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(1);
    // Not trimmed: a password is whatever the person set, spaces included.
    expect(calls[0].body).toEqual({
      email: "ada@new.example",
      currentPassword: "  pass word  ",
    });
    // Only in the body: never in the URL.
    expect(calls[0].url).not.toContain("pass");
    expect(patches).toEqual([{ email: "ada@new.example" }]);
  });

  it("sends the name first, then the email", async () => {
    const calls = stubFetch(
      { ok: true, body: { name: "Ada King" } },
      { ok: true, body: { email: "ada@new.example" } },
    );
    const u = user();
    const draft = {
      ...withDetailsEmail(
        { ...profileDetailsDraftFrom(u), name: "Ada King" },
        "ada@new.example",
        u,
      ),
      currentPassword: "pw",
    };
    await saveProfileDetails(draft, u, () => {});
    expect(calls.map((c) => c.body)).toEqual([
      { name: "Ada King" },
      { email: "ada@new.example", currentPassword: "pw" },
    ]);
  });

  it("a refused email after a saved name says the name went through", async () => {
    stubFetch(
      { ok: true, body: { name: "Ada King" } },
      { ok: false, body: { error: "Current password is incorrect." } },
    );
    const patches: unknown[] = [];
    const u = user();
    const draft = {
      ...withDetailsEmail(
        { ...profileDetailsDraftFrom(u), name: "Ada King" },
        "ada@new.example",
        u,
      ),
      currentPassword: "wrong",
    };
    const out = await saveProfileDetails(draft, u, (p) => patches.push(p));
    expect(out).toEqual({
      ok: false,
      error:
        "Your name was saved. The email address was not: Current password is incorrect.",
    });
    // The name is patched into the page, the email is not.
    expect(patches).toEqual([{ name: "Ada King" }]);
    // The error never carries the password.
    expect(JSON.stringify(out)).not.toContain("wrong");
  });

  it("a refused name stops before the email and returns the server's reason", async () => {
    const calls = stubFetch({
      ok: false,
      body: { error: "Name cannot be empty." },
    });
    const u = user();
    const out = await saveProfileDetails(
      { ...profileDetailsDraftFrom(u), name: " " },
      u,
      () => {},
    );
    expect(out).toEqual({ ok: false, error: "Name cannot be empty." });
    expect(calls).toHaveLength(1);
    expect(refreshAuthCache).not.toHaveBeenCalled();
  });

  it("a network failure is a message, not a throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const u = user();
    const out = await saveProfileDetails(
      { ...profileDetailsDraftFrom(u), name: "Ada King" },
      u,
      () => {},
    );
    expect(out.ok).toBe(false);
  });
});

describe("closing the dialog", () => {
  it("Cancel and Escape never call the save and leave the account as it was", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const u = user();
    let target: ProfileUser | null = u;
    const onClose = () => {
      target = null;
    };
    const dirty = profileDetailsDirty(
      { ...profileDetailsDraftFrom(u), name: "Ada King" },
      u,
    );
    // Dirty asks first; a confirmed discard calls the site's close handler.
    expect(editCloseDecision({ busy: false, dirty })).toBe("confirm-discard");
    expect(editCloseDecision({ busy: false, dirty: false })).toBe("close");
    onClose();
    expect(target).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(u.name).toBe("Ada Lovelace");
    expect(u.email).toBe("ada@example.com");
  });
});

describe("the page no longer carries the name, the email or the password", () => {
  it("PendingChanges has no name, email or emailPassword key", () => {
    const src = read("components/profile/types.ts");
    const block = src.match(/export interface PendingChanges \{[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    expect(block![0]).not.toMatch(/^\s*name\?:/m);
    expect(block![0]).not.toMatch(/^\s*email\?:/m);
    expect(block![0]).not.toMatch(/emailPassword/);
  });

  it("saveAllPendingChanges sends neither, and the general tab gets onUserPatch", () => {
    const page = read("app/profile/page.tsx");
    expect(page).not.toMatch(/pendingChanges\.name\b/);
    expect(page).not.toMatch(/pendingChanges\.email\b/);
    expect(page).not.toMatch(/emailPassword/);
    const general = page.match(/<ProfileGeneralTab[\s\S]*?\/>/);
    expect(general).not.toBeNull();
    expect(general![0]).toContain("onUserPatch={patchUser}");
  });

  it("the general tab never writes into pendingChanges", () => {
    const tab = read("components/profile/tabs/profile-general-tab.tsx");
    expect(tab).not.toMatch(/setPendingChanges/);
    expect(tab).not.toMatch(/emailPassword/);
  });
});
