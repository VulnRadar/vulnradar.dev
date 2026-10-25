/**
 * Tests for the admin panel's action tables in components/admin/config.ts.
 *
 * The two card manifests (SUPPORT_CARD_ACTIONS, DANGER_ZONE_ACTIONS) decide
 * whether the user detail panel renders an action card at all. They used to
 * be one shared DISABLE_USER check, which hid every card in both groups from
 * the three specialist roles that hold grants inside them, so the cases below
 * pin both halves: the manifests name real actions, and each role that holds
 * one of those actions can see the card that contains it.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_LABELS,
  ACTION_META,
  DANGER_ZONE_ACTIONS,
  PASSWORD_GATED_ACTIONS,
  SUPPORT_CARD_ACTIONS,
} from "@/components/admin/config";
import {
  AUDIT_FILTER_CATEGORIES,
  getActionSentence,
} from "@/components/admin/utils";
import { AUDIT_ACTIONS, KNOWN_AUDIT_ACTIONS } from "@/lib/admin/audit-actions";
import { ADMIN_ACTIONS, canPerformAction } from "@/lib/auth/permissions-client";
import { STAFF_ROLES } from "@/lib/config/client-constants";
import type { AuditEntry } from "@/components/admin/types";

const REGISTERED_IDS = new Set(ADMIN_ACTIONS.map((a) => a.id));

describe("card action manifests", () => {
  // canPerformAction returns false for an id ADMIN_ACTIONS does not define,
  // so a typo here renders as a permanently disabled card that blames the
  // operator's role rather than the code.
  it.each([...SUPPORT_CARD_ACTIONS])(
    "support card action %s is a registered admin action",
    (action) => {
      expect(REGISTERED_IDS.has(action)).toBe(true);
    },
  );

  it.each([...DANGER_ZONE_ACTIONS])(
    "danger zone action %s is a registered admin action",
    (action) => {
      expect(REGISTERED_IDS.has(action)).toBe(true);
    },
  );

  it("does not list the same action in both cards", () => {
    const support = new Set<string>(SUPPORT_CARD_ACTIONS);
    const overlap = DANGER_ZONE_ACTIONS.filter((a) => support.has(a));
    expect(overlap).toEqual([]);
  });

  it("gives every card action a success-toast label", () => {
    const missing = [...SUPPORT_CARD_ACTIONS, ...DANGER_ZONE_ACTIONS].filter(
      (action) => !ACTION_LABELS[action],
    );
    expect(missing).toEqual([]);
  });
});

describe("specialist roles reach the cards holding their grants", () => {
  const seesCard = (role: string, actions: readonly string[]) =>
    actions.some((action) => canPerformAction(role, action));

  // The exact bug this replaced: each of these roles holds a grant inside the
  // Support Actions card and was shown "You have view-only access" instead.
  it.each([
    [STAFF_ROLES.BILLING, "gift_subscription"],
    [STAFF_ROLES.SECURITY_ANALYST, "revoke_sessions"],
    [STAFF_ROLES.CONTENT_MANAGER, "send_notification"],
    [STAFF_ROLES.MODERATOR, "revoke_sessions"],
  ])("%s can run %s, so the support card renders for it", (role, action) => {
    expect(canPerformAction(role, action)).toBe(true);
    expect(seesCard(role, SUPPORT_CARD_ACTIONS)).toBe(true);
  });

  // Read-only tiers keep the view-only message: support holds no mutation
  // permission at all, and ops is deliberately scoped away from user data.
  it.each([STAFF_ROLES.SUPPORT, STAFF_ROLES.OPS, STAFF_ROLES.USER])(
    "%s sees neither card",
    (role) => {
      expect(seesCard(role, SUPPORT_CARD_ACTIONS)).toBe(false);
      expect(seesCard(role, DANGER_ZONE_ACTIONS)).toBe(false);
    },
  );

  it("content_manager reaches the danger zone for its AI chat ban grant", () => {
    expect(canPerformAction(STAFF_ROLES.CONTENT_MANAGER, "toggle_ai_ban")).toBe(
      true,
    );
    expect(seesCard(STAFF_ROLES.CONTENT_MANAGER, DANGER_ZONE_ACTIONS)).toBe(
      true,
    );
  });

  it("billing cannot reach anything in the danger zone", () => {
    expect(seesCard(STAFF_ROLES.BILLING, DANGER_ZONE_ACTIONS)).toBe(false);
  });
});

/**
 * ACTION_META and AUDIT_FILTER_CATEGORIES are derived from
 * lib/admin/audit-actions.ts. They used to be two hand-kept lists, and 25
 * logged actions had no label while 31 were in no filter, so a filtered audit
 * log silently hid them. These pin the derivation, not the data.
 */
describe("audit log display tables", () => {
  it("gives every known action a label, a verb and a colour", () => {
    for (const name of Object.keys(KNOWN_AUDIT_ACTIONS)) {
      expect(ACTION_META[name]?.label, name).toBeTruthy();
      expect(ACTION_META[name]?.verb, name).toBeTruthy();
      expect(ACTION_META[name]?.cls, name).toMatch(/\bbg-/);
    }
  });

  it("puts every action in exactly one filter, so no filter hides one", () => {
    const filters = AUDIT_FILTER_CATEGORIES.filter((c) => c.id !== "all");
    for (const name of Object.keys(KNOWN_AUDIT_ACTIONS)) {
      const holders = filters.filter((c) => c.actions?.includes(name));
      expect(
        holders.map((c) => c.id),
        name,
      ).toHaveLength(1);
    }
  });

  it("keeps All first and gives it no action list", () => {
    expect(AUDIT_FILTER_CATEGORIES[0].id).toBe("all");
    expect(AUDIT_FILTER_CATEGORIES[0].actions).toBeUndefined();
  });

  it("has Staff and Logs & data filters for the rows a review looks for", () => {
    const byId = new Map(AUDIT_FILTER_CATEGORIES.map((c) => [c.id, c]));
    expect(byId.get("staff")?.actions).toEqual(
      expect.arrayContaining([
        "staff_invite_sent",
        "staff_oidc_login",
        "impersonate",
      ]),
    );
    expect(byId.get("logs_data")?.actions).toEqual(
      expect.arrayContaining([
        "error_logs_cleared",
        "email_logs_cleared",
        "audit_log_exported",
      ]),
    );
  });

  it("reads delete_account, the name the delete handler logs, as a sentence", () => {
    // It used to fall back to `performed "delete account"`: only the two
    // synonyms nothing writes any more had a label.
    expect("delete_account" in AUDIT_ACTIONS).toBe(true);
    const row = {
      action: "delete_account",
      admin_name: "Ada",
      admin_email: "ada@example.test",
      target_name: null,
      target_email: null,
    } as unknown as AuditEntry;
    expect(getActionSentence(row)).toBe("Ada permanently deleted an account");
  });

  it("marks deletes and revokes destructive, which the log weights by", () => {
    for (const name of [
      "delete_account",
      "error_logs_cleared",
      "revoke_public_share",
    ]) {
      expect(ACTION_META[name].cls, name).toContain("destructive");
    }
    expect(ACTION_META.view_scan.cls).not.toContain("destructive");
  });
});

describe("PASSWORD_GATED_ACTIONS", () => {
  // The 2FA recovery code hands whoever reads the target's mailbox a working
  // second factor, so it belongs with the account-mutation set and not with
  // the additive resets.
  it("gates the 2FA recovery code behind the caller's own password", () => {
    expect(PASSWORD_GATED_ACTIONS.has("issue_2fa_recovery_code")).toBe(true);
  });

  it("names only actions the admin route still implements", () => {
    // Three deliberate synonyms for the delete handler plus one action that
    // lives on a different route are documented in the constant itself.
    const knownNonPatchEntries = new Set([
      "delete_user",
      "delete_account",
      "send_staff_invite",
    ]);
    const unknown = [...PASSWORD_GATED_ACTIONS].filter(
      (action) =>
        !REGISTERED_IDS.has(action) && !knownNonPatchEntries.has(action),
    );
    expect(unknown).toEqual([]);
  });
});
