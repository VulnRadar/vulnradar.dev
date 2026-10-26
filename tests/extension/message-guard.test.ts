import { describe, expect, it } from "vitest";

import {
  MAX_HOST_LENGTH,
  MAX_URL_LENGTH,
  validateMessage,
} from "../../extension/src/lib/message-guard";
import type {
  GuardContext,
  SenderLike,
} from "../../extension/src/lib/message-guard";

/**
 * The background's router used to switch on `kind` alone, so any message of
 * any kind from any sender was honoured. The table below is the whole policy:
 * who may send what, and what a message has to look like to be believed.
 */

const BASE = "moz-extension://test-uuid/";
const ctx: GuardContext = { extensionBase: BASE, extensionId: "ext@id" };

const popup: SenderLike = { id: "ext@id", url: `${BASE}popup.html` };
// An options page opened in a tab has a sender.tab, which must not make it a
// content script.
const optionsTab: SenderLike = {
  id: "ext@id",
  url: `${BASE}options.html`,
  tab: { id: 3, url: `${BASE}options.html` },
};
const content: SenderLike = {
  id: "ext@id",
  url: "https://example.com/account?x=1",
  tab: { id: 7, url: "https://example.com/account?x=1", incognito: false },
};
const noSender: SenderLike = {};
const otherExtension: SenderLike = { id: "someone@else", url: `${BASE}x.html` };
// A web page that puts the extension's base in its own path: a tab like any
// other, never an extension page.
const lookalike: SenderLike = {
  url: `https://evil.example/${BASE}popup.html`,
  tab: { id: 9, url: "https://evil.example/", incognito: false },
};

const SENDERS: Record<string, SenderLike> = {
  popup,
  "options tab": optionsTab,
  "content script": content,
  "no sender": noSender,
  "other extension": otherExtension,
  "lookalike page": lookalike,
};

interface Row {
  readonly message: unknown;
  /** Names from SENDERS that may send it. Every other sender is refused. */
  readonly accepted: readonly string[];
}

const EXTENSION_PAGES = ["popup", "options tab"];
const TABS = ["content script", "lookalike page"];

const TABLE: Record<string, Row> = {
  "scan:url": {
    message: { kind: "scan:url", url: "https://example.com/" },
    accepted: EXTENSION_PAGES,
  },
  "report:export": {
    message: {
      kind: "report:export",
      id: 12,
      format: "pdf",
      host: "example.com",
    },
    accepted: EXTENSION_PAGES,
  },
  "page:loaded": { message: { kind: "page:loaded" }, accepted: TABS },
  "reputation:scan": { message: { kind: "reputation:scan" }, accepted: TABS },
  "reputation:mute-global": {
    message: { kind: "reputation:mute-global" },
    accepted: TABS,
  },
  // These two name a site, and the site has to be the sender's own: the
  // lookalike page is a tab, but example.com is not its origin.
  "reputation:mute-site": {
    message: { kind: "reputation:mute-site", pattern: "https://example.com" },
    accepted: ["content script"],
  },
  "reputation:snooze-site": {
    message: { kind: "reputation:snooze-site", host: "example.com" },
    accepted: ["content script"],
  },
};

describe("validateMessage: who may send what", () => {
  for (const [kind, row] of Object.entries(TABLE)) {
    it(kind, () => {
      for (const [label, sender] of Object.entries(SENDERS)) {
        const verdict = validateMessage(row.message, sender, ctx);
        const shouldAccept = row.accepted.includes(label);
        expect(
          verdict !== null,
          `${kind} from ${label} should be ${shouldAccept ? "accepted" : "refused"}`,
        ).toBe(shouldAccept);
      }
    });
  }

  it("covers every kind the background handles", () => {
    expect(Object.keys(TABLE).sort()).toEqual(
      [
        "page:loaded",
        "report:export",
        "reputation:mute-global",
        "reputation:mute-site",
        "reputation:scan",
        "reputation:snooze-site",
        "scan:url",
      ].sort(),
    );
  });

  it("refuses an unknown kind, a non-object and a missing kind", () => {
    for (const message of [
      { kind: "does:not:exist" },
      { kind: 42 },
      {},
      null,
      undefined,
      "scan:url",
      42,
      [],
    ]) {
      for (const [label, sender] of Object.entries(SENDERS)) {
        expect(
          validateMessage(message, sender, ctx),
          `${JSON.stringify(message)} from ${label}`,
        ).toBeNull();
      }
    }
  });
});

describe("validateMessage: scan:url", () => {
  const scan = (extra: Record<string, unknown>) =>
    validateMessage({ kind: "scan:url", ...extra }, popup, ctx);

  it("passes a url and an optional mode through", () => {
    expect(scan({ url: "https://example.com/" })).toEqual({
      kind: "scan:url",
      url: "https://example.com/",
    });
    expect(scan({ url: "https://example.com/", mode: "deep" })).toEqual({
      kind: "scan:url",
      url: "https://example.com/",
      mode: "deep",
    });
  });

  it("refuses a bad mode, a non-string url and an oversized url", () => {
    expect(scan({ url: "https://example.com/", mode: "full" })).toBeNull();
    expect(scan({ url: "https://example.com/", mode: 1 })).toBeNull();
    expect(scan({ url: 42 })).toBeNull();
    expect(scan({})).toBeNull();
    expect(
      scan({ url: "https://e.com/" + "a".repeat(MAX_URL_LENGTH) }),
    ).toBeNull();
  });

  it("leaves a non-http address to the handler's own friendly refusal", () => {
    expect(scan({ url: "chrome://settings" })).toEqual({
      kind: "scan:url",
      url: "chrome://settings",
    });
  });
});

describe("validateMessage: report:export", () => {
  const exp = (extra: Record<string, unknown>) =>
    validateMessage(
      {
        kind: "report:export",
        id: 5,
        format: "pdf",
        host: "example.com",
        ...extra,
      },
      popup,
      ctx,
    );

  it("accepts a safe integer id and each documented format", () => {
    for (const format of ["sarif", "pdf", "md", "json"]) {
      expect(exp({ format })?.kind, format).toBe("report:export");
    }
    expect(exp({ id: Number.MAX_SAFE_INTEGER })?.kind).toBe("report:export");
  });

  it("refuses an id that is not a positive safe integer", () => {
    for (const id of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "12",
      "../../auth/me",
      null,
      undefined,
      {},
    ]) {
      expect(exp({ id }), String(id)).toBeNull();
    }
  });

  it("refuses a format outside the whitelist", () => {
    for (const format of [
      "html",
      "markdown",
      "compliance",
      "PDF",
      "pdf&x=1",
      "../x",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(exp({ format }), String(format)).toBeNull();
    }
  });

  it("refuses a host that is not a string or is longer than a DNS name", () => {
    expect(exp({ host: 5 })).toBeNull();
    expect(exp({ host: "a".repeat(MAX_HOST_LENGTH + 1) })).toBeNull();
    expect(exp({ host: "a".repeat(MAX_HOST_LENGTH) })?.kind).toBe(
      "report:export",
    );
  });
});

describe("validateMessage: tab-bound reputation messages", () => {
  it("carries the sender's tab, not anything the message says", () => {
    const m = validateMessage(
      {
        kind: "reputation:scan",
        url: "https://attacker.example/",
        tabId: 999,
      },
      content,
      ctx,
    );
    expect(m).toEqual({
      kind: "reputation:scan",
      tab: { id: 7, url: "https://example.com/account?x=1", incognito: false },
    });
  });

  it("refuses a content sender with no usable tab", () => {
    const noTabId: SenderLike = {
      url: "https://example.com/",
      tab: { url: "https://example.com/" },
    };
    const noTabUrl: SenderLike = {
      url: "https://example.com/",
      tab: { id: 1 },
    };
    for (const kind of [
      "page:loaded",
      "reputation:scan",
      "reputation:mute-global",
    ]) {
      expect(validateMessage({ kind }, noTabId, ctx), kind).toBeNull();
      expect(validateMessage({ kind }, noTabUrl, ctx), kind).toBeNull();
    }
  });

  it("reports whether the tab is private", () => {
    const privateTab: SenderLike = {
      url: "https://example.com/",
      tab: { id: 2, url: "https://example.com/", incognito: true },
    };
    const m = validateMessage({ kind: "page:loaded" }, privateTab, ctx);
    expect(m).toMatchObject({ tab: { incognito: true } });
  });

  describe("mute-site", () => {
    const mute = (pattern: unknown) =>
      validateMessage({ kind: "reputation:mute-site", pattern }, content, ctx);

    it("accepts exactly the origin of the tab it came from", () => {
      expect(mute("https://example.com")?.kind).toBe("reputation:mute-site");
    });

    it("refuses a pattern for any other site or a wider one", () => {
      for (const pattern of [
        "https://other.example",
        "https://*.example.com",
        "https://*.com",
        "https://example.com/*",
        "http://example.com",
        "https://example.com:8443",
        "example.com",
        "",
        42,
        null,
        undefined,
      ]) {
        expect(mute(pattern), String(pattern)).toBeNull();
      }
    });

    it("refuses a pattern the matcher cannot honour", () => {
      expect(mute("https://ex*ample.com")).toBeNull();
    });
  });

  describe("snooze-site", () => {
    const snooze = (host: unknown) =>
      validateMessage({ kind: "reputation:snooze-site", host }, content, ctx);

    it("accepts the hostname of the tab it came from", () => {
      expect(snooze("example.com")?.kind).toBe("reputation:snooze-site");
    });

    it("refuses another host, a non-string and an oversized host", () => {
      expect(snooze("other.example")).toBeNull();
      expect(snooze("example.com:8080")).toBeNull();
      expect(snooze(5)).toBeNull();
      expect(snooze(undefined)).toBeNull();
      expect(snooze("a".repeat(MAX_HOST_LENGTH + 1))).toBeNull();
    });
  });
});
