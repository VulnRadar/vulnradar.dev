/**
 * What to tell the person when the live-browser provider says no.
 *
 * `BrowserBaseError.message` is built from the provider's raw response body:
 * `BrowserBase create session failed (429): {"error":"..."}`. Every route that
 * caught it handed that string straight to `ApiResponse.error`, so a third
 * party's error text, and whatever it happens to name, was rendered in the
 * browser and in the extension.
 *
 * This is the same rule lib/api/scan-error-message.ts applies to stored scan
 * errors, applied at the same boundary: a fixed set of sentences we wrote,
 * chosen by status code, while the raw text stays in the server log where an
 * operator debugging it is already looking.
 *
 * Each sentence says what happened AND what to do, because "Bad Request" tells
 * a user nothing they can act on.
 */
export function publicBrowserSessionMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Live browser sessions are not set up correctly on this instance. An operator needs to check its live-browser credentials.";
  }
  if (status === 404) {
    return "That live browser session no longer exists. It may have ended on its own; start a new one.";
  }
  if (status === 429) {
    return "The live-browser provider is rate limiting us right now. Try again in a minute.";
  }
  if (status >= 500) {
    return "The live-browser provider is having problems right now. Your account was not charged for this. Try again in a minute.";
  }
  return "The live browser session could not start. Try again in a minute; if it keeps happening, let us know.";
}
