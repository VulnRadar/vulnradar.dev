import { pluralize } from "@/lib/ui/plural";

/**
 * How long a rate-limited caller has to wait, as words: "under a minute",
 * "a minute", "4 minutes". Replaces the `${minutes} minute(s)` every limiter
 * used to print. Rounded up, so waiting exactly as long as it says works.
 */
export function retryIn(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "under a minute";
  if (seconds === 60) return "a minute";
  return pluralize(Math.ceil(seconds / 60), "minute");
}

/** The one refusal sentence: "Too many login attempts. Try again in 2 minutes." */
export function TOO_MANY_ATTEMPTS(what: string, seconds: number): string {
  return `Too many ${what}. Try again in ${retryIn(seconds)}.`;
}
