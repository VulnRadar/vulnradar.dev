import { describe, it, expect } from "vitest";
import { readWorkflow } from "./_workflow-steps";

/**
 * ci.yml runs on pushes to the 4.0.0 build branches.
 *
 * The Integration job is the only thing that executes real SQL, and the
 * machines the 4.0.0 work is built on have no database to run it against. Each
 * piece of that work is pushed to `v4/<topic>` and its Integration job has to
 * be green before it is merged to main. A push trigger limited to main would
 * leave those branches with no CI at all until a pull request was opened, which
 * is after the work is finished.
 */

const ci = readWorkflow("ci.yml");

/** The body of the top-level `on:` block, up to the next top-level key. */
function onBlock(workflow: string): string {
  const start = workflow.search(/^on:$/m);
  expect(start, "ci.yml has an `on:` block").toBeGreaterThan(-1);
  const rest = workflow.slice(start + 3);
  const end = rest.search(/^[a-z-]+:/m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The `branches:` list under one trigger, with comments and quotes removed. */
function branchesFor(trigger: "push" | "pull_request"): string[] {
  const block = onBlock(ci)
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  const section = block.match(
    new RegExp(`^ {2}${trigger}:\\n((?: {4}.*\\n?)+)`, "m"),
  )?.[1];
  const list = section?.match(/branches:\s*\[([^\]]*)\]/)?.[1];
  expect(list, `${trigger} has an inline branches list`).toBeDefined();
  return (list as string)
    .split(",")
    .map((b) => b.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

describe("ci.yml triggers", () => {
  it("runs on pushes to main and to v4/** branches", () => {
    expect(branchesFor("push")).toEqual(["main", "v4/**"]);
  });

  it("still opens pull requests against main only", () => {
    expect(branchesFor("pull_request")).toEqual(["main"]);
  });

  it("can be started by hand", () => {
    expect(onBlock(ci)).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("does not skip any job on a branch other than main", () => {
    // A job-level `if: github.ref == 'refs/heads/main'` would put the
    // Integration job back to never running on a v4/** branch.
    expect(ci).not.toMatch(/^\s+if:.*github\.(ref|ref_name)\b/m);
  });
});
