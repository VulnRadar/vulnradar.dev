import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  jobsOf,
  readWorkflow,
  topLevel,
  type WorkflowJob,
} from "./_workflow-steps";

/**
 * SECURITY.md told users to verify the image with an identity regexp naming
 * docker-publish.yml, and the multi-arch index every release tag resolves to
 * is signed by docker-publish-arm64.yml from the default branch, so the
 * documented command failed for every multi-arch release and nothing in the
 * pipeline ever ran it. The blob commands accepted the repository URL alone,
 * which any workflow on any branch of the repository (or a repository whose
 * name merely starts the same way) satisfies.
 *
 * Each identity is now defined once per workflow file, quoted exactly in
 * SECURITY.md, and verified by the pipeline right after it signs. This holds
 * every copy equal, pins what each regexp accepts and refuses, and holds each
 * signing job to verifying with the variable rather than a literal.
 * lib/updater/cosign.ts adopts the blob string in the updater-signing work and
 * joins the first check then.
 */

const ROOT = path.resolve(__dirname, "../..");
const ISSUER = "https://token.actions.githubusercontent.com";
const BASE = "https://github.com/VulnRadar/vulnradar.dev/.github/workflows";

const security = readFileSync(path.join(ROOT, "SECURITY.md"), "utf8").replace(
  /\r\n/g,
  "\n",
);
const dockerPublish = readWorkflow("docker-publish.yml");
const arm64 = readWorkflow("docker-publish-arm64.yml");
const release = readWorkflow("release.yml");

/** A key of the workflow's top-level env:, unquoted. */
function topEnv(workflow: string, key: string): string {
  const env = topLevel(workflow, "env");
  if (!env) throw new Error("the workflow has no top-level env:");
  const m = new RegExp(`^ {2}${key}:[ ]*(.+?)[ ]*$`, "m").exec(env.body);
  if (!m) throw new Error(`the top-level env: has no ${key}`);
  return m[1].replace(/^(["'])(.*)\1$/, "$2");
}

interface DocumentedCommand {
  command: "cosign verify" | "cosign verify-blob";
  identity: string;
  issuer: string;
}

/**
 * Every cosign verify command in a block of text, with the identity and
 * issuer it passes. `prefix` is what starts each line (nothing in SECURITY.md,
 * `#` plus spaces in release.yml's header comment).
 */
function documentedCommands(text: string, prefix: RegExp): DocumentedCommand[] {
  const lines = text
    .split("\n")
    .filter((l) => prefix.test(l))
    .map((l) => l.replace(prefix, "").trim());
  const found: DocumentedCommand[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(cosign verify(?:-blob)?)\s/.exec(lines[i]);
    if (!m) continue;
    let identity = "";
    let issuer = "";
    for (let j = i + 1; j < lines.length && lines[j - 1].endsWith("\\"); j++) {
      const id = /^--certificate-identity-regexp '([^']*)'/.exec(lines[j]);
      if (id) identity = id[1];
      const is = /^--certificate-oidc-issuer '([^']*)'/.exec(lines[j]);
      if (is) issuer = is[1];
    }
    found.push({
      command: m[1] as DocumentedCommand["command"],
      identity,
      issuer,
    });
  }
  return found;
}

const verifyBlock = security.slice(security.indexOf("## Verifying a Release"));
const securityCommands = documentedCommands(
  verifyBlock.slice(0, verifyBlock.indexOf("\n## ", 3)),
  /^/,
);
const releaseHeader = release.slice(0, release.indexOf("\non:\n"));
const headerCommands = documentedCommands(releaseHeader, /^#\s*/);

const IMAGE = topEnv(dockerPublish, "IMAGE_SIGNER_IDENTITY");
const BLOB = topEnv(release, "BLOB_SIGNER_IDENTITY");

describe("every copy of each signer identity is the same string", () => {
  it("the image identity in both image workflows and SECURITY.md", () => {
    expect(topEnv(arm64, "IMAGE_SIGNER_IDENTITY")).toBe(IMAGE);
    const image = securityCommands.filter((c) => c.command === "cosign verify");
    expect(image).toHaveLength(1);
    expect(image[0].identity).toBe(IMAGE);
    const header = headerCommands.filter((c) => c.command === "cosign verify");
    expect(header).toHaveLength(1);
    expect(header[0].identity).toBe(IMAGE);
  });

  it("the blob identity in release.yml, its header comment and SECURITY.md", () => {
    for (const commands of [securityCommands, headerCommands]) {
      const blob = commands.filter((c) => c.command === "cosign verify-blob");
      // The sums file and the source tarball.
      expect(blob).toHaveLength(2);
      for (const c of blob) expect(c.identity).toBe(BLOB);
    }
  });

  it("names GitHub's OIDC issuer everywhere", () => {
    for (const wf of [dockerPublish, arm64, release]) {
      expect(topEnv(wf, "SIGNER_OIDC_ISSUER")).toBe(ISSUER);
    }
    for (const c of [...securityCommands, ...headerCommands]) {
      expect(c.issuer).toBe(ISSUER);
    }
  });

  it("has no backslash, so it reads the same in YAML, Markdown and shell", () => {
    expect(IMAGE).not.toContain("\\");
    expect(BLOB).not.toContain("\\");
  });
});

describe("both identities are anchored", () => {
  it.each([
    ["image", IMAGE],
    ["blob", BLOB],
  ])("the %s identity starts with ^ and ends with $", (_, identity) => {
    expect(identity.startsWith("^")).toBe(true);
    expect(identity.endsWith("$")).toBe(true);
  });
});

// The evil set both regexps must refuse: lookalike repositories and owners,
// and a dot that was left to match any character.
const LOOKALIKES = [
  "https://github.com/VulnRadar/vulnradarXdev/.github/workflows/docker-publish.yml@refs/tags/v4.0.0",
  "https://github.com/VulnRadar/vulnradar.dev-evil/.github/workflows/docker-publish.yml@refs/tags/v4.0.0",
  "https://github.com/VulnRadar/vulnradar.dev.evil/.github/workflows/docker-publish.yml@refs/tags/v4.0.0",
  "https://github.com/VulnRadar/vulnradarXdev/.github/workflows/release.yml@refs/heads/main",
  "https://github.com/VulnRadar/vulnradar.dev-evil/.github/workflows/release.yml@refs/heads/main",
  "https://github.com/VulnRadar/vulnradar.dev.evil/.github/workflows/release.yml@refs/heads/main",
  "https://githubXcom/VulnRadar/vulnradar.dev/.github/workflows/release.yml@refs/heads/main",
  "https://github.com/Evil/vulnradar.dev/.github/workflows/docker-publish.yml@refs/tags/v4.0.0",
  "https://github.com/VulnRadar/vulnradar.dev/Xgithub/workflows/release.yml@refs/heads/main",
  "https://github.com.evil/VulnRadar/vulnradar.dev/.github/workflows/release.yml@refs/heads/main",
];

describe("the image identity", () => {
  const re = new RegExp(IMAGE);

  it.each([
    `${BASE}/docker-publish.yml@refs/tags/v4.0.0`,
    `${BASE}/docker-publish.yml@refs/tags/v4.0.0-rc.1`,
    `${BASE}/docker-publish-arm64.yml@refs/heads/main`,
  ])("accepts %s", (san) => {
    expect(re.test(san)).toBe(true);
  });

  it.each([
    `${BASE}/docker-publish.yml@refs/heads/main`,
    `${BASE}/ci.yml@refs/heads/main`,
    `${BASE}/release.yml@refs/tags/v4.0.0`,
    `${BASE}/docker-publish-arm64.yml@refs/heads/evil`,
    `${BASE}/docker-publish-arm64.yml@refs/tags/v4.0.0`,
    `${BASE}/docker-publish.yml@refs/tags/v4.0.0/extra`,
    `${BASE}/docker-publish.ymlX@refs/tags/v4.0.0`,
    `${BASE}/docker-publish.yml@refs/tags/v4.0`,
    ...LOOKALIKES,
  ])("refuses %s", (san) => {
    expect(re.test(san)).toBe(false);
  });
});

describe("the blob identity", () => {
  const re = new RegExp(BLOB);

  it.each([
    `${BASE}/release.yml@refs/heads/main`,
    `${BASE}/release.yml@refs/tags/v4.0.0`,
    `${BASE}/release.yml@refs/tags/v4.0.0-rc.1`,
  ])("accepts %s", (san) => {
    expect(re.test(san)).toBe(true);
  });

  it.each([
    `${BASE}/docker-publish.yml@refs/tags/v4.0.0`,
    `${BASE}/docker-publish-arm64.yml@refs/heads/main`,
    `${BASE}/ci.yml@refs/heads/main`,
    `${BASE}/release.yml@refs/heads/evil`,
    `${BASE}/release.yml@refs/heads/main-evil`,
    `${BASE}/release.ymlX@refs/heads/main`,
    `${BASE}/release.yml@refs/tags/v4`,
    ...LOOKALIKES,
  ])("refuses %s", (san) => {
    expect(re.test(san)).toBe(false);
  });
});

/** The job of a workflow whose steps sign with cosign. */
function signingJob(workflow: string): WorkflowJob {
  const jobs = jobsOf(workflow).filter((j) =>
    j.steps.some((s) => /^\s+cosign sign(-blob)? /m.test(s.code)),
  );
  expect(jobs).toHaveLength(1);
  return jobs[0];
}

describe("each signing job verifies what it signed, with the variable", () => {
  it.each([
    ["docker-publish.yml", dockerPublish, "IMAGE_SIGNER_IDENTITY", 1],
    ["docker-publish-arm64.yml", arm64, "IMAGE_SIGNER_IDENTITY", 1],
    ["release.yml", release, "BLOB_SIGNER_IDENTITY", 2],
  ] as const)("%s", (_, workflow, variable, signatures) => {
    const job = signingJob(workflow);
    const signIndexes = job.steps
      .filter((s) => /^\s+cosign sign(-blob)? /m.test(s.code))
      .map((s) => s.index);
    const verifies = job.steps.filter((s) =>
      /^\s+(if )?cosign verify(-blob)? /m.test(s.code),
    );
    expect(verifies).toHaveLength(1);
    const verify = verifies[0];
    expect(verify.index).toBeGreaterThan(Math.max(...signIndexes));
    expect(verify.name).toMatch(/the way SECURITY[.]md tells users to$/);

    // Each call as a command line, not a mention in an echo.
    const calls = verify.code
      .split(/^\s+(?:if )?cosign verify(?:-blob)? \\$/m)
      .slice(1);
    expect(calls).toHaveLength(signatures);
    for (const call of calls) {
      expect(call).toContain(`--certificate-identity-regexp "$${variable}"`);
      expect(call).toContain(`--certificate-oidc-issuer "$SIGNER_OIDC_ISSUER"`);
    }
    // No literal identity or issuer that could drift from the variable.
    expect(verify.code).not.toMatch(/https:\/\//);
    expect(verify.code).toMatch(/set -euo pipefail/);
  });

  it("verifies the digest it signed, not a tag that can move", () => {
    for (const workflow of [dockerPublish, arm64]) {
      const job = signingJob(workflow);
      const sign = job.steps.find((s) => /^\s+cosign sign /m.test(s.code))!;
      const verify = job.steps.find((s) => /cosign verify /.test(s.code))!;
      const target = /cosign sign --yes ("[^"]+")/.exec(sign.code)![1];
      expect(target).toMatch(/@\$\{DIGEST\}"$/);
      expect(verify.code).toContain(`${target} > /dev/null`);
      // The same step output feeds DIGEST in both steps.
      const digest = (code: string) =>
        /^\s+DIGEST: (\$\{\{ steps[.][a-z]+[.]outputs[.]digest \}\})$/m.exec(
          code,
        )?.[1];
      expect(digest(verify.code)).toBeDefined();
      expect(digest(verify.code)).toBe(digest(sign.code));
    }
  });

  it("release.yml verifies both bundles it made: the sums file and the tarball", () => {
    const verify = signingJob(release).steps.find((s) =>
      /cosign verify-blob /.test(s.code),
    )!;
    expect(verify.code).toMatch(/--bundle sha256sums[.]txt[.]cert /);
    expect(verify.code).toMatch(/^\s+sha256sums[.]txt$/m);
    expect(verify.code).toContain('--bundle "vulnradar-${TAG}.tar.gz.cert"');
    expect(verify.code).toMatch(/^\s+"vulnradar-\$\{TAG\}[.]tar[.]gz"$/m);
  });
});
