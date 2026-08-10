// browser.tabs.sendMessage helper that guarantees the returned promise
// always settles.
//
// Firefox-specific gotcha: browser.tabs.sendMessage only rejects promptly
// when NO listener was ever registered for the tab at all (chrome://
// pages, the web store, a page that hasn't finished loading yet) - both
// Chrome and Firefox raise "Could not establish connection. Receiving end
// does not exist." for that case, immediately. But when a listener WAS
// registered (the content script loaded fine and is sitting there) and the
// tab has since sat in the background long enough for Firefox to throttle
// it (see the real about:config pref
// browser.tabs.disableBackgroundZombification - Firefox calls this
// "zombification"), a message to that tab can go unanswered forever: the
// promise then neither resolves nor rejects. There's nothing to catch and
// no timeout of its own, so a caller doing `await browser.tabs.sendMessage`
// just hangs indefinitely with zero feedback - which reads as "frozen" to
// anyone driving the UI that triggered it. A page reload re-injects a
// fresh content script with a live message port, which is why manually
// refreshing the tab empirically "fixes" a call stuck like this.
//
// This wraps the call in a bounded race so it always settles one way or
// the other. Callers can then tell "no content script here" (silent,
// expected no-op - same as before) apart from "content script exists but
// isn't answering" (TabMessageTimeoutError - worth surfacing to the user).

import browser from "webextension-polyfill";

export class TabMessageTimeoutError extends Error {
  constructor() {
    super("Tab did not respond in time");
    this.name = "TabMessageTimeoutError";
  }
}

export async function sendTabMessage<T = unknown>(
  tabId: number,
  message: unknown,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TabMessageTimeoutError()), timeoutMs);
  });
  try {
    return (await Promise.race([
      browser.tabs.sendMessage(tabId, message),
      timeout,
    ])) as T;
  } finally {
    clearTimeout(timer!);
  }
}
