/**
 * What the dashboard says out loud when a scan changes state.
 *
 * The console swaps three unrelated views on `status`: the form, the scanning
 * card, and the result or failure. Each swap unmounts whatever the person was
 * on, and the only live region in the flow lived inside the scanning card, so
 * completion and failure were never announced to anyone who could not see the
 * screen change. The page now keeps one polite region mounted outside those
 * views and writes the sentence from here into it.
 *
 * Pure on purpose: the page cannot be mounted in a test, but "which sentence
 * for which state" can be, in every language. The words are in
 * lib/i18n/messages (dashboard.announce*).
 */
import type { ScanStatus } from "@/lib/scanner/types";

export type ScanAnnouncement =
  | { type: "complete"; findings: number }
  | { type: "failed"; reason: string }
  | { type: "stillRunning" }
  | { type: "cancelled" };

export type AnnouncementKey =
  | "announceComplete"
  | "announceFailed"
  | "announceStillRunning"
  | "announceCancelled";

export interface AnnouncementMessage {
  key: AnnouncementKey;
  values?: Record<string, string | number>;
}

/** The translation key and values for an announcement. */
export function announcementMessage(a: ScanAnnouncement): AnnouncementMessage {
  switch (a.type) {
    case "complete":
      return { key: "announceComplete", values: { count: a.findings } };
    case "failed":
      return { key: "announceFailed", values: { reason: a.reason } };
    case "stillRunning":
      return { key: "announceStillRunning" };
    case "cancelled":
      return { key: "announceCancelled" };
  }
}

export interface AnnouncementState {
  status: ScanStatus;
  /** How many findings the finished result shows, once there is one. */
  findings: number | null;
  /** The failure screen being shown, when there is one. */
  failure: { kind: string; title: string } | null;
  /** The person pressed Stop, which returns to the form without a result. */
  cancelled: boolean;
}

/**
 * The announcement for the state the page is in, or null for none.
 *
 * Null while scanning on purpose. That clears the region, so the same
 * sentence twice running ("Scan complete: 3 findings" after two scans of the
 * same site) is a change in the DOM both times and is read both times; a live
 * region only speaks when its text changes. The scanning card has its own
 * progress status and does not need this one.
 */
export function currentAnnouncement(
  state: AnnouncementState,
): ScanAnnouncement | null {
  switch (state.status) {
    case "done":
      return state.findings === null
        ? null
        : { type: "complete", findings: state.findings };
    case "failed":
      if (!state.failure) return null;
      // The page stopped waiting; the scan itself did not fail.
      return state.failure.kind === "still_running"
        ? { type: "stillRunning" }
        : { type: "failed", reason: state.failure.title };
    case "idle":
      return state.cancelled ? { type: "cancelled" } : null;
    default:
      return null;
  }
}
