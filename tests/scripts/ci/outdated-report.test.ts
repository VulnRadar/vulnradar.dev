import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bumpKind,
  buildReport,
  checkState,
  compareVersions,
  daysUntilStale,
  highestOf,
  newestNode,
  newestPostgres,
  readStalePolicy,
  waitingReasons,
} from "../../../scripts/ci/outdated-report.mjs";

/**
 * scripts/ci/outdated-report.mjs writes the weekly report issue. It reads
 * files only, so it is tested on fixtures: the registries' answers, a `gh pr
 * list` listing and the repository's own pins.
 */

const NOW = Date.parse("2026-11-15T00:00:00Z");
const ROOT = mkdtempSync(path.join(tmpdir(), "vr-outdated-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const STALE = { days: 30, exempt: ["pinned", "security", "dependabot"] };
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const pr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  title: "Add a thing",
  author: { login: "someone" },
  createdAt: ago(10),
  updatedAt: ago(3),
  labels: [],
  isDraft: false,
  reviewDecision: "",
  statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
  ...over,
});

describe("versions", () => {
  it("compares dotted versions numerically, with or without a v", () => {
    expect(compareVersions("22.23.4", "22.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v22.1.0", "22.1.0")).toBe(0);
    expect(bumpKind("1.2.3", "2.0.0")).toBe("major");
    expect(bumpKind("1.2.3", "1.3.0")).toBe("minor");
    expect(bumpKind("1.2.3", "1.2.9")).toBe("patch");
  });

  it("takes the highest version of one answer or a list", () => {
    expect(highestOf(["11.0.0", "11.21.2", "11.9.0", "next"])).toBe("11.21.2");
    expect(highestOf("11.21.2")).toBe("11.21.2");
    expect(highestOf([])).toBeNull();
  });

  it("finds the newest Node of a line whatever order the index lists them in", () => {
    const index = [
      { version: "v24.1.0" },
      { version: "v22.9.0" },
      { version: "v22.23.4" },
      { version: "v20.1.0" },
    ];
    expect(newestNode(index, "22")).toBe("v22.23.4");
    expect(newestNode([], "22")).toBeNull();
  });

  it("finds the newest alpine tag of a Postgres line and ignores the rest", () => {
    const tags = {
      results: [
        { name: "16.9-alpine" },
        { name: "16.16-alpine" },
        { name: "16.16-alpine3.22" },
        { name: "16.16" },
        { name: "17.5-alpine" },
      ],
    };
    expect(newestPostgres(tags, "16")).toBe("16.16-alpine");
    expect(newestPostgres({}, "16")).toBeNull();
  });
});

describe("pull requests", () => {
  it("reads the checks as failing, running, passing or none", () => {
    expect(checkState([])).toBe("none");
    expect(checkState([{ status: "COMPLETED", conclusion: "SUCCESS" }])).toBe(
      "passing",
    );
    expect(
      checkState([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ]),
    ).toBe("failing");
    expect(checkState([{ status: "IN_PROGRESS" }])).toBe("running");
    expect(
      checkState([{ __typename: "StatusContext", state: "PENDING" }]),
    ).toBe("running");
  });

  it("names why a pull request waits", () => {
    expect(waitingReasons(pr({ isDraft: true }))).toContain("draft");
    expect(
      waitingReasons(
        pr({
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
        }),
      ),
    ).toContain("failing checks");
    expect(waitingReasons(pr({ reviewDecision: "REVIEW_REQUIRED" }))).toContain(
      "needs review",
    );
    expect(waitingReasons(pr())).toEqual([]);
  });

  it("separates a Dependabot patch from a bump a person has to merge", () => {
    const bot = { author: { login: "app/dependabot" } };
    expect(
      waitingReasons(pr({ ...bot, title: "Bump foo from 1.2.3 to 1.2.4" })),
    ).toEqual([]);
    expect(
      waitingReasons(pr({ ...bot, title: "Bump foo from 1.2.3 to 1.3.0" })),
    ).toEqual(["minor bump: a person merges it"]);
    expect(
      waitingReasons(pr({ ...bot, title: "Bump foo from 1.2.3 to 2.0.0" })),
    ).toEqual(["major bump: a person merges it"]);
    expect(
      waitingReasons(
        pr({
          ...bot,
          title: "Bump foo from 1.2.3 to 1.2.4",
          labels: [{ name: "dependabot-merge-ignore" }],
        }),
      ),
    ).toEqual(["dependabot-merge-ignore: merge by hand"]);
  });

  it("counts the days until stale.yml marks it, from the last update", () => {
    expect(daysUntilStale(pr({ updatedAt: ago(3) }), STALE, NOW)).toBe(
      "27 days",
    );
    expect(daysUntilStale(pr({ updatedAt: ago(40) }), STALE, NOW)).toBe(
      "stale now",
    );
    expect(
      daysUntilStale(pr({ labels: [{ name: "security" }] }), STALE, NOW),
    ).toBe("exempt");
  });

  it("reads the stale policy out of stale.yml", () => {
    const policy = readStalePolicy(
      `          days-before-stale: 30\n          exempt-pr-labels: "pinned,security,dependabot,dependabot-merge-ignore"\n`,
    );
    expect(policy).toEqual({
      days: 30,
      exempt: ["pinned", "security", "dependabot", "dependabot-merge-ignore"],
    });
  });
});

describe("the report", () => {
  function fixture() {
    const dir = mkdtempSync(path.join(ROOT, "r-"));
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    mkdirSync(path.join(dir, ".github", "tools"), { recursive: true });
    writeFileSync(path.join(dir, ".nvmrc"), "22.23.3\n");
    writeFileSync(
      path.join(dir, ".github", "workflows", "release.yml"),
      '          npm install --global "npm@11.21.1"\n',
    );
    writeFileSync(
      path.join(dir, ".github", "tools", "Dockerfile"),
      "FROM postgres:16.15-alpine@sha256:aa AS postgres\n",
    );
    writeFileSync(
      path.join(dir, ".github", "workflows", "stale.yml"),
      '          days-before-stale: 30\n          exempt-pr-labels: "pinned"\n',
    );
    const write = (name: string, body: unknown) => {
      const file = path.join(dir, name);
      writeFileSync(file, JSON.stringify(body));
      return file;
    };
    return {
      dir,
      files: {
        npmRoot: write("o.json", {
          left: { current: "1.0.0", wanted: "1.0.1", latest: "2.0.0" },
        }),
        npmExtension: write("e.json", {}),
        npmVersions: write("n.json", ["11.21.1", "11.21.2"]),
        nodeIndex: write("node.json", [
          { version: "v22.23.4" },
          { version: "v22.23.3" },
        ]),
        postgresTags: write("pg.json", { results: [{ name: "16.16-alpine" }] }),
        prs: write("prs.json", [pr({ title: "Fix | pipe" })]),
      },
    };
  }

  it("lists each outdated package, each pin against its source and each open pull request", () => {
    const { dir, files } = fixture();
    const md = buildReport({ root: dir, files, now: NOW });
    expect(md).toContain("| `left` | 1.0.0 | 1.0.1 | 2.0.0 | major |");
    expect(md).toContain("Everything is current.");
    expect(md).toContain(
      "| npm in release.yml (11.x) | 11.21.1 | 11.21.2 | behind |",
    );
    expect(md).toContain(
      "| Node in .nvmrc (22.x) | 22.23.3 | 22.23.4 | behind |",
    );
    expect(md).toContain(
      "| Postgres tag (16.x-alpine) | 16.15-alpine | 16.16-alpine | behind |",
    );
    expect(md).toContain("| #7 `Fix _ pipe` | 10 days | someone |");
    expect(md).toContain("| passing | ready | 27 days |");
  });

  it("puts a pull request title in a code span, so it cannot mention anyone or link anywhere", () => {
    const { dir, files } = fixture();
    writeFileSync(
      files.prs,
      JSON.stringify([
        pr({
          number: 9,
          title: "fix @someone @org/team [click](https://example.com) `x` *y*",
        }),
      ]),
    );
    const md = buildReport({ root: dir, files, now: NOW });
    const row = md.split(/\r?\n/).find((l) => l.startsWith("| #9 "));
    expect(row).toBeDefined();
    const title = /^\| #9 (`[^`]*`) \|/.exec(row!);
    expect(title, row).not.toBeNull();
    // A backtick in the title cannot close the span early.
    expect(title![1]).toBe(
      "`fix @someone @org/team [click](https://example.com) 'x' *y*`",
    );
    expect(row!.replace(title![1], "")).not.toMatch(/@|\]\(/);
  });

  it("says so when a source could not be read, instead of calling the pin current", () => {
    const { dir, files } = fixture();
    const md = buildReport({
      root: dir,
      files: { ...files, nodeIndex: path.join(dir, "missing.json") },
      now: NOW,
    });
    expect(md).toContain(
      "| Node in .nvmrc (22.x) | 22.23.3 |  | could not read |",
    );
  });
});

describe("a table whose source could not be read", () => {
  it("says so instead of reporting that everything is current", () => {
    const { dir, files } = (() => {
      const dir = mkdtempSync(path.join(ROOT, "u-"));
      mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
      mkdirSync(path.join(dir, ".github", "tools"), { recursive: true });
      writeFileSync(path.join(dir, ".nvmrc"), "22.23.3\n");
      writeFileSync(
        path.join(dir, ".github", "workflows", "release.yml"),
        "npm@11.21.1\n",
      );
      writeFileSync(
        path.join(dir, ".github", "tools", "Dockerfile"),
        "FROM postgres:16.15-alpine@sha256:aa AS postgres\n",
      );
      writeFileSync(
        path.join(dir, ".github", "workflows", "stale.yml"),
        "days-before-stale: 30\n",
      );
      return { dir, files: { npmRoot: path.join(dir, "none.json") } };
    })();
    const md = buildReport({ root: dir, files, now: NOW });
    expect(md).toContain("`npm outdated` left nothing readable.");
    expect(md).not.toContain("Everything is current.");
  });
});
