/**
 * What the dashboard announces when a scan changes state
 * (app/dashboard/scan-announcement.ts) and the sentences it announces it in.
 *
 * The console swaps three views on `status` and the only live region in the
 * flow used to unmount with the scanning card, so a screen reader user heard
 * "Scan starting" and then nothing: not completion, not the finding count, not
 * a failure. These tests are the transitions, and the words in all six
 * languages through the real ICU formatter, since a plural rule or a
 * placeholder that does not survive translation reads as garbage aloud.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import {
  announcementMessage,
  currentAnnouncement,
  type AnnouncementState,
} from "@/app/dashboard/scan-announcement";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/config";

const base: AnnouncementState = {
  status: "idle",
  findings: null,
  failure: null,
  cancelled: false,
};

describe("currentAnnouncement", () => {
  it("says nothing on the idle form", () => {
    expect(currentAnnouncement(base)).toBeNull();
  });

  it("says nothing while scanning, which clears the region for the next scan", () => {
    // A live region only speaks when its text changes. Clearing it here is
    // what lets "Scan complete: 3 findings" be read again after a second scan
    // of the same site.
    expect(
      currentAnnouncement({ ...base, status: "scanning", findings: 3 }),
    ).toBeNull();
  });

  it("announces completion with the finding count", () => {
    expect(
      currentAnnouncement({ ...base, status: "done", findings: 7 }),
    ).toEqual({ type: "complete", findings: 7 });
  });

  it("announces a clean scan as a completed one, not silence", () => {
    expect(
      currentAnnouncement({ ...base, status: "done", findings: 0 }),
    ).toEqual({ type: "complete", findings: 0 });
  });

  it("does not announce a result that has no count yet", () => {
    expect(currentAnnouncement({ ...base, status: "done" })).toBeNull();
  });

  it("announces a failure by the same title the failure screen carries", () => {
    expect(
      currentAnnouncement({
        ...base,
        status: "failed",
        failure: { kind: "network", title: "The target never answered" },
      }),
    ).toEqual({ type: "failed", reason: "The target never answered" });
  });

  it("does not call a client that stopped waiting a failed scan", () => {
    expect(
      currentAnnouncement({
        ...base,
        status: "failed",
        failure: { kind: "still_running", title: "This scan is still running" },
      }),
    ).toEqual({ type: "stillRunning" });
  });

  it("announces a failure that has no screen yet as nothing rather than guessing", () => {
    expect(currentAnnouncement({ ...base, status: "failed" })).toBeNull();
  });

  it("announces Stop, which returns to the form with nothing else to say why", () => {
    expect(currentAnnouncement({ ...base, cancelled: true })).toEqual({
      type: "cancelled",
    });
  });

  it("lets a new scan or a reset clear the cancel notice", () => {
    expect(
      currentAnnouncement({ ...base, status: "scanning", cancelled: true }),
    ).toBeNull();
  });
});

describe("announcementMessage", () => {
  it("maps every announcement to a dashboard.announce* key with its values", () => {
    expect(announcementMessage({ type: "complete", findings: 4 })).toEqual({
      key: "announceComplete",
      values: { count: 4 },
    });
    expect(announcementMessage({ type: "failed", reason: "x" })).toEqual({
      key: "announceFailed",
      values: { reason: "x" },
    });
    expect(announcementMessage({ type: "stillRunning" }).key).toBe(
      "announceStillRunning",
    );
    expect(announcementMessage({ type: "cancelled" }).key).toBe(
      "announceCancelled",
    );
  });
});

type Tree = { [key: string]: string | Tree };

function load(locale: string): Tree {
  return JSON.parse(
    readFileSync(`lib/i18n/messages/${locale}.json`, "utf8"),
  ) as Tree;
}

function translator(locale: string) {
  // Only the namespace the page reads, typed as plain strings so the keys under
  // test are not narrowed to whatever the JSON file happens to hold today.
  const dashboard = load(locale).dashboard as Record<string, string>;
  return createTranslator({
    locale,
    messages: { dashboard },
    namespace: "dashboard",
  });
}

const KEYS = [
  "announceComplete",
  "announceFailed",
  "announceCancelled",
  "announceStillRunning",
] as const;

describe.each(LOCALES)("announcement sentences in %s", (locale) => {
  const t = translator(locale);

  it("has all four, translated", () => {
    const own = (load(locale).dashboard as Tree) ?? {};
    const english = (load(DEFAULT_LOCALE).dashboard as Tree) ?? {};
    for (const key of KEYS) {
      expect(typeof own[key], `${locale} is missing ${key}`).toBe("string");
      if (locale !== DEFAULT_LOCALE) {
        // Real translations, not English copied into the file: a copy would
        // satisfy the fallback anyway and hide that nobody wrote it.
        expect(own[key], `${locale}.${key} is still English`).not.toBe(
          english[key],
        );
      }
    }
  });

  it("reads a count of none, one and many without leaving ICU syntax behind", () => {
    for (const count of [0, 1, 5]) {
      const text = t("announceComplete", { count });
      expect(text).not.toMatch(/[{}]|plural|#/);
      expect(text.length).toBeGreaterThan(8);
    }
    // The three counts are three different sentences.
    expect(
      new Set([0, 1, 5].map((count) => t("announceComplete", { count }))).size,
    ).toBe(3);
  });

  it("puts the failure title into the sentence", () => {
    const text = t("announceFailed", { reason: "REASON-TITLE" });
    expect(text).toContain("REASON-TITLE");
    expect(text).not.toMatch(/[{}]/);
  });

  it("has fixed sentences for cancel and still-running", () => {
    expect(t("announceCancelled")).not.toMatch(/[{}]/);
    expect(t("announceStillRunning")).not.toMatch(/[{}]/);
  });
});

describe("English wording", () => {
  const t = translator("en");

  it("names the count, and says none when there are none", () => {
    expect(t("announceComplete", { count: 0 })).toBe(
      "Scan complete: no findings.",
    );
    expect(t("announceComplete", { count: 1 })).toBe(
      "Scan complete: 1 finding.",
    );
    expect(t("announceComplete", { count: 12 })).toBe(
      "Scan complete: 12 findings.",
    );
  });

  it("tells a person who stopped waiting that the scan goes on", () => {
    expect(t("announceStillRunning")).toMatch(/still running/i);
    expect(t("announceStillRunning")).toMatch(/History/);
  });

  it("uses no em dash, per the copy rules", () => {
    for (const key of KEYS) {
      expect(t(key, { count: 2, reason: "x" })).not.toContain("—");
    }
  });
});
