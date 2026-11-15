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
        // It contacts no host at all: no URL, no hostname, no lookup.
        expect(proof!.code).not.toMatch(/https?:\/\//);
        expect(proof!.code).not.toMatch(/\b(wget|curl|nslookup|getent|dig)\b/);
        // A default route in the container's table fails the job.
        expect(proof!.code).toContain(
          "routes=$(docker exec vr-app cat /proc/net/route)",
        );
        expect(proof!.code).toContain(
          `if echo "$routes" | awk 'NR > 1 && $2 == "00000000" { found = 1 } END { exit found ? 0 : 1 }'; then`,
        );
        // And a connection to a documentation address must fail for want
        // of a route, not time out: only ENETUNREACH passes.
        expect(proof!.code).toContain('host: "192.0.2.1", port: 443');
        expect(proof!.code).toContain(
          's.on("error", (e) => done(e.code === "ENETUNREACH", e.code));',
        );
        expect(proof!.code).toContain(
          's.setTimeout(5000, () => done(false, "timed out, so the address is routed"));',
        );
        expect(proof!.code).toContain("if ! docker exec vr-app node -e '");
        expect(proof!.code.match(/^\s+exit 1$/gm)?.length).toBe(2);
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
    where: ["scheduled.yml", "scan-gate/action.yml"],
    reason:
      "the weekly live check (one HEAD, one handshake) and the action's documented default api-base-url",
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

/* ------------------------------------------------------------------------ */
/* The weekly live check, and the report job that holds the write scope.     */
/* ------------------------------------------------------------------------ */

describe("scheduled.yml", () => {
  const scheduled = files.find((f) => f.file === "scheduled.yml")!;
  const job = (id: string) => scheduled.jobs.find((j) => j.id === id)!;

  it("has the six jobs the report issues are made from", () => {
    expect(scheduled.jobs.map((j) => j.id)).toEqual([
      "audit",
      "outdated",
      "live",
      "image-scan",
      "secrets-history",
      "report",
    ]);
  });

  describe("the live check", () => {
    const live = job("live");
    const lines = live.code.split("\n");

    it("runs no repository code: no checkout, no action, no permissions", () => {
      expect(live.code).not.toMatch(/^\s+-?\s*uses:/m);
      expect(live.code).not.toMatch(/actions\/checkout/);
      expect(live.permissionsDeclared).toBe("{}");
    });

    it("makes exactly one request: a HEAD of the home page, redirects not followed", () => {
      const curls = lines.filter((l) => /\bcurl\b/.test(l));
      expect(curls).toHaveLength(1);
      expect(curls[0]).toContain(" -I ");
      expect(curls[0]).toContain("https://vulnradar.dev/");
      expect(curls[0]).toContain("--max-redirs 0");
      expect(curls[0]).toContain("--proto '=https'");
      // The request itself, up to where its answer is piped on.
      const request = curls[0].split(/ [|]{1,2} /)[0];
      expect(request).not.toMatch(
        / -X | --data| -d | -L | --location|-o |--output/,
      );
      expect(live.code).not.toMatch(/\b(wget|nmap|nikto|sslscan|testssl)\b/);
    });

    it("makes exactly one TLS handshake, to vulnradar.dev:443, and never probes a protocol version", () => {
      const handshakes = lines.filter((l) => /\bopenssl s_client\b/.test(l));
      expect(handshakes).toHaveLength(1);
      expect(handshakes[0]).toContain("-connect vulnradar.dev:443");
      expect(handshakes[0]).toContain("-servername vulnradar.dev");
      expect(handshakes[0]).toContain("-verify_return_error");
      expect(handshakes[0]).not.toMatch(
        /-(tls1|tls1_1|ssl3|cipher|starttls)\b/,
      );
      // Every other openssl call reads the certificate from text, not a socket.
      for (const l of lines.filter((l) => /\bopenssl\b/.test(l))) {
        if (!/s_client/.test(l)) expect(l).toMatch(/openssl x509 /);
      }
    });

    it("asserts the headers and the certificate the security posture documents", () => {
      for (const needle of [
        "strict-transport-security",
        "includeSubDomains",
        "preload",
        "'strict-dynamic'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "x-frame-options DENY",
        "x-content-type-options nosniff",
        "referrer-policy strict-origin-when-cross-origin",
        "cross-origin-opener-policy same-origin",
        "cross-origin-resource-policy same-origin",
        "permissions-policy",
        "x-powered-by",
        "Verify return code: 0 (ok)",
        "-checkend 1209600",
        "-checkend 1814400",
      ]) {
        expect(live.code, needle).toContain(needle);
      }
    });

    it("hands its report to the report job as an output, not an artifact", () => {
      expect(live.raw).toMatch(
        /^ {4}outputs:\n {6}report: \$\{\{ steps\.live\.outputs\.report \}\}$/m,
      );
    });
  });

  it("gives the report job the only write scope in the file, and no checkout", () => {
    for (const j of scheduled.jobs) {
      const writes = Object.values(j.permissions).filter((v) => v === "write");
      if (j.id === "report") {
        expect(j.permissions).toEqual({ issues: "write" });
      } else {
        expect(writes, j.id).toEqual([]);
      }
    }
    const report = job("report");
    expect(report.code).not.toMatch(/actions\/checkout/);
    expect(report.code).not.toMatch(/^\s+-?\s*run:.*\b(npm|npx|node)\b/m);
  });

  it("edits one open issue per report by exact title and creates no labels", () => {
    const report = job("report");
    expect(report.code).toContain("Scheduled report: ");
    expect(report.code).toContain("select(.title == $t and");
    expect(report.code).toContain("gh issue edit");
    expect(report.code).toContain("gh issue create --title");
    expect(report.code).not.toMatch(/--label|gh label/);
  });

  it("never installs with scripts on, in any job", () => {
    for (const j of scheduled.jobs) {
      for (const c of commandsOf(j.code)) {
        if (/\bnpm (ci|install|i)\b/.test(c)) {
          expect(c, `${j.id}: ${c.trim()}`).toContain("--ignore-scripts");
        }
      }
    }
  });

  it("scans only VulnRadar's own image and repository, and reads the registries read-only", () => {
    const code = scheduled.jobs.map((j) => j.code).join("\n");
    expect(code).toContain("registry:ghcr.io/vulnradar/vulnradar:latest");
    // Version lookups are GETs of public lists; nothing is posted anywhere.
    for (const c of commandsOf(code).filter((c) => /\bcurl\b/.test(c))) {
      expect(c.split(/ [|]{1,2} /)[0]).not.toMatch(
        / -X | --data| -d | -F | --form/,
      );
    }
  });
});
