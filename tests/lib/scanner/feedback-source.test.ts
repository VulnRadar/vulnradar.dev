/**
 * Who wrote a feedback row is the row's `source` column and nothing else
 * (lib/scanner/feedback-source.ts). It used to be two things: every reader
 * compared the note the verifier writes while the column was written by the
 * boot backfill alone, so a person who overrode an AI row was human by note
 * and 'ai' by source. The writers are held to the column here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  AI_FEEDBACK_NOTE,
  HUMAN_FEEDBACK_SQL,
  isAiFeedback,
} from "@/lib/scanner/feedback-source";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("feedback source", () => {
  it("reads who wrote a row from its source alone", () => {
    expect(isAiFeedback({ source: "ai" })).toBe(true);
    expect(isAiFeedback({ source: "human" })).toBe(false);
    expect(isAiFeedback({ source: null })).toBe(false);
    expect(isAiFeedback({})).toBe(false);
  });

  it("matches only rows a person wrote, by the column", () => {
    expect(HUMAN_FEEDBACK_SQL).toBe("source = 'human'");
    expect(HUMAN_FEEDBACK_SQL).not.toContain("notes");
  });

  it("is what the verifier writes on its rows", () => {
    const source = read("lib/ai/verify-findings.ts");
    expect(source).toMatch(/verdict, notes, source\)/);
    // The verifier interpolates the note into its SQL, so its source holds
    // the placeholder rather than the note's text. Built in two parts so it
    // does not read as a template literal written with the wrong quotes.
    expect(source).toContain("'$" + "{AI_FEEDBACK_NOTE}', 'ai'");
    expect(AI_FEEDBACK_NOTE).not.toContain("'");
  });

  it("is what a person's verdict writes, on insert and on the update that takes over an AI row", () => {
    const route = read("app/api/v3/scan/feedback/route.ts");
    expect(route).toContain("VALUES ($1, $2, $3, $4, $5, $6, 'human')");
    expect(route).toContain("source = 'human', created_at = NOW()");
  });
});
