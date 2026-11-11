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

  // The old prompt told the model to answer "confirmed with confidence 85-92"
  // to every async- finding and "Do NOT return uncertain". Eight such checks
  // collected 34 to 71 confirmed rows each, none of which carried information,
  // and the same prompt also told it to judge DNS interpretation, so which
  // instruction won varied per run.
  describe("DNS findings are judged, not stamped", () => {
    it("no longer orders a fixed verdict for the async- family", () => {
      expect(VERIFY_SYSTEM_PROMPT).not.toContain('Do NOT return "uncertain"');
      expect(VERIFY_SYSTEM_PROMPT).not.toContain(
        'Return "confirmed" with confidence 85-92',
      );
      expect(VERIFY_SYSTEM_PROMPT).not.toContain(
        "DNS check with async- prefix (scanner verified via DNS: trust it)",
      );
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "No family of checks has a fixed verdict",
      );
    });

    it("keeps the observation protected from HTTP data", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "You CANNOT refute a DNS finding using HTTP probe data",
      );
    });

    it("asks who owns the zone and whether the name receives mail", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "Does the owner control this zone?",
      );
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "Is this name a mail domain at all?",
      );
      expect(VERIFY_SYSTEM_PROMPT).toContain("vercel.app");
    });

    it("splits TLSA for the web from TLSA for SMTP", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain("_443._tcp");
      expect(VERIFY_SYSTEM_PROMPT).toContain("_25._tcp");
    });
  });

  describe("an unusable probe is uncertain", () => {
    it("names the statuses and the challenge signals", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain("Is the probe usable?");
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "status_code is 401, 403, 429 or any 5xx",
      );
      expect(VERIFY_SYSTEM_PROMPT).toContain("cf-mitigated");
      expect(VERIFY_SYSTEM_PROMPT).toContain("proof-of-work");
    });

    it("does not let a bad page probe move a finding measured another way", () => {
      // "whatever the finding says" once made a 403 probe turn a DNS finding
      // uncertain, which contradicted the rule that DNS is judged on its own
      // evidence.
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "do not depend on the page, so a bad probe does not move them",
      );
      expect(VERIFY_SYSTEM_PROMPT).not.toContain("whatever the finding says");
    });

    it("never lets a challenge or block page refute a finding", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "Never use an unusable probe to refute a finding",
      );
    });

    it("treats a scanner and probe disagreement as uncertain", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "The site answers the scanner and the probe differently",
      );
    });

    it("no longer claims the probe is the scanner's own response", () => {
      expect(VERIFY_SYSTEM_PROMPT).not.toContain(
        "The live_probe you have is the same source the scanner used",
      );
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "SEPARATE request from the one the scanner graded",
      );
    });

    it("does not call a 503 or a redirect a reason to dismiss a finding", () => {
      expect(VERIFY_SYSTEM_PROMPT).not.toContain(
        "status_code is 404, 301, or 503",
      );
    });
  });

  describe("header checks need a header or a named standard to be dismissed", () => {
    it("scopes the interpretation licence", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        'this page does not need it" is not a reason',
      );
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "a NAMED standard or browser behaviour",
      );
    });

    it("keeps the withdrawn-standard examples that the licence exists for", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain("X-XSS-Protection");
      expect(VERIFY_SYSTEM_PROMPT).toContain("Expect-CT");
    });
  });

  describe("body-content and supply-chain evidence", () => {
    it("no longer cites target-blank-no-noopener as a check to confirm blind", () => {
      expect(VERIFY_SYSTEM_PROMPT).not.toContain(
        "(inline-style-attr, target-blank-no-noopener",
      );
      expect(VERIFY_SYSTEM_PROMPT).toContain("inline-style-attr");
    });

    it("sends count-only evidence with nothing visible to uncertain", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "the evidence only counts instances",
      );
      expect(VERIFY_SYSTEM_PROMPT).not.toContain(
        'Return "confirmed" citing that the scanner parsed the full document',
      );
    });

    it("compares the resource host with the page host", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "compare the resource's host with the host of final_url",
      );
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "A first-party resource is the page's own code",
      );
    });

    it("carries the benign patterns the research measured", () => {
      for (const topic of [
        'target="_blank" without rel',
        "Google Fonts",
        'Function("return this")()',
        "csrf-token",
        "storefrontAccessToken",
        "XSRF-TOKEN",
        "__cf_bm",
        "t=y; p=;",
      ]) {
        expect(
          VERIFY_SYSTEM_PROMPT,
          `the prompt must still cover ${topic}`,
        ).toContain(topic);
      }
    });

    it("still treats a pinned third-party CDN file without integrity as real", () => {
      expect(VERIFY_SYSTEM_PROMPT).toContain(
        "with no integrity attribute is a real finding: confirmed",
      );
    });
  });

  it("covers every category the scanner emits", () => {
    for (const category of [
      "client-side",
      "supply-chain",
      "vibe-code",
      "host-validation",
      "reputation",
      "active-probes",
    ]) {
      expect(
        VERIFY_SYSTEM_PROMPT,
        `category ${category} is missing from the prompt`,
      ).toContain(category);
    }
  });

  it("describes optional prompt blocks as optional, so it never promises data it is not sent", () => {
    expect(VERIFY_SYSTEM_PROMPT).toContain(
      "scanner_response_headers (when present)",
    );
    expect(VERIFY_SYSTEM_PROMPT).toContain("dns_context (when present)");
  });
});
