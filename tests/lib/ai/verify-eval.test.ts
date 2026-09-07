import { describe, it, expect, vi } from "vitest";
import {
  VERIFY_EVAL_CASES,
  splitByExpected,
  type VerifyEvalCase,
} from "@/lib/ai/verify-eval-cases";
import { VERIFY_SYSTEM_PROMPT } from "@/lib/ai/verify-context";

// verify-findings imports the pool at module scope, which throws without a
// DATABASE_URL. Nothing here touches the database: the eval builds a prompt
// and parses a reply. Same mock every other test in this directory uses.
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const { buildVerifyPrompt, parseVerifyResponseText } =
  await import("@/lib/ai/verify-findings");

/**
 * Two suites in one file, because they are two halves of the same guarantee.
 *
 * The first always runs. It cannot tell you whether a verdict is right (that
 * needs a model), but it can tell you the case set is intact and that the
 * prompt still contains the rules the cases depend on. That is the cheap half,
 * and it is the half that fails in CI when someone deletes a rule.
 *
 * The second only runs with AI_EVAL=1 and a configured endpoint. It sends the
 * real prompt to the real model and scores the verdicts. It is not in CI
 * because it costs tokens and depends on a third party being up, which are
 * both bad properties for a required check. It is what you run when you touch
 * the prompt.
 *
 *   AI_EVAL=1 npx vitest run tests/lib/ai/verify-eval.test.ts
 *   $env:AI_EVAL=1; npx vitest run tests/lib/ai/verify-eval.test.ts
 */

describe("the verification eval set", () => {
  it("covers both directions of error", () => {
    // A prompt can always be made to score well on one half by getting worse
    // at the other: confirming everything is 100% on the real findings and 0%
    // on the false positives. A set weighted heavily to one side rewards
    // exactly that, so both halves stay substantial.
    const { shouldConfirm, shouldFlag } = splitByExpected(VERIFY_EVAL_CASES);
    expect(shouldConfirm.length).toBeGreaterThanOrEqual(5);
    expect(shouldFlag.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every case a rationale someone can argue with", () => {
    // A label with no reasoning behind it gets "fixed" by flipping the label
    // the first time it fails. The rationale is what makes that a decision.
    for (const c of VERIFY_EVAL_CASES) {
      expect(
        c.rationale.length,
        `${c.name} has no real rationale`,
      ).toBeGreaterThan(80);
    }
  });

  it("keeps the rule each case exercises present in the prompt", () => {
    // The point of this assertion: a case exists because a rule exists. Delete
    // the rule and the case starts failing in the live run for a reason nobody
    // will connect back to the deletion, so fail here instead, at build time,
    // naming the rule.
    const missing = VERIFY_EVAL_CASES.filter(
      (c) => !VERIFY_SYSTEM_PROMPT.includes(c.rule),
    ).map((c) => `${c.name} -> "${c.rule}"`);

    expect(
      missing,
      "These eval cases point at guidance that is no longer in " +
        "verify-context.ts. Either restore the rule or retire the case:\n  " +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("still carries the guidance that produced the known-wrong verdicts", () => {
    // The two regressions in the set were caused by guidance that said the
    // opposite of these lines. They are pinned by text because that is what
    // the model actually reads.
    expect(VERIFY_SYSTEM_PROMPT).toContain("Unfixable is not untrue");
    expect(VERIFY_SYSTEM_PROMPT).toContain("Never confirm by default");
    expect(VERIFY_SYSTEM_PROMPT).toContain(
      "It is not about whether the reader will act on it",
    );
  });

  it("names every regression case as one", () => {
    // These already happened in production once. If the set ever loses them,
    // the loudest signal in the scorecard goes with them.
    const regressions = VERIFY_EVAL_CASES.filter((c) => c.regression);
    expect(regressions.length).toBeGreaterThanOrEqual(2);
  });

  it("builds a real prompt for every case", () => {
    // The eval sends the SAME buildVerifyPrompt the scanner sends. A copy
    // would drift and then prove nothing about production behaviour.
    for (const c of VERIFY_EVAL_CASES) {
      const prompt = buildVerifyPrompt(c.finding, c.probe);
      expect(prompt).toContain(`finding_id: ${c.finding.id}`);
      expect(prompt).toContain("live_probe:");
    }
  });
});

/**
 * How far off the model is allowed to be before this fails.
 *
 * Not 100%: these are judgement calls and a model is allowed to disagree with
 * one of them without the build being wrong. It IS the number to watch across
 * a prompt change, and a drop of more than a case or two is a regression even
 * when it stays above the floor.
 */
const PASS_THRESHOLD = 0.8;

interface Scored {
  case: VerifyEvalCase;
  got: string;
  ok: boolean;
  reason: string;
}

const liveEval = process.env.AI_EVAL === "1";

describe.skipIf(!liveEval)("live verification eval", () => {
  it(
    "scores at or above the threshold on the labelled set",
    { timeout: 10 * 60 * 1000 },
    async () => {
      const baseUrl = process.env.AI_BASE_URL;
      const apiKey = process.env.AI_API_KEY ?? "";
      const model = process.env.AI_MODEL;
      if (!baseUrl || !model) {
        throw new Error(
          "AI_EVAL=1 needs AI_BASE_URL and AI_MODEL set to the endpoint you " +
            "want to measure.",
        );
      }

      const { callVerifyForEval } = await import("./verify-eval-runner");
      const scored: Scored[] = [];

      // Serial on purpose. This measures verdict quality, not throughput, and
      // firing a dozen concurrent requests at a rate-limited endpoint turns a
      // failed eval into a question about the rate limit.
      for (const c of VERIFY_EVAL_CASES) {
        const text = await callVerifyForEval(
          { baseUrl, apiKey, model },
          buildVerifyPrompt(c.finding, c.probe),
        );
        // Null means the reply had no id to attach a verdict to at all. That
        // is a transport or format failure rather than a wrong judgement, and
        // it counts as a miss: an unusable answer is not a correct one.
        const parsed = parseVerifyResponseText(c.finding.id, text);
        scored.push({
          case: c,
          got: parsed?.verdict ?? "unparseable",
          ok: parsed?.verdict === c.expected,
          reason: parsed?.reason ?? text.slice(0, 200),
        });
      }

      const { shouldConfirm, shouldFlag } = splitByExpected(VERIFY_EVAL_CASES);
      const rate = (subset: VerifyEvalCase[]) => {
        const hits = scored.filter((s) => subset.includes(s.case) && s.ok);
        return subset.length === 0 ? 1 : hits.length / subset.length;
      };

      const lines = scored.map(
        (s) =>
          `${s.ok ? "PASS" : "FAIL"}  ${s.case.expected.padEnd(12)} got ${s.got.padEnd(12)} ${s.case.regression ? "[regression] " : ""}${s.case.name}\n        ${s.reason.slice(0, 200)}`,
      );
      const overall = scored.filter((s) => s.ok).length / scored.length;

      console.log(
        [
          "",
          `Model: ${model}  (${baseUrl})`,
          `Overall            ${(overall * 100).toFixed(0)}%`,
          `Real findings      ${(rate(shouldConfirm) * 100).toFixed(0)}%  (should confirm)`,
          `False positives    ${(rate(shouldFlag) * 100).toFixed(0)}%  (should flag)`,
          "",
          ...lines,
          "",
        ].join("\n"),
      );

      // Reported separately because a single overall number hides the failure
      // that matters: a model that confirms everything scores 50% overall and
      // 100% on one half, and that is a much worse agent than the number looks.
      const failed = scored.filter((s) => !s.ok);
      expect(
        overall,
        `Below threshold. Failures:\n${failed.map((f) => `  ${f.case.name}: expected ${f.case.expected}, got ${f.got}\n    model said: ${f.reason}\n    why the label is right: ${f.case.rationale}`).join("\n")}`,
      ).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    },
  );
});
