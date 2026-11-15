import { describe, it, expect } from "vitest";
import {
  readWorkflow,
  workflowSteps,
  stepNamed,
  jobsOf,
  jobNamed,
} from "./_workflow-steps";
import { evaluateValue, type Ctx } from "./_expressions";

/**
 * docker-publish refuses to ship a commit whose CI did not pass, and a push to
 * main used to cancel the CI of the commit before it. A tag on that earlier
 * commit then failed the publish gate with a message that blamed the code,
 * for a run that had simply been stopped.
 */

const ci = readWorkflow("ci.yml");
const GATE = "Require a green CI run for the tagged commit";

/**
 * Both copies of the gate: docker-publish's, before an image is built, and
 * release.yml's gate job, before a release published by hand is built.
 */
const GATES = [
  [
    "docker-publish.yml",
    stepNamed(workflowSteps(readWorkflow("docker-publish.yml")), GATE),
  ],
  [
    "release.yml gate job",
    stepNamed(
      jobNamed(jobsOf(readWorkflow("release.yml")), "gate").steps,
      GATE,
    ),
  ],
] as const;

describe("ci.yml concurrency", () => {
  const block = /^concurrency:\n((?: {2}.+\n)+)/m.exec(ci)?.[1] ?? "";

  it("cancels superseded runs only for pull requests", () => {
    expect(block).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
  });

  it("keys the group on the commit on main and on the ref everywhere else", () => {
    expect(block).toContain(
      "group: ${{ github.workflow }}-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}",
    );
  });

  /** The group with its expressions filled in for one run. */
  const groupFor = (github: Record<string, string>): string => {
    const raw = /^ {2}group:\s*(.+)$/m.exec(block)![1];
    const ctx: Ctx = { github: { workflow: "CI", ...github } };
    return raw.replace(/\$\{\{(.+?)\}\}/g, (_, expr: string) => {
      const v = evaluateValue(expr, ctx);
      return v === null ? "" : String(v);
    });
  };
  const A = "a".repeat(40);
  const B = "b".repeat(40);

  it("gives two pushes to main different groups, so neither replaces the other", () => {
    const first = groupFor({ ref: "refs/heads/main", sha: A });
    const second = groupFor({ ref: "refs/heads/main", sha: B });
    expect(first).not.toBe(second);
    expect(first).toContain(A);
    // The same commit run twice (a schedule and a re-run) is one group.
    expect(groupFor({ ref: "refs/heads/main", sha: A })).toBe(first);
  });

  it("gives two runs of one pull request one group, which cancels the older run", () => {
    const first = groupFor({ ref: "refs/pull/12/merge", sha: A });
    const second = groupFor({ ref: "refs/pull/12/merge", sha: B });
    expect(first).toBe(second);
    expect(groupFor({ ref: "refs/pull/13/merge", sha: A })).not.toBe(first);
    const cancel = /^ {2}cancel-in-progress:\s*(.+)$/m.exec(block)![1];
    const on = (event_name: string) =>
      evaluateValue(cancel, { github: { event_name } });
    expect(on("pull_request")).toBe(true);
    for (const other of [
      "push",
      "schedule",
      "merge_group",
      "workflow_dispatch",
    ]) {
      expect(on(other), other).toBe(false);
    }
  });

  it("keeps one group per ref on a v4 branch, as before", () => {
    const first = groupFor({ ref: "refs/heads/v4/audit", sha: A });
    expect(groupFor({ ref: "refs/heads/v4/audit", sha: B })).toBe(first);
    expect(first).toContain("refs/heads/v4/audit");
    expect(groupFor({ ref: "refs/heads/v4/other", sha: A })).not.toBe(first);
  });

  it("keys a merge queue run on its own ref", () => {
    const queue = "refs/heads/gh-readonly-queue/main/pr-12-abc";
    expect(groupFor({ ref: queue, sha: A })).toContain(queue);
  });
});

describe.each(GATES)("the CI gate in %s", (_, gate) => {
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

describe("release.yml's gate", () => {
  const job = jobNamed(jobsOf(readWorkflow("release.yml")), "gate");
  const gate = stepNamed(job.steps, GATE);

  it("checks the commit the tag names, not the checkout's HEAD", () => {
    // On workflow_run the checkout is the default branch, not the tag.
    expect(gate.code).toContain(
      'sha="$(git rev-parse "refs/tags/${TAG}^{commit}")"',
    );
    expect(gate.code).not.toMatch(/git rev-parse HEAD/);
    expect(gate.code).toMatch(
      /^\s+TAG:\s*\$\{\{\s*steps\.vars\.outputs\.tag\s*\}\}\s*$/m,
    );
  });

  it("waits as long as docker-publish's gate does", () => {
    const docker = GATES[0][1];
    const deadline = (code: string) =>
      /deadline=\$\(\( \$\(date \+%s\) \+ (\d+) \* 60 \)\)/.exec(code)?.[1];
    expect(deadline(gate.code)).toBe("45");
    expect(deadline(gate.code)).toBe(deadline(docker.code));
  });
});
