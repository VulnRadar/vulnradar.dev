/**
 * Sharing a webhook, schedule or domain with a team is chosen in a dialog and
 * applied on Save. The control used to be a bare select whose onChange fired
 * the PATCH the moment the option moved, with the result in a page banner.
 *
 * No DOM here, so React state is stood in for by a slot per useState call
 * (the mocked-react pattern of tests/lib/hooks/use-focus-on-mount.test.ts):
 * a test sets a slot the way a click would, renders again, and reads what the
 * dialog handed to EditDialog.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TeamOption } from "@/lib/hooks/use-assignable-teams";

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
  description?: ReactNode;
  size?: string;
  saveLabel?: string;
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

const { TeamAssignSelect, TeamAssignDialog, teamTriggerText } =
  await import("@/components/shared/team-assign-select");
const { editCloseDecision, interpretEditSave } =
  await import("@/components/shared/edit-dialog-outcome");

const TEAMS: TeamOption[] = [
  { id: 3, name: "Platform", role: "admin" },
  { id: 5, name: "Payments", role: "member" },
];

/**
 * Strip tags until nothing changes: one pass over crafted markup can leave a
 * tag behind, which is what js/incomplete-multi-character-sanitization
 * reports, test file or not.
 */
function stripTags(markup: string): string {
  let out = markup;
  let before: string;
  do {
    before = out;
    out = out.replace(/<[^>]+>/g, "");
  } while (out !== before);
  return out;
}

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

afterEach(() => {
  vi.clearAllMocks();
});

describe("the trigger", () => {
  it("renders nothing for an account with no teams and nothing to clear", () => {
    expect(
      render(
        <TeamAssignSelect
          teams={[]}
          value={null}
          label="Team for Alerts"
          onChange={() => null}
        />,
      ),
    ).toBe("");
  });

  it("says Not shared for a personal resource and names the team otherwise", () => {
    expect(teamTriggerText(TEAMS, null)).toBe("Not shared");
    expect(teamTriggerText(TEAMS, 3)).toBe("Platform");
    // The caller can no longer assign to team 9, but the row still names it.
    expect(teamTriggerText(TEAMS, 9, "Legacy")).toBe("Legacy");
    expect(teamTriggerText(TEAMS, 9)).toBe("Its current team");
  });

  it("puts the row's name in the accessible name, after the visible text's own words", () => {
    const html = render(
      <TeamAssignSelect
        teams={TEAMS}
        value={null}
        label="Team for Alerts"
        onChange={() => null}
      />,
    );
    // The accessible name is the button's text content, so the sr-only prefix
    // and the visible text together make "Team for Alerts: Not shared", which
    // contains the visible "Not shared" (WCAG 2.5.3).
    expect(stripTags(html)).toBe("Team for Alerts: Not shared");
    expect(html).toContain('<span class="sr-only">Team for Alerts: </span>');
    expect(html).not.toContain("aria-label");
  });

  it("is at least 24px tall at every width", () => {
    const html = render(
      <TeamAssignSelect
        teams={TEAMS}
        value={3}
        label="Team for Alerts"
        onChange={() => null}
      />,
    );
    expect(html).toContain("h-11 sm:h-8");
    expect(html).toContain(">Platform<");
  });

  it("does not render the dialog until it is opened", () => {
    render(
      <TeamAssignSelect
        teams={TEAMS}
        value={3}
        label="Team for Alerts"
        onChange={() => null}
      />,
    );
    expect(captured).toHaveLength(0);
    slots[0] = true;
    render(
      <TeamAssignSelect
        teams={TEAMS}
        value={3}
        label="Team for Alerts"
        description="Your teammates can see and pause it."
        onChange={() => null}
      />,
    );
    expect(captured).toHaveLength(1);
    expect(last().title).toBe("Share with a team");
  });

  it("keeps the hook order when the teams arrive after the first render", () => {
    // No teams yet: returns null, but must still have declared its state.
    render(
      <TeamAssignSelect
        teams={[]}
        value={null}
        label="Team for Alerts"
        onChange={() => null}
      />,
    );
    const slotsAfterEmpty = cursor;
    render(
      <TeamAssignSelect
        teams={TEAMS}
        value={null}
        label="Team for Alerts"
        onChange={() => null}
      />,
    );
    expect(cursor).toBe(slotsAfterEmpty);
  });
});

describe("the dialog", () => {
  function dialog(
    value: number | null,
    onChange: (teamId: number | null) => unknown,
    extra: Partial<{ currentTeamName: string | null }> = {},
  ) {
    return (
      <TeamAssignDialog
        teams={TEAMS}
        value={value}
        label="Team for Alerts"
        description="Your teammates can see and pause it."
        onChange={onChange as never}
        onClose={() => {}}
        {...extra}
      />
    );
  }

  it("opens on the saved team with the select, its options, Cancel and Save", () => {
    const html = render(dialog(3, () => null));
    expect(html).toContain("Share with a team");
    expect(html).toContain("Your teammates can see and pause it.");
    expect(html).toContain('aria-label="Team for Alerts"');
    expect(html).toContain('<option value="">Not assigned to a team</option>');
    expect(html).toMatch(/<option value="3" selected[^>]*>Platform<\/option>/);
    expect(html).toContain(">Payments</option>");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Save<");
    expect(last().size).toBe("sm");
    expect(last().saveLabel).toBe("Save");
  });

  it("lists the current team when the caller can no longer assign to it", () => {
    const html = render(dialog(9, () => null, { currentTeamName: "Legacy" }));
    expect(html).toContain('<option value="9"');
    expect(html).toContain(">Legacy</option>");
  });

  it("holds Save closed until the choice differs from the saved team", () => {
    render(dialog(3, () => null));
    expect(last().canSave).toBe(false);
    expect(last().dirty).toBe(false);
    slots[0] = 5;
    render(dialog(3, () => null));
    expect(last().canSave).toBe(true);
    expect(last().dirty).toBe(true);
  });

  it("does not call onChange until Save, then sends the chosen team", async () => {
    const onChange = vi.fn(() => null);
    render(dialog(3, onChange));
    slots[0] = 5;
    render(dialog(3, onChange));
    expect(onChange).not.toHaveBeenCalled();
    await last().onSave();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("sends null for Not assigned to a team", async () => {
    const onChange = vi.fn(() => null);
    render(dialog(3, onChange));
    slots[0] = null;
    render(dialog(3, onChange));
    expect(last().canSave).toBe(true);
    await last().onSave();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("keeps the dialog open with the server's message when the PATCH is refused", async () => {
    const onChange = vi.fn(
      async () => "Only this webhook's owner can do that.",
    );
    render(dialog(null, onChange));
    slots[0] = 3;
    render(dialog(null, onChange));
    expect(interpretEditSave((await last().onSave()) as never)).toEqual({
      kind: "failed",
      message: "Only this webhook's owner can do that.",
    });
  });

  it("closes on a null outcome", async () => {
    const onChange = vi.fn(async () => null);
    render(dialog(null, onChange));
    slots[0] = 3;
    render(dialog(null, onChange));
    expect(interpretEditSave((await last().onSave()) as never)).toEqual({
      kind: "saved",
    });
  });

  it("Cancel and Escape never save", () => {
    const onChange = vi.fn(() => null);
    const onClose = vi.fn();
    render(
      <TeamAssignDialog
        teams={TEAMS}
        value={3}
        label="Team for Alerts"
        onChange={onChange}
        onClose={onClose}
      />,
    );
    // Untouched: closes straight away.
    expect(
      editCloseDecision({ busy: false, dirty: last().dirty ?? false }),
    ).toBe("close");
    last().onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    // Changed: the dialog asks before discarding, and still never saves.
    slots[0] = 5;
    render(
      <TeamAssignDialog
        teams={TEAMS}
        value={3}
        label="Team for Alerts"
        onChange={onChange}
        onClose={onClose}
      />,
    );
    expect(
      editCloseDecision({ busy: false, dirty: last().dirty ?? false }),
    ).toBe("confirm-discard");
    expect(onChange).not.toHaveBeenCalled();
  });
});
