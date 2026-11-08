/**
 * Editing a webhook's name and URL happens in a dialog, not in the row.
 *
 * The row used to turn into two inputs and a tick, with Save and Cancel as
 * 32px icon buttons, no Enter or Escape, and a failed save reported in the
 * page banner. The dialog holds the form, shows the reason inside itself, and
 * leaves the webhook alone until Save.
 *
 * No DOM here, so React state is stood in for by a slot per useState call
 * (the mocked-react pattern of tests/lib/hooks/use-focus-on-mount.test.ts).
 */
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebhookItem } from "@/components/profile/types";

const slots: unknown[] = [];
let cursor = 0;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const at = cursor++;
      if (!(at in slots)) {
        slots[at] = typeof initial === "function" ? initial() : initial;
      }
      return [
        slots[at],
        (next: unknown) => {
          slots[at] = typeof next === "function" ? next(slots[at]) : next;
        },
      ];
    },
  };
});

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

type CapturedProps = {
  title: ReactNode;
  dirty?: boolean;
  canSave?: boolean;
  onSave: () => unknown;
  onOpenChange: (open: boolean) => void;
};
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
const { editCloseDecision, interpretEditSave } =
  await import("@/components/shared/edit-dialog-outcome");

const WEBHOOK: WebhookItem = {
  id: 12,
  url: "https://discord.com/api/webhooks/1/abc",
  name: "Discord Alerts",
  type: "discord",
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  user_id: 7,
  team_id: null,
};

function render(node: ReactNode): string {
  cursor = 0;
  return renderToStaticMarkup(<>{node}</>);
}

function last(): CapturedProps {
  const props = captured.at(-1);
  if (!props) throw new Error("EditDialog was never rendered");
  return props;
}

beforeEach(() => {
  slots.length = 0;
  captured.length = 0;
  cursor = 0;
});

describe("the dialog opens on the saved webhook", () => {
  it("shows both fields with their saved values, labelled, and Cancel and Save", () => {
    const html = render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={async () => null}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Edit webhook");
    expect(html).toContain('for="edit-webhook-name"');
    expect(html).toContain('id="edit-webhook-name"');
    expect(html).toContain('value="Discord Alerts"');
    expect(html).toContain('placeholder="Default"');
    expect(html).toContain('for="edit-webhook-url"');
    expect(html).toContain('type="url"');
    expect(html).toContain('value="https://discord.com/api/webhooks/1/abc"');
    expect(html).toContain("Discord and Slack URLs are detected from the");
    expect(html).toContain('aria-describedby="edit-webhook-url-hint"');
    expect(html).toContain('id="edit-webhook-url-hint"');
    // The dialog's fieldset has no gap of its own, so the fields bring one.
    expect(html).toContain('<div class="grid gap-4">');
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Save changes<");
  });

  it("holds Save closed until something changed", () => {
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={async () => null}
        onClose={() => {}}
      />,
    );
    expect(last().canSave).toBe(false);
    expect(last().dirty).toBe(false);
  });
});

describe("webhookEditState", () => {
  const saved = { name: "Discord Alerts", url: WEBHOOK.url };

  it("is neither dirty nor savable for the saved values", () => {
    expect(webhookEditState(WEBHOOK, saved)).toEqual({
      dirty: false,
      canSave: false,
    });
  });

  it("is both for a new name or a new URL", () => {
    expect(webhookEditState(WEBHOOK, { ...saved, name: "Ops" })).toEqual({
      dirty: true,
      canSave: true,
    });
    expect(
      webhookEditState(WEBHOOK, { ...saved, url: "https://example.com/hook" }),
    ).toEqual({ dirty: true, canSave: true });
  });

  it("asks before discarding but will not save an empty URL", () => {
    expect(webhookEditState(WEBHOOK, { ...saved, url: "  " })).toEqual({
      dirty: true,
      canSave: false,
    });
  });

  it("ignores a stray space", () => {
    expect(
      webhookEditState(WEBHOOK, { ...saved, name: "Discord Alerts " }),
    ).toEqual({ dirty: false, canSave: false });
  });
});

describe("Save", () => {
  it("sends the edited name and URL for this webhook", async () => {
    const onSave = vi.fn(async () => null);
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    slots[0] = " Ops channel ";
    slots[1] = "https://hooks.slack.com/services/T/B/x ";
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(last().canSave).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    await last().onSave();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(12, {
      name: "Ops channel",
      url: "https://hooks.slack.com/services/T/B/x",
    });
  });

  it("stays open with the server's message when the PATCH fails", async () => {
    const onSave = vi.fn(async () => "That URL points at a private address.");
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    slots[1] = "http://10.0.0.1/hook";
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(interpretEditSave((await last().onSave()) as never)).toEqual({
      kind: "failed",
      message: "That URL points at a private address.",
    });
  });

  it("closes when the save resolves to null", async () => {
    const onSave = vi.fn(async () => null);
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    slots[0] = "Renamed";
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(interpretEditSave((await last().onSave()) as never)).toEqual({
      kind: "saved",
    });
  });
});

describe("Cancel and Escape", () => {
  it("close straight away when nothing changed, and never save", () => {
    const onSave = vi.fn(async () => null);
    const onClose = vi.fn();
    render(
      <WebhookEditDialog webhook={WEBHOOK} onSave={onSave} onClose={onClose} />,
    );
    expect(
      editCloseDecision({ busy: false, dirty: last().dirty ?? false }),
    ).toBe("close");
    last().onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ask before throwing away an edit, and never save", () => {
    const onSave = vi.fn(async () => null);
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    slots[0] = "Renamed";
    render(
      <WebhookEditDialog
        webhook={WEBHOOK}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(
      editCloseDecision({ busy: false, dirty: last().dirty ?? false }),
    ).toBe("confirm-discard");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("do nothing while a save is in flight", () => {
    expect(editCloseDecision({ busy: true, dirty: true })).toBe("blocked");
  });
});

function sectionProps(over: Partial<{ currentUserId: number | null }> = {}) {
  return {
    webhooks: [WEBHOOK],
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
    ...over,
  } as unknown as Parameters<typeof WebhooksSection>[0];
}

describe("the pencil in the list", () => {
  it("keeps its name, its tap target and its writable gate", () => {
    const html = render(<WebhooksSection {...sectionProps()} />);
    expect(html).toContain('aria-label="Edit webhook Discord Alerts"');
    expect(html).toContain("h-11 w-11 sm:h-7 sm:w-7");
    // Closed: the row still shows the saved name, not an input.
    expect(html).not.toContain("edit-webhook-name");
    expect(captured).toHaveLength(0);
  });

  it("is not offered to someone who may not write to the webhook", () => {
    const html = render(
      <WebhooksSection {...sectionProps({ currentUserId: 99 })} />,
    );
    expect(html).not.toContain("Edit webhook Discord Alerts");
  });

  it("opens the dialog on the row's webhook, and closes it if the webhook leaves the list", () => {
    const emptyList = {
      ...sectionProps(),
      webhooks: [],
    } as unknown as Parameters<typeof WebhooksSection>[0];
    // With no rows nothing else holds state, so the section's own last
    // useState is the webhook being edited.
    render(<WebhooksSection {...emptyList} />);
    const editingSlot = cursor - 1;
    slots.length = 0;

    slots[editingSlot] = WEBHOOK;
    const withDialog = render(<WebhooksSection {...sectionProps()} />);
    expect(withDialog).toContain('id="edit-webhook-url"');
    expect(withDialog).toContain('value="Discord Alerts"');
    expect(captured).toHaveLength(1);

    captured.length = 0;
    const gone = render(<WebhooksSection {...emptyList} />);
    expect(captured).toHaveLength(0);
    expect(gone).not.toContain("edit-webhook-url");
  });
});

describe("the wiring in the Developer tab", () => {
  const ROOT = path.resolve(__dirname, "../../../../..");
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  const SHELL = read("components/profile/tabs/profile-developer-tab.tsx");
  const SECTION = read(
    "components/profile/tabs/developer/webhooks-section.tsx",
  );

  function body(source: string, declaration: string, length = 1200) {
    const start = source.indexOf(declaration);
    expect(start, `${declaration} not found`).toBeGreaterThan(-1);
    return source.slice(start, start + length);
  }

  it("PATCHes the webhook with the name, the URL and type auto, and no teamId", () => {
    const save = body(SHELL, "async function handleSaveWebhookEdit", 900);
    expect(save).toContain("`${API.WEBHOOKS}/${id}`");
    expect(save).toContain('method: "PATCH"');
    expect(save).toContain('name: draft.name || "Default"');
    expect(save).toContain("url: draft.url");
    expect(save).toContain('type: "auto"');
    expect(save).not.toContain("teamId");
  });

  it("returns the reason instead of writing the page banner", () => {
    const save = body(SHELL, "async function handleSaveWebhookEdit", 900);
    expect(save).toContain('return data.error || "Failed to update webhook."');
    expect(save).toContain('return "Failed to update webhook."');
    expect(save).not.toContain("setError");
    expect(save).toContain("{ ...w, ...data }");
    expect(save).toContain('setSuccess("Webhook updated.")');
    expect(save).toContain("return null;");
  });

  it("no longer holds an inline editor's state", () => {
    for (const gone of [
      "editingWebhookId",
      "editWebhookName",
      "editWebhookUrl",
      "savingWebhookEdit",
      "handleStartEditWebhook",
      "handleCancelEditWebhook",
    ]) {
      expect(SHELL, gone).not.toContain(gone);
      expect(SECTION, gone).not.toContain(gone);
    }
  });

  it("keeps the add row inline", () => {
    expect(SECTION).toContain('id="webhook-name"');
    expect(SECTION).toContain("onClick={onAddWebhook}");
  });

  it("writes no em dash in the copy it added", () => {
    expect(SECTION).not.toContain("—");
  });
});
