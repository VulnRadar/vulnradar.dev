/**
 * What the webhook row and its edit dialog offer depends on who is looking.
 *
 * A webhook URL for Discord or Slack is the credential: whoever has it can
 * post to the channel. A read-only teammate gets the host and nothing else,
 * and a co-member who can write may rename the webhook but not repoint it,
 * so neither may be handed a field that could only fail or, worse, one seeded
 * with something that is not the address.
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebhookItem } from "@/components/profile/types";

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

type SaveDraft = { name: string; url?: string };
type CapturedProps = { canSave?: boolean; onSave: () => unknown };
const captured: CapturedProps[] = [];

vi.mock("@/components/shared/edit-dialog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/shared/edit-dialog")>();
  return {
    ...actual,
    EditDialog: (props: CapturedProps) => {
      captured.push(props);
      return (actual.EditDialog as (p: CapturedProps) => ReactNode)(props);
    },
  };
});

const { WebhookEditDialog, WebhooksSection, webhookEditState } =
  await import("@/components/profile/tabs/developer/webhooks-section");

const SHARED: WebhookItem = {
  id: 21,
  url: "https://discord.com/api/webhooks/1/full-token",
  url_host: "discord.com",
  name: "Team alerts",
  type: "discord",
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  user_id: 99,
  team_id: 4,
};
const REDACTED: WebhookItem = { ...SHARED, url: null };

function sectionHtml(
  webhook: WebhookItem,
  assignable: { id: number; name: string }[],
): string {
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
    teams: { assignable, all: assignable, loaded: true },
    assigningTeamWebhookId: null,
    onAssignWebhookTeam: async () => null,
  } as unknown as Parameters<typeof WebhooksSection>[0];
  return renderToStaticMarkup(<WebhooksSection {...props} />);
}

describe("a read-only teammate's row", () => {
  it("shows the host, and no write control at all", () => {
    const html = sectionHtml(REDACTED, []);
    expect(html).toContain("discord.com");
    for (const control of [
      "Edit webhook",
      "Send test webhook",
      "Delete webhook",
      "Rotate the signing secret",
      "Pause Team alerts",
    ]) {
      expect(html, control).not.toContain(control);
    }
  });

  it("offers no write control even in a team the caller can manage", () => {
    // A super admin's webhook shared into a team: the role says write, the
    // server says read-only, and the null URL is how the row knows.
    const html = sectionHtml(REDACTED, [{ id: 4, name: "Ops" }]);
    expect(html).not.toContain("Edit webhook");
    expect(html).not.toContain("Delete webhook");
  });
});

describe("a co-member with write access", () => {
  it("sees the address and the edit control", () => {
    const html = sectionHtml(SHARED, [{ id: 4, name: "Ops" }]);
    expect(html).toContain("full-token");
    expect(html).toContain("Edit webhook Team alerts");
  });

  it("gets a dialog with the name and no URL field", async () => {
    const onSave = vi.fn(async (_id: number, _draft: SaveDraft) => null);
    const html = renderToStaticMarkup(
      <WebhookEditDialog
        webhook={SHARED}
        canEditUrl={false}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('id="edit-webhook-name"');
    expect(html).not.toContain('id="edit-webhook-url"');
    expect(html).not.toContain("full-token");

    await captured.at(-1)?.onSave();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(21, { name: "Team alerts" });
  });
});

describe("the redacted URL never reaches the field", () => {
  it("draws no URL field for a null URL, even if the caller asks for one", () => {
    const html = renderToStaticMarkup(
      <WebhookEditDialog
        webhook={REDACTED}
        canEditUrl
        onSave={async () => null}
        onClose={() => {}}
      />,
    );
    expect(html).not.toContain('id="edit-webhook-url"');
    expect(html).not.toContain('value="discord.com"');
  });
});

describe("webhookEditState without a URL in the draft", () => {
  const saved = { name: SHARED.name, url: SHARED.url };

  it("is clean when the name did not change", () => {
    expect(webhookEditState(saved, { name: SHARED.name })).toEqual({
      dirty: false,
      canSave: false,
    });
  });

  it("can save a new name with no URL to validate", () => {
    expect(webhookEditState(saved, { name: "Renamed" })).toEqual({
      dirty: true,
      canSave: true,
    });
  });
});
