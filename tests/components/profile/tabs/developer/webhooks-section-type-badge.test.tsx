/**
 * The webhook list says what a webhook is actually sent.
 *
 * A row saved as discord on one of Discord's /slack or /github endpoints holds
 * that type forever, while deliveries and the test message go by
 * deliveryFormat. A badge reading the stored type told the user Discord about
 * a webhook that receives Slack blocks or plain JSON.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebhookItem } from "@/components/profile/types";
import { WebhooksSection } from "@/components/profile/tabs/developer/webhooks-section";

const DISCORD_COLOUR = "#5865F2";
const SLACK_COLOUR = "#E01E5A";

function renderRow(type: string, url: string): string {
  const webhook: WebhookItem = {
    id: 12,
    url,
    name: "Alerts",
    type,
    active: true,
    created_at: "2026-11-01T00:00:00.000Z",
    user_id: 7,
    team_id: null,
  };
  const props = {
    webhooks: [webhook],
    webhookName: "",
    onWebhookNameChange: () => {},
    webhookUrl: "",
    onWebhookUrlChange: () => {},
    addingWebhook: false,
    onAddWebhook: () => {},
    testingWebhookId: null,
    onTestWebhook: () => {},
    onRequestConfirm: () => {},
    newlyCreatedWebhookSecret: null,
    onDismissNewWebhookSecret: () => {},
    togglingWebhookId: null,
    onToggleWebhookActive: () => {},
    onSaveWebhookEdit: async () => null,
    rotatingWebhookId: null,
    onRotateWebhookSecret: () => {},
    openDeliveriesId: null,
    onToggleDeliveries: () => {},
    deliveries: [],
    loadingDeliveries: false,
    deliveriesError: null,
    currentUserId: 7,
    teams: { assignable: [], all: [], loaded: true },
    assigningTeamWebhookId: null,
    onAssignWebhookTeam: async () => null,
  } as unknown as Parameters<typeof WebhooksSection>[0];
  return renderToStaticMarkup(<WebhooksSection {...props} />);
}

function badge(html: string): { label: string; classes: string } {
  const match = />Alerts<\/p><span class="([^"]*)">([^<]*)<\/span>/.exec(html);
  if (!match) throw new Error("the type badge did not render after the name");
  return { classes: match[1], label: match[2] };
}

describe("the type badge in the webhook list", () => {
  it.each<[string, string, string, string, string | null]>([
    [
      "a stored discord row on Discord's /slack endpoint reads slack",
      "discord",
      "https://discord.com/api/webhooks/1/tok/slack",
      "slack",
      SLACK_COLOUR,
    ],
    [
      "a stored discord row on Discord's /github endpoint reads generic",
      "discord",
      "https://discord.com/api/webhooks/1/tok/github",
      "generic",
      null,
    ],
    [
      "an ordinary Discord webhook reads discord",
      "discord",
      "https://discord.com/api/webhooks/1/tok",
      "discord",
      DISCORD_COLOUR,
    ],
    [
      "a discord type pinned on a proxy reads discord",
      "discord",
      "https://proxy.example/hooks/slack",
      "discord",
      DISCORD_COLOUR,
    ],
    [
      "a Slack webhook reads slack",
      "slack",
      "https://hooks.slack.com/services/T/B/x",
      "slack",
      SLACK_COLOUR,
    ],
    [
      "a generic webhook reads generic",
      "generic",
      "https://example.com/hook",
      "generic",
      null,
    ],
  ])("%s", (_label, type, url, expectedLabel, colour) => {
    const shown = badge(renderRow(type, url));

    expect(shown.label).toBe(expectedLabel);
    if (colour) expect(shown.classes).toContain(colour);
    else expect(shown.classes).toContain("bg-muted");
  });

  it.each<[string, string, string, string[]]>([
    [
      "/slack",
      "https://discord.com/api/webhooks/1/tok/slack",
      SLACK_COLOUR,
      [DISCORD_COLOUR],
    ],
    [
      "/github",
      "https://discord.com/api/webhooks/1/tok/github",
      "lucide-globe",
      [DISCORD_COLOUR, SLACK_COLOUR],
    ],
  ])(
    "shows no Discord mark beside a row on Discord's %s endpoint",
    (_endpoint, url, expected, absent) => {
      const html = renderRow("discord", url);

      expect(html).toContain(expected);
      for (const colour of absent) expect(html).not.toContain(colour);
    },
  );
});
