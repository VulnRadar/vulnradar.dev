/**
 * What the Teams list's rename does when it is driven: which team the dialog
 * opens for, what Save sends, and what a refusal and Cancel do.
 *
 * There is no DOM here, so the list and the dialog are called as functions
 * (see ../users/_hook-harness.ts) and their handlers are driven directly.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { mockReact } = await import("../users/_hook-harness");
  return mockReact(await importOriginal<typeof import("react")>());
});

const { harness, find, findAll, labelled, ofType } =
  await import("../users/_hook-harness");
const { RenameTeamDialog, TeamsList } =
  await import("@/components/admin/teams/teams-list");
const { EditDialog } = await import("@/components/shared/edit-dialog");
const { editCloseDecision, runEditSubmit } =
  await import("@/components/shared/edit-dialog-outcome");

const team = {
  id: 5,
  name: "Acme",
  slug: "acme",
  owner_id: 1,
  owner_email: "owner@example.com",
  owner_name: "Owner",
  owner_avatar_url: null,
  member_count: 3,
  created_at: "2026-01-01T00:00:00Z",
};

function setup(result: { ok: boolean; error?: string } = { ok: true }) {
  const handleTeamRename = vi.fn(async () => result);
  const props = {
    teams: [team],
    teamsLoading: false,
    teamsSearch: "",
    setTeamsSearch: () => {},
    fetchTeams: () => {},
    teamsTotalPages: 1,
    teamsPage: 1,
    teamsPageSize: 25,
    setTeamsPageSize: () => {},
    handleTeamRename,
    handleTeamDelete: () => {},
    fetchTeamMembers: () => {},
    teamMembers: null,
    setTeamMembers: () => {},
    teamMembersLoading: false,
    actionLoading: null,
    callerRole: "super_admin",
  };
  const list = harness(TeamsList);
  const render = () => list.render(props);
  return { render, handleTeamRename };
}

/** Tap one of the two pencils and open the dialog it asks for. */
function openRename(render: () => unknown, which: 0 | 1) {
  const pencils = findAll(render(), labelled("Rename Acme"));
  expect(pencils).toHaveLength(2);
  (pencils[which].props.onClick as () => void)();
  const el = find(render(), ofType(RenameTeamDialog));
  const dialog = harness(RenameTeamDialog);
  const props = el.props as Parameters<typeof RenameTeamDialog>[0];
  return { props, render: () => dialog.render(props) };
}

function type(tree: unknown, value: string) {
  (
    find(tree, (el) => el.props.name === "name").props.onChange as (
      e: unknown,
    ) => void
  )({ target: { value } });
}

function edit(tree: unknown) {
  return find(tree, ofType(EditDialog)).props as {
    onSave: () => unknown;
    onOpenChange: (open: boolean) => void;
    canSave: boolean;
    dirty: boolean;
  };
}

describe("renaming a team", () => {
  it.each([
    [0, "the table row"],
    [1, "the phone card"],
  ] as const)(
    "%s: %s opens the dialog for that team and saves the trimmed name",
    async (which, _where) => {
      const { render, handleTeamRename } = setup();
      const dialog = openRename(render, which);
      expect(dialog.props.team).toEqual({ id: 5, name: "Acme" });
      let tree = dialog.render();
      type(tree, "  Acme Labs ");
      tree = dialog.render();
      expect(edit(tree).canSave).toBe(true);
      expect(await edit(tree).onSave()).toEqual({ ok: true });
      expect(handleTeamRename).toHaveBeenCalledTimes(1);
      expect(handleTeamRename).toHaveBeenCalledWith(5, "Acme Labs");
    },
  );

  it("a refused rename keeps the dialog open with the server's reason", async () => {
    const { render } = setup({ ok: false, error: "Name already taken" });
    const dialog = openRename(render, 1);
    let tree = dialog.render();
    type(tree, "Taken");
    tree = dialog.render();
    const close = vi.fn();
    const setError = vi.fn();
    const result = await runEditSubmit({
      onSave: edit(tree).onSave as never,
      canSave: edit(tree).canSave,
      busy: false,
      setBusy: () => {},
      setError,
      close,
    });
    expect(result).toEqual({ kind: "failed", message: "Name already taken" });
    expect(close).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith("Name already taken");
  });

  it("Cancel and Escape close without renaming", () => {
    const { render, handleTeamRename } = setup();
    const dialog = openRename(render, 0);
    let tree = dialog.render();
    type(tree, "Something else");
    tree = dialog.render();
    expect(edit(tree).dirty).toBe(true);
    expect(editCloseDecision({ busy: false, dirty: true })).toBe(
      "confirm-discard",
    );
    edit(tree).onOpenChange(false);
    expect(handleTeamRename).not.toHaveBeenCalled();
    expect(findAll(render(), ofType(RenameTeamDialog))).toHaveLength(0);
  });
});
