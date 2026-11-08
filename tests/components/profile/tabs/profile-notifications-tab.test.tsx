import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileNotificationsTab } from "@/components/profile/tabs/profile-notifications-tab";
import {
  ALL_COLUMNS,
  DEFAULT_PREFERENCES,
  PREFERENCE_COPY,
  isSecurityColumn,
} from "@/lib/notifications/columns";

/**
 * The profile screen and /unsubscribe read one table of labels. They had a
 * copy each, and the two copies told people different things about the same
 * switch.
 */
const clientConfig = vi.hoisted(() => ({ featureEmailNotifications: true }));
vi.mock("@/lib/hooks/use-client-config", () => ({
  useClientConfig: () => clientConfig,
}));

type Props = ComponentProps<typeof ProfileNotificationsTab>;

function render(): string {
  const props = {
    setPendingChanges: () => undefined,
    pendingChanges: {},
    discardKey: 0,
    saveKey: 0,
    preloadedNotifPrefs: { ...DEFAULT_PREFERENCES },
    preloadedDigestEmailEnabled: true,
  } as unknown as Props;
  return renderToStaticMarkup(<ProfileNotificationsTab {...props} />);
}

/** How React escapes an apostrophe or ampersand in text. */
function asHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;");
}

describe("ProfileNotificationsTab", () => {
  const html = render();

  it("shows every column under the shared label and description", () => {
    for (const column of ALL_COLUMNS) {
      const { label, description } = PREFERENCE_COPY[column];
      expect(html, column).toContain(asHtml(label));
      expect(html, column).toContain(asHtml(description));
    }
  });

  it("names the regression alert for what it reports", () => {
    expect(html).toContain("New critical or high findings");
    expect(html).not.toContain("New issues since last scan");
  });

  it("keeps the Critical findings switch", () => {
    expect(html).toContain('aria-label="Critical findings"');
  });

  it("names the badge the row really has", () => {
    expect(html).toContain("marked Always on");
    expect(html).not.toContain("Recommended");
  });
});

describe("ProfileNotificationsTab with email notifications switched off", () => {
  function renderOff(): string {
    clientConfig.featureEmailNotifications = false;
    try {
      return render();
    } finally {
      clientConfig.featureEmailNotifications = true;
    }
  }

  it("keeps a switch for every kind of mail that still sends, and only those", () => {
    const html = renderOff();
    for (const column of ALL_COLUMNS) {
      const { label } = PREFERENCE_COPY[column];
      const row = `aria-label="${asHtml(label)}`;
      if (isSecurityColumn(column)) expect(html, column).toContain(row);
      else expect(html, column).not.toContain(row);
    }
  });

  it("says why the list is short", () => {
    expect(renderOff()).toContain("sends security email only");
  });
});
