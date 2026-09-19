import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  resolveLocale,
  type Locale,
} from "./config";
import { getMessages } from "./messages";

/**
 * What language to render this request in, and the words to render it with.
 *
 * next.config.mjs points next-intl at this file. The account's saved setting
 * reaches it through the cookie (see lib/i18n/config.ts), so rendering a page
 * never waits on the database for it.
 */
export default getRequestConfig(async () => {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);

  const locale: Locale = resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  });

  return {
    locale,
    messages: await getMessages(locale),
    // The server's clock is UTC and the reader's is not. Without this,
    // next-intl warns on every relative time it formats.
    now: new Date(),
    onError(error) {
      // A missing translation falls back to English (see getMessages) and is
      // not worth an error log per render. Anything else is a real fault.
      if (error.code === "MISSING_MESSAGE") return;
      console.error(`[i18n] ${error.message}`);
    },
    getMessageFallback({ namespace, key }) {
      // The key itself, so a missing string reads as a label rather than
      // vanishing or throwing mid-page.
      return [namespace, key].filter(Boolean).join(".");
    },
  };
});

export { DEFAULT_LOCALE };
