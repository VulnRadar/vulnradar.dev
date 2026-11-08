import {
  saveFailureMessage,
  saveThrownMessage,
} from "@/components/shared/save-confirmation-outcome";

/**
 * Returned from `onSave` when the save handed over to another step (a password
 * prompt, the next screen of a setup) and the dialog should neither close nor
 * show an error.
 */
export const KEEP_OPEN: unique symbol = Symbol("edit-dialog-keep-open");

/**
 * Every shape of "did it work" the existing save handlers already return:
 * nothing or an empty string (worked), a message (did not), `{ ok, error }`
 * from the admin action wrappers, and a throw from the teams request helper.
 * One mapping accepts all of them so no call site has to translate first.
 */
export type EditSaveOutcome =
  | void
  | null
  | undefined
  | string
  | { ok: boolean; error?: string }
  | typeof KEEP_OPEN;

export type EditSaveResult =
  | { kind: "saved" }
  | { kind: "failed"; message: string }
  | { kind: "kept-open" };

export function interpretEditSave(outcome: EditSaveOutcome): EditSaveResult {
  if (outcome === KEEP_OPEN) return { kind: "kept-open" };
  if (typeof outcome === "string") {
    return outcome === ""
      ? { kind: "saved" }
      : { kind: "failed", message: outcome };
  }
  if (outcome && typeof outcome === "object") {
    const message = saveFailureMessage(outcome);
    return message === null ? { kind: "saved" } : { kind: "failed", message };
  }
  return { kind: "saved" };
}

export function interpretEditThrow(err: unknown): EditSaveResult {
  return { kind: "failed", message: saveThrownMessage(err) };
}

/**
 * What closing the dialog does right now. A save in flight cannot be walked
 * away from (the request is already out, and closing would hide its result);
 * unsaved changes are asked about; anything else just closes.
 */
export function editCloseDecision(state: {
  busy: boolean;
  dirty: boolean;
}): "blocked" | "confirm-discard" | "close" {
  if (state.busy) return "blocked";
  if (state.dirty) return "confirm-discard";
  return "close";
}

export const DISCARD_PROMPT = {
  title: "Discard your changes?",
  description: "What you changed here has not been saved.",
  confirmLabel: "Discard changes",
  cancelLabel: "Keep editing",
} as const;

/**
 * The submit sequence, with React taken out so it can be tested under node.
 * Resolves to null when the submit was ignored (a second Enter while saving,
 * or a form that is not valid yet), otherwise to what happened.
 */
export async function runEditSubmit(args: {
  onSave: () => EditSaveOutcome | Promise<EditSaveOutcome>;
  canSave: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  close: () => void;
}): Promise<EditSaveResult | null> {
  if (args.busy || !args.canSave) return null;
  args.setBusy(true);
  args.setError(null);
  let result: EditSaveResult;
  try {
    result = interpretEditSave(await args.onSave());
  } catch (err) {
    result = interpretEditThrow(err);
  }
  try {
    if (result.kind === "saved") args.close();
    else if (result.kind === "failed") args.setError(result.message);
  } finally {
    args.setBusy(false);
  }
  return result;
}
