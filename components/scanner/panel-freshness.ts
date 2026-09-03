/**
 * The pure half of the "this capture can be re-run" behaviour shared by the
 * result panels under "More about this host" (DNS records, open ports, page
 * screenshot).
 *
 * Three panels had hand-copied the same three rules, and each copy had drifted
 * in a way the other two had not:
 *
 *  - the age + cooldown readout was written out twice (DNS, ports) and missing
 *    entirely from the screenshot panel, so a capture that costs real money was
 *    the one with no "how old is this" line;
 *  - both copies built the cooldown label as
 *    `new Date(new Date(capturedAt).getTime() + COOLDOWN).toISOString()`, which
 *    throws RangeError on a malformed timestamp and takes the whole panel down
 *    with it. `panelFreshness` returns null instead;
 *  - "what does a refresh response do to what is on screen" was an inline
 *    `else if (data.portScan)`, which silently did nothing when the server
 *    answered 200 with an unexpected body: no new data, no error, no
 *    explanation. `refreshOutcome` makes that case an explicit keep-and-say-so.
 *
 * The rule these encode, and the reason they are a module rather than three
 * copies: a refresh NEVER blanks what the reader already has. Existing content
 * stays put until replacement data actually arrives; every failure path keeps
 * it and surfaces the error beside it.
 *
 * Kept as plain TypeScript (no JSX) so it is unit-testable in the node
 * environment the suite runs in -- see components/scanner/panel-refresh.tsx for
 * the hook and the rows that consume it.
 */

import { formatAge, formatRefreshAvailability } from "@/lib/ui/relative-time";

export interface PanelFreshness {
  /** "3 hours ago", or null when the capture carries no usable timestamp. */
  age: string | null;
  /**
   * "Available to refresh in 4m", or null when this panel has no cooldown
   * window (the screenshot has none: every capture spends live-browser
   * minutes, so there is no cached answer to wait out).
   */
  availability: string | null;
}

/**
 * Age and cooldown labels for one capture. `cooldownMs` is the server-side TTL
 * within which a refresh returns the cached capture rather than a fresh one,
 * so the availability label is a real statement about the server, not a
 * client-side throttle.
 */
export function panelFreshness(
  capturedAt?: string | null,
  cooldownMs?: number,
): PanelFreshness {
  const age = formatAge(capturedAt);
  if (!capturedAt || !cooldownMs) return { age, availability: null };
  const capturedMs = new Date(capturedAt).getTime();
  // Guarded, not assumed: a NaN here used to reach `new Date(NaN).toISOString()`
  // one line later, which throws RangeError rather than returning null.
  if (Number.isNaN(capturedMs)) return { age, availability: null };
  return {
    age,
    availability: formatRefreshAvailability(
      new Date(capturedMs + cooldownMs).toISOString(),
    ),
  };
}

/**
 * What a refresh response does to the panel: replace the data on screen, or
 * keep what is there and show why it did not change.
 */
export type RefreshOutcome<T> =
  { kind: "replace"; data: T } | { kind: "keep"; error: string };

/**
 * Decide the outcome of one refresh request. `keep` on every failure, and also
 * on a 200 whose body does not carry the capture -- a response that says "ok"
 * but has nothing to show is a failure to refresh, not a reason to blank the
 * panel.
 */
export function refreshOutcome<T>(input: {
  ok: boolean;
  body: unknown;
  /** Key on the response body carrying the fresh capture ("portScan", ...). */
  responseKey: string;
  /** Shown when the server offered no message of its own. */
  failureMessage: string;
}): RefreshOutcome<T> {
  const body =
    input.body && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : {};

  if (!input.ok) {
    const serverError = body.error;
    return {
      kind: "keep",
      error:
        typeof serverError === "string" && serverError.length > 0
          ? serverError
          : input.failureMessage,
    };
  }

  const data = body[input.responseKey];
  if (data === undefined || data === null) {
    return { kind: "keep", error: input.failureMessage };
  }
  return { kind: "replace", data: data as T };
}

/**
 * Whether a panel may offer its run/refresh control at all.
 *
 * This is the single client-side expression of "only the owner can spend the
 * owner's quota". The four result surfaces render through one component
 * (components/scanner/scan-result-detail.tsx) and pass a scan id ONLY when the
 * viewer owns the scan: /shared (a public token report) and /host (any
 * stranger) pass none, and /history passes one only inside its `isOwner`
 * branch. The server re-checks ownership on every refresh route regardless
 * (lib/history/refresh-scan.ts resolveOwnedScan), so this decides what is drawn,
 * never what is permitted.
 */
export function panelControlsOffered(scanId?: string | number | null): boolean {
  if (scanId === undefined || scanId === null) return false;
  // A numeric 0 is not a scan id (the sequence starts at 1) and an empty
  // string is a missing route param, so both read as "no owner here".
  return scanId !== 0 && scanId !== "";
}
