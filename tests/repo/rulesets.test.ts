import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { jobsOf, readWorkflow } from "./_workflow-steps";

/**
 * .github/rulesets/*.json are imported by hand under Settings > Rules, so a
 * name in them that no job carries makes a required check that can never
 * report, and blocks every merge. These read the files against ci.yml.
 */

const ROOT = path.resolve(__dirname, "../..");
const readJson = (rel: string) =>
  JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

/** The id of the GitHub Actions app, which reports every check ci.yml makes. */
const GITHUB_ACTIONS_APP = 15368;

/** What the ruleset required before the CLI, scan gate, lint and review jobs. */
const ORIGINAL_CONTEXTS = [
  "Lint",
  "Typecheck",
  "Test",
  "Extension",
  "Build",
  "Self-host smoke test",
  "Integration",
];

interface Rule {
  type: string;
  parameters?: Record<string, unknown>;
}

const main = readJson(".github/rulesets/main.json") as {
  target: string;
  enforcement: string;
  bypass_actors: unknown[];
  rules: Rule[];
};
const checks = (
  main.rules.find((r) => r.type === "required_status_checks")!.parameters!
    .required_status_checks as { context: string; integration_id?: number }[]
).map((c) => c);

const ciNames = jobsOf(readWorkflow("ci.yml")).map((j) => j.name);

describe(".github/rulesets/main.json", () => {
  it("requires every check it did before", () => {
    const contexts = checks.map((c) => c.context);
    for (const original of ORIGINAL_CONTEXTS) {
      expect(contexts, original).toContain(original);
    }
  });

  it("names only jobs of ci.yml, so every required check can report", () => {
    for (const { context } of checks) {
      expect(ciNames, context).toContain(context);
    }
  });

  it("requires each of them from the GitHub Actions app, not from any app that claims the name", () => {
    for (const c of checks) {
      expect(c.integration_id, c.context).toBe(GITHUB_ACTIONS_APP);
    }
  });

  it("also requires the aggregate jobs and the pull request gates", () => {
    const contexts = checks.map((c) => c.context);
    expect(contexts).toEqual(
      expect.arrayContaining([
        "Dependency review",
        "Secret scan",
        "Workflow and Dockerfile lint",
        "CLI",
        "Scan gate action",
      ]),
    );
    expect(new Set(contexts).size).toBe(contexts.length);
    expect(contexts).toHaveLength(12);
  });

  it("requires no matrix leg, whose name changes with the matrix", () => {
    for (const { context } of checks) {
      expect(context).not.toMatch(/ on |, Node /);
    }
  });

  it("does not require the path-filtered or report-only checks", () => {
    const contexts = checks.map((c) => c.context);
    for (const optional of [
      "Package versions",
      "ARM64 image builds and boots",
      "ZAP baseline",
      "Lighthouse",
    ]) {
      expect(contexts, optional).not.toContain(optional);
    }
  });

  it("holds CodeQL results at high or higher", () => {
    const rule = main.rules.find((r) => r.type === "code_scanning");
    expect(rule, "a code_scanning rule").toBeDefined();
    expect(rule!.parameters).toEqual({
      code_scanning_tools: [
        {
          tool: "CodeQL",
          security_alerts_threshold: "high_or_higher",
          alerts_threshold: "errors",
        },
      ],
    });
  });

  it("is a branch ruleset on the default branch, with no bypass", () => {
    expect(main.target).toBe("branch");
    expect(main.enforcement).toBe("active");
    expect(main.bypass_actors).toEqual([]);
    expect(main.rules.map((r) => r.type)).toEqual(
      expect.arrayContaining(["deletion", "non_fast_forward", "pull_request"]),
    );
  });
});

describe(".github/rulesets/release-tags.json", () => {
  const tags = readJson(".github/rulesets/release-tags.json") as {
    target: string;
    enforcement: string;
    conditions: { ref_name: { include: string[]; exclude: string[] } };
    bypass_actors: {
      actor_id: number;
      actor_type: string;
      bypass_mode: string;
    }[];
    rules: Rule[];
  };

  it("protects the v* tags", () => {
    expect(tags.target).toBe("tag");
    expect(tags.conditions.ref_name.include).toEqual(["refs/tags/v*"]);
    expect(tags.conditions.ref_name.exclude).toEqual([]);
  });

  it("forbids creating, moving, deleting and force-updating one", () => {
    expect(tags.rules.map((r) => r.type).sort()).toEqual([
      "creation",
      "deletion",
      "non_fast_forward",
      "update",
    ]);
  });

  it("lets repository admins through, and nobody else", () => {
    expect(tags.bypass_actors).toEqual([
      { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
    ]);
  });
});
