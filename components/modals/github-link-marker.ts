/**
 * Proof, kept in this tab, that the person here just pressed Link on the GitHub
 * card.
 *
 * The post-connect sync dialog opens only for a connection made moments ago.
 * Discord's row has a timestamp for that; a GitHub sign-in is four columns on
 * `users` and records no time. sessionStorage survives the round trip through
 * GitHub, belongs to this tab alone, and cannot be set by a link from anywhere
 * else, which is the property the check exists for.
 */

const KEY = "vr-github-link-started";

/** The life of the signed OAuth state: a later return could not complete. */
export const GITHUB_LINK_MARKER_MAX_AGE_MS = 10 * 60_000;

export function markGithubLinkStarted(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage blocked: the dialog stays shut, and linking still works.
  }
}

/** Read without being spent, so a re-run of the caller's effect sees it too. */
export function githubLinkJustStarted(): boolean {
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored === null) return false;
    const age = Date.now() - Number(stored);
    return age >= 0 && age <= GITHUB_LINK_MARKER_MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function clearGithubLinkMarker(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if storage is blocked.
  }
}
