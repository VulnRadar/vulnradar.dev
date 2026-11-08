import { describe, it, expect } from "vitest";
import { readWorkflow, workflowSteps, stepNamed } from "./_workflow-steps";

/**
 * docker-publish refuses to ship a commit whose CI did not pass, and a push to
 * main used to cancel the CI of the commit before it. A tag on that earlier
 * commit then failed the publish gate with a message that blamed the code,
 * for a run that had simply been stopped.
 */

const ci = readWorkflow("ci.yml");
const gate = stepNamed(
  workflowSteps(readWorkflow("docker-publish.yml")),
  "Require a green CI run for the tagged commit",
);

describe("ci.yml concurrency", () => {
  const block = /^concurrency:\n((?: {2}.+\n)+)/m.exec(ci)?.[1] ?? "";

  it("cancels superseded runs only for pull requests", () => {
    expect(block).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
  });

  it("keeps one group per workflow and ref", () => {
    expect(block).toContain("group: ${{ github.workflow }}-${{ github.ref }}");
  });
});

describe("the docker-publish CI gate", () => {
  it("still publishes only on a successful run", () => {
    expect(gate.code).toContain('.conclusion == "success"');
  });

  it("tells a cancelled CI run apart from a failed one", () => {
    const cancelled = gate.code.indexOf('.conclusion == "cancelled"');
    const failed = gate.code.indexOf("CI did not pass for");
    expect(cancelled, "the gate looks for cancelled runs").toBeGreaterThan(-1);
    expect(failed, "the gate still reports a failure").toBeGreaterThan(-1);
    expect(gate.code).toMatch(/rerun CI for this sha/i);
  });

  it("does not call a run with any real failure in it cancelled", () => {
    // `all`, not `any`: a cancelled re-run next to a red run is still red.
    expect(gate.code).toMatch(/all\(\.\[\]; \.conclusion == "cancelled"\)/);
  });

  it("stops the job in both cases", () => {
    const body = gate.code.slice(gate.code.indexOf('.status == "completed"'));
    const block = body.slice(0, body.indexOf("deadline"));
    expect(block.match(/exit 1/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
