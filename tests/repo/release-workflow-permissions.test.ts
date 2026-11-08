import { describe, it, expect } from "vitest";
import { readWorkflow, workflowSteps } from "./_workflow-steps";

/**
 * Third-party code and release credentials must never share a job.
 *
 * `npm ci` runs the install scripts of every package in the extension's tree,
 * and Dependabot auto-merges patch bumps of that tree. Run in a job holding
 * contents: write and an OIDC token, one poisoned patch release could rewrite
 * the source tarball before cosign signed it, and the in-app updater installs
 * that tarball. So the job that runs package code gets contents: read and no
 * token, and the jobs that hold a credential install nothing but the pinned
 * npm the publish needs.
 */

const release = readWorkflow("release.yml");

interface Job {
  name: string;
  permissions: Record<string, string>;
  steps: ReturnType<typeof workflowSteps>;
  /** The job's lines with whole-line comments removed. */
  code: string;
}

function jobsOf(workflow: string): Job[] {
  const lines = workflow.split("\n");
  const start = lines.indexOf("jobs:");
  expect(start, "the workflow has a jobs: block").toBeGreaterThan(-1);
  const found: { name: string; lines: string[] }[] = [];
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) found.push({ name: header[1], lines: [] });
    else found[found.length - 1]?.lines.push(line);
  }
  return found.map(({ name, lines: jobLines }) => {
    const permissions: Record<string, string> = {};
    const at = jobLines.findIndex((l) => /^ {4}permissions:\s*$/.test(l));
    if (at !== -1) {
      for (const line of jobLines.slice(at + 1)) {
        if (line.trim() === "" || line.trim().startsWith("#")) continue;
        const entry = /^ {6}([a-z-]+):\s*(\w+)\s*$/.exec(line);
        if (!entry) break;
        permissions[entry[1]] = entry[2];
      }
    }
    return {
      name,
      permissions,
      steps: workflowSteps(jobLines.join("\n")),
      code: jobLines.filter((l) => !l.trim().startsWith("#")).join("\n"),
    };
  });
}

const jobs = jobsOf(release);
const job = (name: string): Job => {
  const found = jobs.find((j) => j.name === name);
  if (!found) throw new Error(`no job named ${name}`);
  return found;
};

/** A command that runs code out of a package tree. */
const RUNS_PACKAGE_CODE = /\bnpm\s+(ci|run|install|i|exec|rebuild)\b|\bnpx\b/;

const holdsCredential = (j: Job) =>
  j.permissions["id-token"] === "write" || j.permissions.contents === "write";

describe("release.yml separates package code from credentials", () => {
  it("has the three jobs the split is written against", () => {
    expect(jobs.map((j) => j.name)).toEqual([
      "build",
      "release",
      "publish-npm",
    ]);
  });

  it("states every job's permissions instead of inheriting the default", () => {
    for (const j of jobs) {
      expect(Object.keys(j.permissions).length, j.name).toBeGreaterThan(0);
    }
  });

  it("holds no credential in any job with an npm ci or npm run step", () => {
    const building = jobs.filter((j) => /\bnpm (ci|run)\b/.test(j.code));
    expect(building.length).toBeGreaterThan(0);
    for (const j of building) {
      expect(holdsCredential(j), j.name).toBe(false);
    }
  });

  it("gives the build job contents: read and nothing else", () => {
    expect(job("build").permissions).toEqual({ contents: "read" });
  });

  it("leaves the build job's npm ci with its scripts on, as npm ci is everywhere", () => {
    // Owner decision D8: native packages need their install scripts, and the
    // guard over the lockfile's install scripts is the control.
    expect(job("build").code).toMatch(/^\s+npm ci\s*$/m);
    expect(job("build").code).not.toMatch(/--ignore-scripts/);
  });

  it("installs nothing in the job that signs and uploads", () => {
    const signing = job("release");
    expect(signing.permissions).toEqual({
      contents: "write",
      "id-token": "write",
    });
    expect(signing.code).not.toMatch(RUNS_PACKAGE_CODE);
    expect(signing.code).not.toMatch(/actions\/setup-node@/);
  });

  it("installs only the pinned npm in the job that publishes", () => {
    const publish = job("publish-npm");
    expect(publish.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    const installs = publish.code
      .split("\n")
      .filter((l) => RUNS_PACKAGE_CODE.test(l))
      .map((l) => l.trim());
    expect(installs).toEqual(['npm install --global "npm@11.21.1"']);
  });

  it("publishes the tag's own cli/, not a file another job produced", () => {
    // An artifact out of the build job has been on a runner where package
    // code ran. The CLI has no dependencies, so nothing needs that risk.
    const publish = job("publish-npm");
    expect(publish.code).not.toMatch(/actions\/download-artifact@/);
    expect(publish.code).toMatch(/git archive "\$\{TAG\}" -- cli/);
  });

  it("signs in the job with the token, and builds the tarball there too", () => {
    const signing = job("release");
    expect(signing.code).toMatch(/cosign sign-blob/);
    expect(signing.code).toMatch(/git archive --format=tar\.gz/);
    expect(job("build").code).not.toMatch(/cosign/);
  });

  it("uploads the release from the signing job, after the build finished", () => {
    expect(job("release").code).toMatch(/gh release (create|upload)/);
    expect(job("release").code).toMatch(/^ {4}needs:\s*build\s*$/m);
    expect(job("publish-npm").code).toMatch(/^ {4}needs:\s*release\s*$/m);
    expect(job("build").code).not.toMatch(/gh release/);
  });

  it("hands the build's output over as one named artifact", () => {
    const upload = job("build").steps.find((s) =>
      /actions\/upload-artifact@/.test(s.code),
    );
    const download = job("release").steps.find(
      (s) =>
        /actions\/download-artifact@/.test(s.code) && !/run-id:/.test(s.code),
    );
    expect(upload, "the build job uploads its output").toBeDefined();
    expect(download, "the signing job downloads it").toBeDefined();
    const artifactName = (code: string) =>
      /^ {10}name:\s*(\S+)\s*$/m.exec(code)?.[1];
    expect(artifactName(upload!.code)).toBeDefined();
    expect(artifactName(download!.code)).toBe(artifactName(upload!.code));
    expect(upload!.code).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40}/);
    expect(upload!.code).toMatch(/if-no-files-found:\s*error/);
  });

  it("takes only the files it expects out of the build's artifact", () => {
    // Glob the artifact and a file the build job added would be summed,
    // signed and attached to the release.
    const signing = job("release");
    const files =
      /for f in([\s\S]*?); do\s*\n\s*if \[ ! -f "\$\{BUILD_DIR\}\/\$f"/.exec(
        signing.code,
      );
    expect(files, "a fixed list of file names").not.toBeNull();
    for (const expected of [
      "vulnradar-chrome-v${EXT_VERSION}.zip",
      "vulnradar-firefox-v${EXT_VERSION}.zip",
      "vulnradar-extension-v${EXT_VERSION}-source.zip",
      "vulnradar-extension-v${EXT_VERSION}.sbom.cdx.json",
      "vulnradar-cli-v${CLI_VERSION}.tgz",
    ]) {
      expect(files![1]).toContain(expected);
    }
    expect(files![1]).not.toContain("*");
  });

  it("reads the package versions from the tag, not from the build job", () => {
    // A value computed after `npm ci` in the build job is a value package
    // code could have set, and these name the files the signing job attaches.
    expect(job("build").code).not.toMatch(/^ {4}outputs:\s*$/m);
    const signing = job("release");
    expect(signing.code).toMatch(
      /git show "\$\{TAG\}:extension\/package\.json"/,
    );
    expect(signing.code).toMatch(/git show "\$\{TAG\}:cli\/package\.json"/);
  });

  it("sets persist-credentials: false on every checkout", () => {
    const checkouts = workflowSteps(release).filter((s) =>
      /uses: actions\/checkout@/.test(s.code),
    );
    expect(checkouts.length).toBe(jobs.length);
    for (const step of checkouts) {
      expect(step.code).toMatch(/^\s+persist-credentials:\s*false\s*$/m);
    }
  });
});
