import type { MeResponse } from "@/components/providers/auth-provider";

/**
 * Is the terms gate standing in front of the app right now?
 *
 * components/auth/tos-gate.tsx owns this decision and this mirrors the two
 * comparisons it makes. It is duplicated rather than shared because the gate
 * expresses its answer as a rendered blur over `children`, and the tour is not
 * one of its children: it is a sibling in the root layout, mounted there so it
 * can survive a navigation. Without this check a brand-new account gets the
 * terms modal and the tour overlay stacked on each other at first sign-in,
 * with the tour on top telling them to type a URL into a form the gate has
 * deliberately made unreachable.
 */
export function termsGateOpen(
  me: Pick<MeResponse, "tosAcceptedAt" | "termsUpdatedAt">,
): boolean {
  if (!me.tosAcceptedAt) return true;
  if (!me.termsUpdatedAt) return false;
  return new Date(me.tosAcceptedAt) < new Date(me.termsUpdatedAt);
}

/**
 * Whether the tour's code is worth loading for this account right now.
 *
 * Signed in and clear of every modal that blocks the app on its own, then
 * either the account has never seen the tour or this tab has one half
 * finished. The signed-in half also covers the stale case: a session left
 * behind by a sign-out must not pull the tour's chunk down for whoever uses
 * the browser next.
 *
 * Two modals count as blocking. The terms gate, above, and the backup-code
 * reminder (components/shared/backup-codes-modal.tsx), which opens on any app
 * route for an account whose stored codes cannot be verified and inerts the
 * page behind it. The tour's spotlight sits above both (z-90 and z-100 against
 * the modal's z-50), so a tour that started anyway would draw its instructions
 * on top of a dialog and point at controls the dialog had made unreachable.
 * Waiting is the whole fix: rotating the codes flips the flag and the tour
 * starts on the next /auth/me.
 */
export function tourWanted(
  me:
    | Pick<
        MeResponse,
        | "userId"
        | "tosAcceptedAt"
        | "termsUpdatedAt"
        | "backupCodesInvalid"
        | "onboardingCompleted"
      >
    | null
    | undefined,
  resumable: boolean,
): boolean {
  if (!me?.userId) return false;
  if (termsGateOpen(me)) return false;
  if (me.backupCodesInvalid) return false;
  return me.onboardingCompleted === false || resumable;
}
