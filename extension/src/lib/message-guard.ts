// The trust boundary of the background's message router.
//
// background/service-worker.ts answers one onMessage listener for three kinds
// of caller that deserve very different trust:
//
//   - the extension's own pages (popup, options): they may start a scan of any
//     address and export a report, because a person is driving them;
//   - the content script running inside a web page: it may report that a page
//     loaded and act on the card the extension showed on that page, nothing
//     more, because everything it knows came from or through a page the
//     extension does not control;
//   - anything else: ignored.
//
// Before this, the router switched on `kind` alone, so a message of any kind
// from any sender was honoured. This module decides, from the message and the
// sender, whether to honour it and hands back a copy that has been narrowed to
// exactly what the handler needs. It is pure (no browser APIs) so the table of
// who may send what is a unit test.

import { isReportFormat } from "./types";
import type { ReportFormat, ScanMode } from "./types";
import { isValidUrlPattern } from "./url-patterns";

/** The parts of runtime.MessageSender the guard reads. */
export interface SenderLike {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
  readonly tab?:
    | {
        readonly id?: number | undefined;
        readonly url?: string | undefined;
        readonly incognito?: boolean | undefined;
      }
    | undefined;
}

export interface GuardContext {
  /** runtime.getURL("") : every page of this extension starts with it. */
  readonly extensionBase: string;
  /** runtime.id, when known. A sender that names a different id is refused. */
  readonly extensionId?: string | undefined;
}

export interface SenderTab {
  readonly id: number;
  readonly url: string;
  readonly incognito: boolean;
}

export type ValidatedMessage =
  | {
      readonly kind: "scan:url";
      readonly url: string;
      readonly mode?: ScanMode;
    }
  | {
      readonly kind: "report:export";
      readonly id: number;
      readonly format: ReportFormat;
      readonly host: string;
    }
  | { readonly kind: "page:loaded"; readonly tab: SenderTab }
  | { readonly kind: "reputation:scan"; readonly tab: SenderTab }
  | {
      readonly kind: "reputation:mute-site";
      readonly tab: SenderTab;
      readonly pattern: string;
    }
  | { readonly kind: "reputation:mute-global" }
  | {
      readonly kind: "reputation:snooze-site";
      readonly tab: SenderTab;
      readonly host: string;
    };

/** Longest address accepted from the popup. Browsers stop well short of this. */
export const MAX_URL_LENGTH = 2048;
/** The longest a DNS name can be. */
export const MAX_HOST_LENGTH = 253;

/**
 * True when the message came from one of this extension's own pages. Decided
 * by the sender's URL: a content script reports the URL of the web page it is
 * running in, so it can never start with the extension's own base.
 */
export function isExtensionPage(
  sender: SenderLike,
  ctx: GuardContext,
): boolean {
  if (ctx.extensionId !== undefined && sender.id !== undefined) {
    if (sender.id !== ctx.extensionId) return false;
  }
  return (
    ctx.extensionBase !== "" &&
    typeof sender.url === "string" &&
    sender.url.startsWith(ctx.extensionBase)
  );
}

/**
 * The tab a content script's message came from, or null when the sender is not
 * one. An options page opened in a tab also has a `sender.tab`, which is why
 * the extension-page test comes first.
 */
export function contentScriptTab(
  sender: SenderLike,
  ctx: GuardContext,
): SenderTab | null {
  if (isExtensionPage(sender, ctx)) return null;
  const tab = sender.tab;
  if (!tab || typeof tab.id !== "number" || typeof tab.url !== "string") {
    return null;
  }
  return { id: tab.id, url: tab.url, incognito: tab.incognito === true };
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Returns the message narrowed to what its handler may rely on, or null when
 * the sender may not send it or any field is malformed. The caller answers
 * null with an empty response and does nothing else.
 */
export function validateMessage(
  raw: unknown,
  sender: SenderLike,
  ctx: GuardContext,
): ValidatedMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;

  switch (m.kind) {
    case "scan:url": {
      if (!isExtensionPage(sender, ctx)) return null;
      if (typeof m.url !== "string" || m.url.length > MAX_URL_LENGTH) {
        return null;
      }
      if (m.mode === undefined) return { kind: "scan:url", url: m.url };
      if (m.mode !== "quick" && m.mode !== "deep") return null;
      return { kind: "scan:url", url: m.url, mode: m.mode };
    }

    case "report:export": {
      if (!isExtensionPage(sender, ctx)) return null;
      if (
        typeof m.id !== "number" ||
        !Number.isSafeInteger(m.id) ||
        m.id <= 0
      ) {
        return null;
      }
      if (!isReportFormat(m.format)) return null;
      if (typeof m.host !== "string" || m.host.length > MAX_HOST_LENGTH) {
        return null;
      }
      return {
        kind: "report:export",
        id: m.id,
        format: m.format,
        host: m.host,
      };
    }

    case "page:loaded":
    case "reputation:scan": {
      const tab = contentScriptTab(sender, ctx);
      return tab ? { kind: m.kind, tab } : null;
    }

    case "reputation:mute-site": {
      const tab = contentScriptTab(sender, ctx);
      if (!tab) return null;
      const pattern = m.pattern;
      if (typeof pattern !== "string" || pattern.length > MAX_URL_LENGTH) {
        return null;
      }
      if (!isValidUrlPattern(pattern)) return null;
      // The card only ever mutes the site it is shown on, and sends that
      // site's origin. Holding it to that means a page cannot widen the mute to
      // https://*.com even if it could reach the message channel.
      if (pattern !== originOf(tab.url)) return null;
      return { kind: "reputation:mute-site", tab, pattern };
    }

    case "reputation:mute-global": {
      return contentScriptTab(sender, ctx)
        ? { kind: "reputation:mute-global" }
        : null;
    }

    case "reputation:snooze-site": {
      const tab = contentScriptTab(sender, ctx);
      if (!tab) return null;
      const host = m.host;
      if (typeof host !== "string" || host.length > MAX_HOST_LENGTH) {
        return null;
      }
      if (host !== hostnameOf(tab.url)) return null;
      return { kind: "reputation:snooze-site", tab, host };
    }

    default:
      return null;
  }
}
