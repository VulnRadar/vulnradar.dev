import { pluralize } from "@/lib/ui/plural";

/**
 * How long one step-up lasts, and how fresh a sign-in counts as one
 * (lib/auth/reauth.ts). Its own file, with nothing server-only in it, so the
 * step-up screen (components/shared/email-step-up.tsx) states the same window
 * the server enforces instead of a copy of the number.
 */
export const STEP_UP_MAX_AGE_SECONDS = 10 * 60;

/** The window in words for copy: "10 minutes". */
export const STEP_UP_WINDOW = pluralize(
  Math.round(STEP_UP_MAX_AGE_SECONDS / 60),
  "minute",
);
