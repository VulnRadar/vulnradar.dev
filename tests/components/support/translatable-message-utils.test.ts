import { describe, it, expect } from "vitest";
import {
  TRANSLATE_FAILED_TEXT,
  originalTextLang,
  translateStatusText,
} from "@/components/support/translatable-message-utils";

/**
 * A support message in someone else's language must be read out in it
 * (WCAG 3.1.2), and the one thing that can go wrong with a translation must be
 * announced rather than silently leaving the text as it was.
 */
describe("originalTextLang", () => {
  it("tags the author's own words with the language they wrote in", () => {
    expect(originalTextLang("ja", false)).toBe("ja");
    expect(originalTextLang("de", false)).toBe("de");
  });

  it("leaves a translation to inherit the page's language", () => {
    // The translation is in the reader's language, which is the page's.
    expect(originalTextLang("ja", true)).toBeUndefined();
  });

  it("sets nothing when the language is not known yet", () => {
    expect(originalTextLang(null, false)).toBeUndefined();
    expect(originalTextLang(undefined, false)).toBeUndefined();
    expect(originalTextLang("", false)).toBeUndefined();
  });

  it("will not put a value the app does not speak into a lang attribute", () => {
    expect(originalTextLang("klingon", false)).toBeUndefined();
    expect(originalTextLang('en" onload="x', false)).toBeUndefined();
  });
});

describe("translateStatusText", () => {
  it("is empty until a translation fails, so the live region exists but says nothing", () => {
    expect(translateStatusText(false)).toBe("");
  });

  it("says what happened and what the reader is looking at", () => {
    expect(translateStatusText(true)).toBe(TRANSLATE_FAILED_TEXT);
    expect(TRANSLATE_FAILED_TEXT).toContain("shown as written");
  });
});
