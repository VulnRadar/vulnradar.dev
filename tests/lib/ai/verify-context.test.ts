import { describe, it, expect } from "vitest";
import { VERIFY_SYSTEM_PROMPT } from "@/lib/ai/verify-context";

// The prompt is the whole of the verification agent's judgement, so the
// things it must not say are as load-bearing as the things it must. These
// assertions exist because an earlier revision told the model to treat two
// whole categories as automatically real, which made a false positive in
// them impossible to report no matter what the model actually knew.
describe("VERIFY_SYSTEM_PROMPT", () => {
  it("never instructs the model to confirm a category outright", () => {
    const absolutes = [
      "Always confirmed",
      "always confirmed",
      "Almost always confirmed",
    ];
    for (const phrase of absolutes) {
      expect(
        VERIFY_SYSTEM_PROMPT,
        `the prompt must not tell the model "${phrase}": a category it cannot doubt is a category whose false positives reach the user unchallenged`,
      ).not.toContain(phrase);
    }
  });

  it("separates the scanner's measurement from the conclusion drawn on it", () => {
    expect(VERIFY_SYSTEM_PROMPT).toContain("observation");
    expect(VERIFY_SYSTEM_PROMPT).toContain("interpretation");
    // possible_fp has to be reachable when the measurement was right
    expect(VERIFY_SYSTEM_PROMPT).toContain(
      "The observation is accurate but the interpretation fails",
    );
  });

  it("forbids confirming a finding merely because the probe cannot refute it", () => {
    expect(VERIFY_SYSTEM_PROMPT).toContain("Never confirm by default");
    expect(VERIFY_SYSTEM_PROMPT).toContain(
      'the verdict is "uncertain", never "confirmed"',
    );
  });

  it("still protects DNS findings from being refuted with HTTP data", () => {
    expect(VERIFY_SYSTEM_PROMPT).toContain(
      "your HTTP probe cannot contradict it",
    );
  });

  // styled-jsx and single-provider DNS were deliberately REMOVED from this
  // list: neither was a false positive, and listing them taught the model to
  // dismiss true findings. See the not-a-false-positive tests below.
  it("carries the known-benign catalogue the checks keep tripping over", () => {
    for (const topic of ["black lies", "DANE", "OCSP", "NSEC3PARAM"]) {
      expect(
        VERIFY_SYSTEM_PROMPT,
        `the known benign patterns section must still cover ${topic}`,
      ).toContain(topic);
    }
  });

  it("keeps the house style rule against em dashes in the reason text", () => {
    expect(VERIFY_SYSTEM_PROMPT).toContain("must never use an em dash");
    // The rule has to print the character it bans, so that one line is the
    // only place an em dash may legitimately appear. Anywhere else and the
    // prompt is modelling the style it tells the model not to use.
    const EM_DASH = String.fromCharCode(0x2014);
    const strays = VERIFY_SYSTEM_PROMPT.split("\n").filter(
      (line) =>
        line.includes(EM_DASH) && !line.includes("must never use an em dash"),
    );
    expect(strays, "em dash outside the rule that bans it").toEqual([]);
  });

  // These two entries shipped in the first version of the benign catalogue
  // and told the model that a real single point of failure and a finding
  // whose own title says "framework-required" were false positives. Both got
  // marked possible_fp at 87% on our own scan. Intentional is not the same as
  // untrue, and the reader already has Accepted risk / Not applicable buttons
  // for the judgement the model was making on their behalf.
  it("does not teach the model to dismiss true-but-intentional findings", () => {
    expect(VERIFY_SYSTEM_PROMPT).not.toContain(
      "deliberate, reasonable trade rather than a misconfiguration",
    );
    expect(VERIFY_SYSTEM_PROMPT).not.toContain(
      "the practical XSS exposure is close to nil",
    );
  });

  it("states that a real risk stays confirmed even when it is deliberate", () => {
    expect(VERIFY_SYSTEM_PROMPT).toContain("What is NOT a false positive");
    expect(VERIFY_SYSTEM_PROMPT).toContain("refutes nothing");
    expect(VERIFY_SYSTEM_PROMPT).toContain("Unfixable is not untrue");
  });

  it("keeps the accept-or-dismiss decision with the reader", () => {
    expect(VERIFY_SYSTEM_PROMPT).toContain("Accepted risk");
    expect(VERIFY_SYSTEM_PROMPT).toContain("belongs to the reader, not to you");
  });

  it("does not let the model re-score severity instead of judging truth", () => {
    expect(VERIFY_SYSTEM_PROMPT).toContain("You are not re-scoring");
  });
});
