import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_COLUMNS,
  ALWAYS_ON_COLUMNS,
  BROADCAST_FALLBACK_COLUMN,
  DEFAULT_PREFERENCES,
  NOTIFICATION_COLUMNS,
  PREFERENCE_COPY,
  UNSUBSCRIBABLE_COLUMNS,
  isNotificationColumn,
  isSecurityColumn,
  isSecurityNotification,
  optedInCondition,
  type NotificationType,
} from "@/lib/notifications/columns";

/**
 * lib/notifications/columns.ts is the one declaration of the email preference
 * columns, with no database import so a browser can read it. Before it, eight
 * files carried a copy, and the copies of the defaults said every column was
 * on while the schema starts Tips & Guides off.
 */

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** `column BOOLEAN NOT NULL DEFAULT true|false` for each column in a DDL. */
function ddlDefaults(sql: string): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  const pattern =
    /(email_[a-z0-9_]+)\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+(true|false)/gi;
  for (const match of sql.matchAll(pattern)) {
    defaults[match[1]] = match[2].toLowerCase() === "true";
  }
  return defaults;
}

describe("DEFAULT_PREFERENCES", () => {
  it("matches the DEFAULT of every column in the schema", () => {
    const fromSchema = {
      ...ddlDefaults(read("lib/database/schema/01-core.mjs")),
      // email_posture_digest is added to existing tables by the digest schema,
      // not by the CREATE TABLE.
      ...ddlDefaults(read("lib/notifications/digest-schema.ts")),
    };
    for (const column of ALL_COLUMNS) {
      expect(
        fromSchema[column],
        `${column} has no DEFAULT in the schema`,
      ).not.toBe(undefined);
      expect(DEFAULT_PREFERENCES[column], column).toBe(fromSchema[column]);
    }
  });

  it("starts Tips & Guides off, because it is the one opt-in category", () => {
    expect(DEFAULT_PREFERENCES.email_tips_guides).toBe(false);
    const on = ALL_COLUMNS.filter((c) => DEFAULT_PREFERENCES[c]);
    expect(on).toHaveLength(ALL_COLUMNS.length - 1);
  });

  it("is frozen, so no caller can change what a new account gets", () => {
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
  });
});

describe("the column list", () => {
  it("gives every notification type exactly one distinct column", () => {
    const columns = Object.values(NOTIFICATION_COLUMNS);
    expect(new Set(columns).size).toBe(columns.length);
    expect(ALL_COLUMNS).toEqual(columns);
  });

  it("names a real column of notification_preferences for each one", () => {
    const schema = read("lib/database/schema/01-core.mjs");
    const digest = read("lib/notifications/digest-schema.ts");
    for (const column of ALL_COLUMNS) {
      expect(schema.includes(column) || digest.includes(column), column).toBe(
        true,
      );
    }
  });

  it("recognises its own columns and nothing else", () => {
    expect(isNotificationColumn("email_tips_guides")).toBe(true);
    expect(isNotificationColumn("email_tips_guides; DROP TABLE users")).toBe(
      false,
    );
    expect(isNotificationColumn("id")).toBe(false);
    expect(isNotificationColumn(undefined)).toBe(false);
  });

  it("refuses to switch off security alerts", () => {
    expect(ALWAYS_ON_COLUMNS.has("email_security")).toBe(true);
    expect(ALWAYS_ON_COLUMNS.size).toBe(1);
  });
});

describe("isSecurityNotification", () => {
  const SECURITY: NotificationType[] = [
    "security",
    "login_alerts",
    "password_changes",
    "two_factor_changes",
    "session_alerts",
    "account_changes",
  ];

  it("covers the warnings that exist to catch an account takeover", () => {
    for (const type of SECURITY) {
      expect(isSecurityNotification(type), type).toBe(true);
    }
  });

  it("does not cover the mail a person reasonably wants to unsubscribe from", () => {
    const rest = (
      Object.keys(NOTIFICATION_COLUMNS) as NotificationType[]
    ).filter((type) => !SECURITY.includes(type));
    expect(rest.length).toBeGreaterThan(0);
    for (const type of rest) {
      expect(isSecurityNotification(type), type).toBe(false);
    }
  });
});

describe("isSecurityColumn", () => {
  it("is the column of every security notification type, and no other", () => {
    const types = Object.keys(NOTIFICATION_COLUMNS) as NotificationType[];
    for (const type of types) {
      expect(isSecurityColumn(NOTIFICATION_COLUMNS[type]), type).toBe(
        isSecurityNotification(type),
      );
    }
    expect(isSecurityColumn("email_new_login")).toBe(true);
    expect(isSecurityColumn("email_security")).toBe(true);
    expect(isSecurityColumn("email_scan_complete")).toBe(false);
    expect(isSecurityColumn("email_product_updates")).toBe(false);
  });
});

describe("UNSUBSCRIBABLE_COLUMNS", () => {
  it("is every column except the security ones", () => {
    expect([...UNSUBSCRIBABLE_COLUMNS]).toEqual(
      ALL_COLUMNS.filter((column) => !isSecurityColumn(column)),
    );
    for (const column of [
      "email_security",
      "email_new_login",
      "email_password_change",
      "email_2fa_change",
      "email_session_revoked",
      "email_account_deletion",
    ] as const) {
      expect(UNSUBSCRIBABLE_COLUMNS, column).not.toContain(column);
    }
  });

  it("never holds an always-on column", () => {
    for (const column of ALWAYS_ON_COLUMNS) {
      expect(UNSUBSCRIBABLE_COLUMNS).not.toContain(column);
    }
  });
});

describe("PREFERENCE_COPY", () => {
  it("names and describes every column, and no others", () => {
    expect(Object.keys(PREFERENCE_COPY).sort()).toEqual(
      [...ALL_COLUMNS].sort(),
    );
    for (const column of ALL_COLUMNS) {
      expect(PREFERENCE_COPY[column].label, column).not.toBe("");
      expect(PREFERENCE_COPY[column].description, column).not.toBe("");
    }
  });

  it("describes the regression alert as what it is", () => {
    const { label, description } = PREFERENCE_COPY.email_regression_alert;
    expect(label).toBe("New critical or high findings");
    // "A previously clean scan" was the old claim, and it is not the rule: the
    // alert compares findings, whatever else the last scan held.
    expect(description).not.toMatch(/clean/i);
    expect(description).toMatch(/critical or high/i);
  });

  it("keeps the Critical findings switch", () => {
    expect(PREFERENCE_COPY.email_critical_findings.label).toBe(
      "Critical findings",
    );
    expect(NOTIFICATION_COLUMNS.critical_findings).toBe(
      "email_critical_findings",
    );
  });

  it("keeps long dashes and middle dots out of the copy", () => {
    const forbidden = new RegExp(
      `[${[0x2014, 0x2013, 0xb7].map((c) => String.fromCharCode(c)).join("")}]`,
    );
    for (const column of ALL_COLUMNS) {
      const { label, description } = PREFERENCE_COPY[column];
      expect(label + description, column).not.toMatch(forbidden);
    }
  });
});

describe("optedInCondition", () => {
  it("falls back to the schema default for a user with no preferences row", () => {
    expect(optedInCondition("email_tips_guides")).toBe(
      "COALESCE(np.email_tips_guides, false) = true",
    );
    expect(optedInCondition("email_product_updates")).toBe(
      "COALESCE(np.email_product_updates, true) = true",
    );
  });

  it("takes the table alias of the query it is placed in", () => {
    expect(optedInCondition("email_webhooks", "prefs")).toBe(
      "COALESCE(prefs.email_webhooks, true) = true",
    );
  });
});

describe("BROADCAST_FALLBACK_COLUMN", () => {
  it("is a real, switch-off-able column", () => {
    expect(isNotificationColumn(BROADCAST_FALLBACK_COLUMN)).toBe(true);
    expect(ALWAYS_ON_COLUMNS.has(BROADCAST_FALLBACK_COLUMN)).toBe(false);
  });
});
