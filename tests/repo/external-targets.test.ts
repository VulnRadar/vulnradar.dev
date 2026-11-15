import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PUBLIC_ROUTES } from "@/lib/seo/routes";
import { CHECK_PAGE_IDS } from "@/lib/seo/check-page-ids.generated";
import { jobsOf, readWorkflow } from "./_workflow-steps";

/**
 * Where CI sends traffic, held to a short list.
 *
 * VulnRadar scans other people's sites, so the one hard rule of its own CI is
 * that nothing here is ever aimed at a target that is not ours. ZAP, Lighthouse
 * and the sitemap check run only against the container the job built and
 * booted on the runner. The weekly live check reads one HEAD response and one
 * TLS handshake from vulnradar.dev and nothing else. These tests read the
 * workflows and fail on anything that would change that: a ZAP run that is
 * not on the sandbox network, a sandbox that has a way out, a Lighthouse
 * report published to a public host, or a host named in a workflow that this
 * file does not list with the place it may appear.
 */

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");
const WORKFLOWS = readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();
const readRepo = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const isComment = (line: string) => line.trim().startsWith("#");
const codeOf = (text: string) =>
  text
    .split("\n")
    .filter((l) => !isComment(l))
    .join("\n");

/** Each shell command of a run body, with its line continuations joined. */
function commandsOf(code: string): string[] {
  return code.replace(/ *\\\n\s*/g, " ").split("\n");
}

const files = WORKFLOWS.map((file) => ({
  file,
  text: readWorkflow(file),
  jobs: jobsOf(readWorkflow(file)),
}));

/* ------------------------------------------------------------------------ */
/* ZAP: the sandbox, and what it may be pointed at.                          */
/* ------------------------------------------------------------------------ */

describe("ZAP", () => {
  const zapCommands = files.flatMap(({ file, jobs }) =>
    jobs.flatMap((job) =>
      commandsOf(job.code)
        .filter((c) => /\bdocker run\b/.test(c) && /\bvr-zap\b/.test(c))
        .map((command) => ({ file, job: job.id, command })),
    ),
  );

  it("is run in site-checks.yml, once for the baseline and once for the full scan", () => {
    expect(zapCommands.map((z) => `${z.file} ${z.job}`).sort()).toEqual([
      "site-checks.yml zap-baseline",
      "site-checks.yml zap-full",
    ]);
  });

  it.each(zapCommands.map((z) => [`${z.file} ${z.job}`, z.command]))(
    "%s targets the app container on the sandbox network and nothing else",
    (_, command) => {
      expect(command).toMatch(/ -t http:\/\/vr-app:3000(?= )/);
      expect(command.match(/ -t /g)).toHaveLength(1);
      expect(command).toMatch(/\bdocker run\b.* --network vr-sandbox /);
      expect(command).toMatch(/ vr-zap zap-[a-z-]+[.]py /);
    },
  );

  it("creates the sandbox network with --internal, and only that network", () => {
    const creates = files.flatMap(({ file, jobs }) =>
      jobs.flatMap((job) =>
        commandsOf(job.code)
          .filter((c) => /\bdocker network create\b/.test(c))
          .map((c) => `${file} ${job.id}: ${c.trim()}`),
      ),
    );
    expect(creates.length).toBe(2);
    for (const c of creates) {
      expect(c).toMatch(/docker network create --internal vr-sandbox$/);
    }
  });

  it("starts the app and its database on the sandbox network, with no published port", () => {
    for (const { file, jobs } of files) {
      for (const job of jobs) {
        for (const c of commandsOf(job.code)) {
          if (!/\bdocker run\b/.test(c) || !/--name vr-(app|db)\b/.test(c)) {
            continue;
          }
          expect(c, `${file} ${job.id}`).toContain("--network vr-sandbox");
          expect(c, `${file} ${job.id}`).not.toMatch(/ (-p|--publish)\b/);
          expect(c, `${file} ${job.id}`).not.toContain("--network host");
        }
      }
    }
  });

  it("gives the app none of the settings that would let it send mail or spend credit", () => {
    const sandboxed = files.flatMap(({ jobs }) =>
      jobs.filter((j) => /--name vr-app\b/.test(j.code)),
    );
    expect(sandboxed.length).toBe(2);
    for (const job of sandboxed) {
      expect(job.code).not.toMatch(
        /\b(SMTP|STRIPE|DISCORD|OPENAI|ANTHROPIC|AI_|BROWSERBASE|TURNSTILE)[A-Z_]*=/,
      );
    }
  });

  it("proves the sandbox has no egress before it scans, and expects that to fail", () => {
    for (const { file, jobs } of files) {
      for (const job of jobs.filter((j) => /zap-[a-z-]+[.]py/.test(j.code))) {
        const steps = job.steps;
        const proof = steps.find(
          (s) => s.name === "Prove the sandbox has no egress",
        );
        expect(proof, `${file} ${job.id} has the egress proof`).toBeDefined();
        const scan = steps.find((s) => /zap-[a-z-]+[.]py/.test(s.code))!;
        expect(proof!.index).toBeLessThan(scan.index);
        // The command is the condition of an if, and a success exits 1.
        expect(proof!.code).toMatch(
          /if docker exec vr-app wget -T 5 -q -O \/dev\/null https:\/\/vulnradar[.]dev\/robots[.]txt; then/,
        );
        expect(proof!.code).toMatch(/^\s+exit 1$/m);
        expect(proof!.code).not.toMatch(/\|\| true/);
      }
    }
  });

  it("keeps ZAP's report on the runner and in Actions artifacts", () => {
    const text = readWorkflow("site-checks.yml");
    expect(codeOf(text)).not.toMatch(/zaproxy\/action-/);
    expect(codeOf(text)).not.toMatch(/--hook|--auth/);
  });
});

/* ------------------------------------------------------------------------ */
/* Lighthouse: the pages, and where the report goes.                         */
/* ------------------------------------------------------------------------ */

describe("Lighthouse", () => {
  const rc = JSON.parse(readRepo(".github/lighthouse/lighthouserc.json")) as {
    ci: {
      collect: { url: string[]; numberOfRuns: number };
      upload?: { target?: string };
      assert: {
        assertMatrix: {
          matchingUrlPattern: string;
          assertions: Record<string, [string, { minScore: number }]>;
        }[];
      };
    };
  };
  const urls = rc.ci.collect.url.map((u) => new URL(u));

  it("audits localhost pages only", () => {
    expect(urls.length).toBeGreaterThanOrEqual(12);
    for (const u of urls) {
      expect(u.origin, u.href).toBe("http://localhost:3000");
    }
  });

  it("audits only pages the sitemap publishes", () => {
    const published = new Set(PUBLIC_ROUTES.map((r) => r.path));
    for (const u of urls) {
      expect(published.has(u.pathname), u.pathname).toBe(true);
    }
    const check = urls.find((u) => u.pathname.startsWith("/checks/"));
    expect(check, "one per-check page").toBeDefined();
    expect(CHECK_PAGE_IDS).toContain(check!.pathname.slice("/checks/".length));
  });

  it("never uploads a report to a public host", () => {
    expect([undefined, "filesystem"]).toContain(rc.ci.upload?.target);
    expect(JSON.stringify(rc)).not.toMatch(/temporary-public-storage/);
    const site = readWorkflow("site-checks.yml");
    expect(site).toMatch(/^\s+temporaryPublicStorage: false$/m);
    expect(site).toMatch(/^\s+uploadArtifacts: true$/m);
    expect(codeOf(site)).not.toMatch(/temporaryPublicStorage: true/);
  });

  it("holds accessibility, SEO and best practices as errors, and performance as a warning", () => {
    expect(rc.ci.assert.assertMatrix.length).toBeGreaterThan(0);
    for (const group of rc.ci.assert.assertMatrix) {
      for (const category of ["accessibility", "seo", "best-practices"]) {
        const [level, options] = group.assertions[`categories:${category}`];
        expect(level, `${group.matchingUrlPattern} ${category}`).toBe("error");
        expect(options.minScore).toBeGreaterThan(0);
      }
      expect(group.assertions["categories:performance"][0]).toBe("warn");
    }
  });

  it("matches every audited URL with exactly one group", () => {
    for (const u of urls) {
      const matching = rc.ci.assert.assertMatrix.filter((g) =>
        new RegExp(g.matchingUrlPattern).test(u.href),
      );
      expect(matching.length, u.href).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Every host a workflow or the composite action names.                      */
/* ------------------------------------------------------------------------ */

/**
 * The hosts that may appear, and where. A host that is not here fails until it
 * gets a row with its reason; a host in a file the row does not list fails
 * too. `.test` and `.invalid` names never resolve: they are data.
 */
const ALLOWED_HOSTS: {
  host: RegExp;
  where: "any" | string[];
  reason: string;
}[] = [
  {
    host: /^(localhost|127[.]0[.]0[.]1|\[::1\]|vr-app|vr-db)$/,
    where: "any",
    reason: "the runner's own containers and loopback",
  },
  {
    host: /^([a-z0-9-]+[.])+(test|invalid)$/,
    where: "any",
    reason: "reserved names that never resolve: sentinels and test data",
  },
  {
    host: /^([a-z0-9-]+[.])*example[.](com|org|net)$/,
    where: ["ci.yml"],
    reason:
      "RFC 2606 example domain, written into a compose config the job only parses and never connects to",
  },
  {
    host: /^github[.]com$/,
    where: [
      "release.yml",
      "docker-publish.yml",
      "docker-publish-arm64.yml",
      "scheduled.yml",
    ],
    reason: "cosign signer identities, and the live check's user agent link",
  },
  {
    host: /^token[.]actions[.]githubusercontent[.]com$/,
    where: ["release.yml", "docker-publish.yml", "docker-publish-arm64.yml"],
    reason: "the OIDC issuer cosign verifies against",
  },
  {
    host: /^ghcr[.]io$/,
    where: [
      "release.yml",
      "docker-publish.yml",
      "docker-publish-arm64.yml",
      "scheduled.yml",
    ],
    reason: "VulnRadar's own image registry",
  },
  {
    host: /^registry[.]npmjs[.]org$/,
    where: ["release.yml", "scheduled.yml"],
    reason: "the npm registry: provenance checks and version reads",
  },
  {
    host: /^(nodejs[.]org|hub[.]docker[.]com)$/,
    where: ["scheduled.yml"],
    reason:
      "the outdated report's read-only version lookups (Node releases, Postgres tags)",
  },
  {
    host: /^vulnradar[.]dev$/,
    where: ["scheduled.yml", "site-checks.yml", "scan-gate/action.yml"],
    reason:
      "the weekly live check (one HEAD, one handshake), the egress proof, which must fail, and the action's documented default api-base-url",
  },
];

const TLDS = "com|org|io|dev|net|invalid|test";

function hostsIn(text: string): string[] {
  const code = codeOf(text)
    // Identity regexps write a dot as [.]; read them as the host they mean.
    .replace(/\[[.]\]/g, ".");
  const hosts = new Set<string>();
  for (const m of code.matchAll(
    /\b(?:https?|wss?):\/\/(\[[0-9a-f:]+\]|[A-Za-z0-9.-]+)/gi,
  )) {
    hosts.add(m[1].toLowerCase());
  }
  for (const m of code.matchAll(
    new RegExp(
      `(?<![A-Za-z0-9/_.-])((?:[a-z0-9-]+[.])+(?:${TLDS}))(?![A-Za-z0-9_-])`,
      "gi",
    ),
  )) {
    hosts.add(m[1].toLowerCase());
  }
  return [...hosts].sort();
}

describe("the hosts the workflows and the composite action name", () => {
  const sources = [
    ...WORKFLOWS.map((f) => ({
      file: f,
      text: readRepo(`.github/workflows/${f}`),
    })),
    {
      file: "scan-gate/action.yml",
      text: readRepo(".github/actions/scan-gate/action.yml"),
    },
  ];

  it("reads the hosts out of every file it should", () => {
    const all = sources.flatMap((s) => hostsIn(s.text));
    expect(all).toContain("localhost");
    expect(all).toContain("ghcr.io");
    expect(all).toContain("vulnradar.dev");
  });

  it.each(sources.map((s) => [s.file, s.text]))(
    "%s names only listed hosts, in the places the list allows",
    (file, text) => {
      for (const host of hostsIn(text)) {
        const row = ALLOWED_HOSTS.find((r) => r.host.test(host));
        expect(row, `${file} names ${host}, which no row allows`).toBeDefined();
        if (row && row.where !== "any") {
          expect(
            row.where,
            `${file} names ${host}, which is allowed only in ${row.where.join(", ")}`,
          ).toContain(file);
        }
      }
    },
  );

  it("gives every row a reason", () => {
    for (const row of ALLOWED_HOSTS) {
      expect(row.reason.length).toBeGreaterThan(10);
    }
  });
});
