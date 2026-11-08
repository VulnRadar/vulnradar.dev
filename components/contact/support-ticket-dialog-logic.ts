import { API } from "@/lib/config/client-constants";
import type { TicketCategory } from "@/lib/support/ticket-constants";

/**
 * The parts of the two support-ticket dialogs that are decisions rather than
 * markup: what counts as changed, when Save opens, what is sent, in what
 * order, and what the person is told when only some of it went through. Kept
 * out of the component so they can be tested under node without a DOM.
 */

export interface NewTicketDraft {
  subject: string;
  category: TicketCategory;
  message: string;
  turnstileToken: string | null;
}

export const EMPTY_TICKET_DRAFT: NewTicketDraft = {
  subject: "",
  category: "other",
  message: "",
  turnstileToken: null,
};

/**
 * Closing asks first when any field has text. The category is not counted: it
 * always holds a value, so a dialog opened and closed untouched is not
 * "changed", and a token arriving is the widget's doing, not the person's.
 */
export function newTicketDirty(draft: NewTicketDraft): boolean {
  return draft.subject.trim() !== "" || draft.message.trim() !== "";
}

/** Save stays shut until both required fields have text and, with the captcha on, the token has arrived. */
export function newTicketCanSave(
  draft: NewTicketDraft,
  turnstileEnabled: boolean,
): boolean {
  if (draft.subject.trim() === "" || draft.message.trim() === "") return false;
  return !turnstileEnabled || !!draft.turnstileToken;
}

/** The POST body. The token is null, not absent, when the captcha is off. */
export function newTicketBody(
  draft: NewTicketDraft,
  turnstileEnabled: boolean,
) {
  return {
    subject: draft.subject,
    category: draft.category,
    message: draft.message,
    turnstileToken: turnstileEnabled ? draft.turnstileToken : null,
  };
}

export type CreateTicketResult =
  { ok: true; id: number } | { ok: false; error: string };

const CREATE_FAILED = "Could not open the ticket.";

export async function createTicket(
  draft: NewTicketDraft,
  turnstileEnabled: boolean,
): Promise<CreateTicketResult> {
  try {
    const res = await fetch(API.SUPPORT_TICKETS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTicketBody(draft, turnstileEnabled)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || CREATE_FAILED };
    const id = Number(data?.ticket?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: CREATE_FAILED };
    }
    return { ok: true, id };
  } catch {
    return { ok: false, error: CREATE_FAILED };
  }
}

export interface ShareEntry {
  userId: number;
  email: string;
  name: string | null;
}

export interface ShareLists {
  shares: ShareEntry[];
  eligible: ShareEntry[];
}

export function shareLabel(entry: ShareEntry): string {
  return entry.name ? `${entry.name} (${entry.email})` : entry.email;
}

export type LoadSharesResult =
  ({ ok: true } & ShareLists) | { ok: false; error: string };

export async function fetchShares(ticketId: number): Promise<LoadSharesResult> {
  try {
    const res = await fetch(API.SUPPORT_TICKET_SHARES(ticketId));
    if (!res.ok) throw new Error("Could not load sharing.");
    const data = await res.json();
    return {
      ok: true,
      shares: data.shares ?? [],
      eligible: data.eligible ?? [],
    };
  } catch {
    return { ok: false, error: "Could not load sharing." };
  }
}

export interface ShareOp {
  kind: "add" | "remove";
  userId: number;
  label: string;
}

/**
 * What Save sends: the staged adds first, then the staged removes, each in the
 * order the list shows them. Adding before removing means a failure part way
 * never leaves the ticket with fewer people than the person meant it to have.
 */
export function planShareOps(
  lists: ShareLists,
  added: ReadonlySet<number>,
  removed: ReadonlySet<number>,
): ShareOp[] {
  const adds = lists.eligible
    .filter((e) => added.has(e.userId))
    .map((e) => ({
      kind: "add" as const,
      userId: e.userId,
      label: shareLabel(e),
    }));
  const removes = lists.shares
    .filter((s) => removed.has(s.userId))
    .map((s) => ({
      kind: "remove" as const,
      userId: s.userId,
      label: shareLabel(s),
    }));
  return [...adds, ...removes];
}

export type ShareSendResult = { ok: true } | { ok: false; error?: string };

export async function sendShareOp(
  ticketId: number,
  op: ShareOp,
): Promise<ShareSendResult> {
  const fallback =
    op.kind === "add"
      ? "Could not share the ticket."
      : "Could not update sharing.";
  try {
    const res =
      op.kind === "add"
        ? await fetch(API.SUPPORT_TICKET_SHARES(ticketId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: op.userId }),
          })
        : await fetch(
            `${API.SUPPORT_TICKET_SHARES(ticketId)}?userId=${op.userId}`,
            { method: "DELETE" },
          );
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data?.error || fallback };
  } catch {
    return { ok: false, error: fallback };
  }
}

export interface ShareRunResult {
  done: ShareOp[];
  /** The op that failed, with why. Null when every op went through. */
  failed: { op: ShareOp; error: string } | null;
  /** Never attempted, because an earlier one failed. */
  skipped: ShareOp[];
}

/** One at a time and in order. The first failure stops the run. */
export async function runShareOps(
  ops: readonly ShareOp[],
  send: (op: ShareOp) => Promise<ShareSendResult>,
): Promise<ShareRunResult> {
  const done: ShareOp[] = [];
  for (const [i, op] of ops.entries()) {
    const result = await send(op);
    if (!result.ok) {
      return {
        done,
        failed: { op, error: result.error ?? "Could not update sharing." },
        skipped: ops.slice(i + 1),
      };
    }
    done.push(op);
  }
  return { done, failed: null, skipped: [] };
}

function names(ops: readonly ShareOp[]): string {
  return ops.map((o) => o.label).join(", ");
}

/**
 * Says what did go through before it says what did not, so a person looking at
 * a dialog that stayed open knows which of their changes to expect already
 * took effect. Null when nothing failed.
 */
export function shareFailureMessage(run: ShareRunResult): string | null {
  if (!run.failed) return null;
  const added = run.done.filter((o) => o.kind === "add");
  const removed = run.done.filter((o) => o.kind === "remove");
  const went: string[] = [];
  if (added.length > 0) went.push(`Shared with ${names(added)}.`);
  if (removed.length > 0) went.push(`Removed ${names(removed)}.`);
  const verb = run.failed.op.kind === "add" ? "share with" : "remove";
  const tail =
    run.skipped.length > 0
      ? ` ${run.skipped.length} other ${run.skipped.length === 1 ? "change was" : "changes were"} not tried.`
      : "";
  const reason = /[.!?]$/.test(run.failed.error)
    ? run.failed.error
    : `${run.failed.error}.`;
  return [
    ...went,
    `Could not ${verb} ${run.failed.op.label}: ${reason}${tail}`,
  ].join(" ");
}

/**
 * The ids still staged after a run: the one that failed and everything after
 * it. What went through is now the saved state, not a pending change.
 */
export function remainingStaged(run: ShareRunResult): {
  added: Set<number>;
  removed: Set<number>;
} {
  const left = run.failed ? [run.failed.op, ...run.skipped] : [];
  return {
    added: new Set(left.filter((o) => o.kind === "add").map((o) => o.userId)),
    removed: new Set(
      left.filter((o) => o.kind === "remove").map((o) => o.userId),
    ),
  };
}
