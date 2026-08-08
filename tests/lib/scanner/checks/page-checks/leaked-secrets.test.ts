import { describe } from "vitest";
import { leakedSecretChecks } from "@/lib/scanner/checks/page-checks/leaked-secrets";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-inline-script-high-entropy-secret": [
    {
      description: "high-entropy value assigned to a secret-shaped variable",
      body: `<script>var apiSecretKey = "Tg7QkP2mZ9qX4wR8vL1nB6yH3jF5dS0c";</script>`,
      expect: "fire",
      evidenceIncludes: "apiSecretKey",
    },
    {
      description: "placeholder value is not flagged",
      body: `<script>var apiSecretKey = "your_api_key_here_replace_me_now";</script>`,
      expect: "skip",
    },
    {
      description: "short value below the length threshold",
      body: `<script>var apiKey = "short123";</script>`,
      expect: "skip",
    },
    {
      description: "low-entropy repeated-character value",
      body: `<script>var authToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";</script>`,
      expect: "skip",
    },
    {
      description: "non-secret-shaped variable name is not flagged",
      body: `<script>var greetingMessage = "Tg7kP2mZ9qX4wR8vL1nB6yH3jF5dS0c1";</script>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/leaked-secrets", () => {
  runPageCheckTests(leakedSecretChecks, fixtures);
});
