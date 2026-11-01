import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { leakedSecretChecks } from "@/lib/scanner/checks/page-checks/leaked-secrets";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

/**
 * Which identifiers count as secret-shaped. The vendor-style names count
 * anywhere in the identifier; a bare "token" counts only as its suffix, so
 * csrfToken is a candidate and tokenizerModel is not. That was one regex
 * whose last branch alone carried a `$`, which reads as if the whole
 * alternation were end-anchored (CodeQL #254, misleading precedence).
 */
const VALUE = "Tg7QkP2mZ9qX4wR8vL1nB6yH3jF5dS0c";

const fixtures: PageCheckFixtures = {
  "page-inline-script-high-entropy-secret": [
    {
      description: "a name ending in token is secret-shaped",
      body: `<script>var csrfToken = "${VALUE}";</script>`,
      expect: "fire",
      evidenceIncludes: "csrfToken",
    },
    {
      description: "token anywhere but the end is not, on its own",
      body: `<script>var tokenizerModel = "${VALUE}";</script>`,
      expect: "skip",
    },
    {
      description: "a vendor-style name counts anywhere in the identifier",
      body: `<script>var stripeApiKeyLive = "${VALUE}";</script>`,
      expect: "fire",
      evidenceIncludes: "stripeApiKeyLive",
    },
    {
      description: "password counts anywhere in the identifier",
      body: `<script>var dbPasswordValue = "${VALUE}";</script>`,
      expect: "fire",
      evidenceIncludes: "dbPasswordValue",
    },
  ],
};

describe("page-checks/leaked-secrets: secret-shaped names", () => {
  runPageCheckTests(leakedSecretChecks, fixtures);

  it("keeps the suffix-only token rule out of the anywhere alternation", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/scanner/checks/page-checks/leaked-secrets.ts"),
      "utf8",
    );
    expect(source).not.toContain("|password|passwd|token$/i");
  });
});
