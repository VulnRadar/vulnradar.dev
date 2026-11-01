import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readWorkflow, workflowSteps, stepNamed } from "./_workflow-steps";

/**
 * The CLI is published to npm from release.yml with trusted publishing.
 *
 * The workflow grants `id-token: write` and stores no npm token, which is
 * exactly what trusted publishing wants, but the npm that ships with the
 * pinned Node 22 is 10.x and the OIDC exchange only exists from npm 11.5.1. An
 * old npm does not say "too old": it looks for a token, finds none and reports
 * ENEEDAUTH, which reads as a missing secret. So the step that installs a new
 * enough npm and checks its version has to come first, and these tests pin
 * that order rather than trusting it to survive an edit.
 *
 * The other half of the setup (registering the Trusted Publisher for the
 * package `vulnradar` on npmjs.com) is an owner action outside the repository.
 */

const release = readWorkflow("release.yml");
const steps = workflowSteps(release);

const INSTALL = "Install npm 11.21.1";
const PUBLISH = "Publish the CLI to npm";
const PACK = "Pack the CLI tarball";
const ATTACH = "Find or create GitHub release";

describe("release.yml npm publishing", () => {
  const install = stepNamed(steps, INSTALL);
  const publish = stepNamed(steps, PUBLISH);

  it("grants the job id-token: write, the permission trusted publishing needs", () => {
    const job = release.slice(release.search(/^ {2}release:$/m));
    expect(job).toMatch(/^ {6}id-token:\s*write\s*$/m);
  });

  it("stores no npm token anywhere", () => {
    const code = steps.map((s) => s.code).join("\n");
    expect(code).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(code).not.toMatch(/secrets\.NPM/i);
  });

  it("points setup-node at the public registry", () => {
    const setup = steps.find((s) => /actions\/setup-node@/.test(s.code));
    expect(setup?.code).toMatch(
      /^\s+registry-url:\s*"?https:\/\/registry\.npmjs\.org\/?"?\s*$/m,
    );
  });

  it("installs one exact npm, at least 11.5.1, and asserts the version it got", () => {
    // A range would let a new npm release run unreviewed in the job that
    // signs the release and publishes with provenance.
    const pinned = /npm install --global "npm@(\d+)\.(\d+)\.(\d+)"/.exec(
      install.code,
    );
    expect(pinned).not.toBeNull();
    const [major, minor] = [Number(pinned![1]), Number(pinned![2])];
    expect(major > 11 || (major === 11 && minor >= 5)).toBe(true);
    expect(install.code).toContain("npm --version");
    expect(install.code).toContain("sort -V");
    expect(install.code).toMatch(/exit 1/);
  });

  it("publishes exactly once, with provenance and public access", () => {
    const publishes = steps.filter((s) => /\bnpm publish\b/.test(s.code));
    expect(publishes.map((s) => s.name)).toEqual([PUBLISH]);
    expect(publish.code).toContain("npm publish --provenance --access public");
  });

  it("installs npm before the step that publishes", () => {
    expect(install.index).toBeLessThan(publish.index);
  });

  it("publishes from the tag's cli/ after it has been packed and attached", () => {
    expect(publish.index).toBeGreaterThan(stepNamed(steps, PACK).index);
    expect(publish.index).toBeGreaterThan(stepNamed(steps, ATTACH).index);
    expect(publish.code).toContain('cd "${RUNNER_TEMP}/cli-src/cli"');
    // The directory the pack step extracts the tag's cli/ into.
    expect(stepNamed(steps, PACK).code).toContain(
      'CLI_DIR="${RUNNER_TEMP}/cli-src"',
    );
  });

  it("only publishes a version that is not on the registry, and only trusts a 404", () => {
    expect(publish.code).toContain(
      'npm view "vulnradar@${CLI_VERSION}" version',
    );
    expect(publish.code).toContain("E404");
    // Any other failure from `npm view` stops the job; it must not fall
    // through to the publish as if the version were absent.
    expect(publish.code).toMatch(/Could not tell whether[\s\S]*exit 1/);
    expect(publish.code.indexOf("E404")).toBeLessThan(
      publish.code.indexOf("npm publish"),
    );
    expect(publish.code).toMatch(/already on npm[\s\S]*exit 0/);
  });

  it("keeps npm view's warnings out of the version it compares", () => {
    // `2>&1` would fold a warning line into the captured version, and a
    // version that is on the registry would then look absent.
    expect(publish.code).not.toMatch(/npm view[^\n]*2>&1/);
    expect(publish.code).toMatch(/npm view[^\n]*2>"\$\{VIEW_ERR\}"/);
  });

  it("leaves release candidates off npm's latest tag", () => {
    const skip = /if:\s*\$\{\{\s*!contains\(steps\.vars\.outputs\.tag,\s*'-'\)/;
    expect(install.code).toMatch(skip);
    expect(publish.code).toMatch(skip);
  });

  it("never publishes from a v1 to v3 tag, whose cli/ still says 0.2.0", () => {
    // A 3.9.x patch is cut from the 3.9.1 tag but runs this copy of the
    // workflow; publishing there would spend 0.2.0 on the old CLI.
    for (const major of ["v1.", "v2.", "v3."]) {
      const skip = `!startsWith(steps.vars.outputs.tag, '${major}')`;
      expect(install.code).toContain(skip);
      expect(publish.code).toContain(skip);
    }
  });
});

describe("the CLI package npm publishes", () => {
  const cli = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../cli/package.json"), "utf8"),
  ) as { name: string; repository: { url: string } };

  it("is the package the release publishes", () => {
    expect(cli.name).toBe("vulnradar");
  });

  it("names this repository, which provenance checks against the workflow's", () => {
    expect(cli.repository.url).toBe(
      "git+https://github.com/VulnRadar/vulnradar.dev.git",
    );
  });
});
