/**
 * The note is the only marker separating an AI-written feedback row from a
 * person's: the verifier writes it inside a SQL literal, and every suppressing
 * reader compares against it. If the two drift apart nothing fails at runtime,
 * every AI row just starts counting as a human verdict again, so the verifier
 * is held to the one constant here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  AI_FEEDBACK_NOTE,
  HUMAN_FEEDBACK_SQL,
  isAiFeedbackNote,
} from "@/lib/scanner/feedback-source";

describe("feedback source", () => {
  it("recognises only the verifier's exact note", () => {
    expect(isAiFeedbackNote(AI_FEEDBACK_NOTE)).toBe(true);
    expect(isAiFeedbackNote(null)).toBe(false);
    expect(isAiFeedbackNote(undefined)).toBe(false);
    expect(isAiFeedbackNote("")).toBe(false);
    expect(isAiFeedbackNote("Checked by hand, our WAF answers this.")).toBe(
      false,
    );
  });

  it("is the note the verifier actually writes", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/ai/verify-findings.ts"),
      "utf8",
    );
    expect(source).toContain("'${AI_FEEDBACK_NOTE}'");
    expect(source).toContain(
      'import { AI_FEEDBACK_NOTE } from "@/lib/scanner/feedback-source";',
    );
  });

  it("keeps a row with no note, and stays a valid single SQL literal", () => {
    expect(HUMAN_FEEDBACK_SQL).toBe(
      `COALESCE(notes, '') <> '${AI_FEEDBACK_NOTE}'`,
    );
    expect(AI_FEEDBACK_NOTE).not.toContain("'");
  });
});
