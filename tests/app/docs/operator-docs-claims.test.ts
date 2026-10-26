import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_TAB_DESCRIPTIONS } from "@/app/docs/administration/admin-tab-descriptions";
import { VALID_TABS } from "@/components/admin/nav";

/**
 * Drift guards for the operator-facing docs pages.
 *
 * `/docs/rate-limits` once told readers that three roles were exempt from
 * daily quotas when seven roles resolve to the staff tag and none of them is
 * exempt. Nobody noticed because nothing checked the page against the code.
 * The same audit found the same class of rot on these pages: a
 * `docker compose exec db` for a service named `postgres`, a `DB_PORT`
 * presented as read by compose when compose publishes no host port for
 * Postgres at all, a `.npmrc` allow-script list that has never existed, and a
 * `db:restore` invocation with none of the flags the script requires.
 *
 * Anything a page can RENDER from a constant is rendered (see the pages
 * themselves). What is left is prose and shell snippets, which cannot be, so
 * they are asserted against the real source here instead. Reading the source
 * text rather than importing the pages is deliberate: these are .tsx server
 * components, and the point is to check the literals a reader will see.
 */

const DOC_PAGES = [
  "app/docs/page.tsx",
  "app/docs/setup/page.tsx",
  "app/docs/self-hosting/page.tsx",
  "app/docs/config/page.tsx",
  "app/docs/cli/page.tsx",
  "app/docs/administration/page.tsx",
  "app/docs/troubleshooting/page.tsx",
] as const;

const read = (path: string) => readFileSync(path, "utf8");
const pages = DOC_PAGES.map((path) => [path, read(path)] as const);

describe("every `docker compose` command names a real service", () => {
  // Top-level keys under `services:` in docker-compose.yml. Two spaces of
  // indent, which is what that file uses and what compose requires. The
  // block ends at the next top-level key or at the end of the file; JS has
  // no \Z, and writing one matched a literal Z.
  const compose = read("docker-compose.yml");
  const servicesBlock =
    compose.match(/^services:\n([\s\S]*?)(?=^\S|(?![\s\S]))/m)?.[1] ?? "";
  const services = new Set(
    [...servicesBlock.matchAll(/^ {2}([a-z][a-z0-9_-]*):$/gm)].map((m) => m[1]),
  );

  it("docker-compose.yml parsed into a non-empty service list", () => {
    expect(services.size).toBeGreaterThan(0);
  });

  // Subcommands that take a service name. `[ \t]` rather than `\s` so a
  // flagless `docker compose up -d` cannot swallow the next line's first word.
  const INVOCATION =
    /docker compose\s+(exec|run|build|restart|stop|start|logs|ps|up)((?:[ \t]+-{1,2}[A-Za-z]+)*)(?:[ \t]+([A-Za-z][A-Za-z0-9_-]*))?/g;

  for (const [path, source] of pages) {
    const named = [...source.matchAll(INVOCATION)]
      .map((m) => ({ verb: m[1], service: m[3] }))
      .filter((c) => c.service !== undefined);
    if (named.length === 0) continue;

    it(`${path} only names services docker-compose.yml defines`, () => {
      for (const { verb, service } of named) {
        expect(
          services.has(service!),
          `${path} tells an operator to run \`docker compose ${verb} ${service}\`, ` +
            `but docker-compose.yml defines no service called "${service}" ` +
            `(it has: ${[...services].join(", ")}). The command fails outright.`,
        ).toBe(true);
      }
    });
  }
});

describe("every `npm run` script the docs name exists", () => {
  const scripts = new Set(
    Object.keys(
      JSON.parse(read("package.json")).scripts as Record<string, string>,
    ),
  );

  for (const [path, source] of pages) {
    const named = [...source.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map(
      (m) => m[1],
    );
    if (named.length === 0) continue;

    it(`${path} names only real package.json scripts`, () => {
      for (const script of named) {
        expect(
          scripts.has(script),
          `${path} tells an operator to run \`npm run ${script}\`, which is ` +
            `not a script in package.json. A renamed script leaves the ` +
            `documented recovery path dead.`,
        ).toBe(true);
      }
    });
  }
});

describe("every CONFIG_* constant the docs name still exists", () => {
  const configValues = read("lib/config/config-values.ts");
  const exported = new Set(
    [...configValues.matchAll(/^export const (CONFIG_[A-Z0-9_]+)/gm)].map(
      (m) => m[1],
    ),
  );

  it("config-values.ts parsed into a non-empty constant list", () => {
    expect(exported.size).toBeGreaterThan(50);
  });

  for (const [path, source] of pages) {
    const named = [
      ...new Set([...source.matchAll(/\bCONFIG_[A-Z0-9_]+/g)].map((m) => m[0])),
    ];
    if (named.length === 0) continue;

    it(`${path} names only constants config-values.ts exports`, () => {
      for (const name of named) {
        expect(
          exported.has(name),
          `${path} documents ${name}, which lib/config/config-values.ts no ` +
            `longer exports. Renaming a constant must rename it here too.`,
        ).toBe(true);
      }
    });
  }
});

describe("the Docker-only variable list", () => {
  /**
   * The bullet list under "Docker-only" on /docs/config claims every entry is
   * "read by docker-compose.yml". `DB_PORT` sat in it for as long as compose
   * had a published Postgres port, and stayed after the port went away. Only
   * the <ul> is checked: the paragraph after it deliberately names DB_PORT to
   * say that setting it does nothing.
   */
  const source = read("app/docs/config/page.tsx");
  const start = source.indexOf('title="Docker-only"');
  const listEnd = source.indexOf("</ul>", start);

  it("locates the Docker-only bullet list", () => {
    expect(start).toBeGreaterThan(-1);
    expect(listEnd).toBeGreaterThan(start);
  });

  it("names only variables docker-compose.yml actually reads", () => {
    const compose = read("docker-compose.yml");
    const listed = [
      ...new Set(
        [
          ...source
            .slice(start, listEnd)
            .matchAll(/<InlineCode>([A-Z][A-Z0-9_]{2,})<\/InlineCode>/g),
        ].map((m) => m[1]),
      ),
    ];
    expect(listed.length).toBeGreaterThan(0);
    for (const name of listed) {
      expect(
        compose.includes(name),
        `/docs/config lists ${name} as a variable docker-compose.yml reads, ` +
          `but that file never mentions it. Setting it changes nothing, which ` +
          `is the worst kind of documented knob.`,
      ).toBe(true);
    }
  });
});

describe("the CLI page's Node floor", () => {
  it("matches cli/package.json's engines range", () => {
    const engines = JSON.parse(read("cli/package.json")).engines?.node as
      string | undefined;
    const major = engines?.match(/(\d+)/)?.[1];
    expect(major, "cli/package.json declares no engines.node").toBeTruthy();
    expect(
      read("app/docs/cli/page.tsx").includes(`Node ${major}`),
      `/docs/cli must state the Node floor cli/package.json actually ` +
        `declares (${engines}). It advertised Node 18 for a year after the ` +
        `CLI moved to ${engines}.`,
    ).toBe(true);
  });
});

/**
 * Toolchain numbers the contributor docs transcribe.
 *
 * These are the ones that cannot be rendered from a constant without pulling
 * package.json into a page bundle, so they are typed out, and every one of
 * them had rotted: the test runner was named a major behind and quoted with an
 * engines range containing a branch that does not exist, `.nvmrc` was quoted
 * as the major when it pins an exact patch, the `engines` field was quoted
 * without the upper bound in a paragraph whose entire subject is which
 * versions are excluded, and the CI diagram promised dependabot auto-merges
 * minors when the workflow was corrected to patch-only.
 */
describe("contributor docs quote the real toolchain", () => {
  const developers = read("app/docs/developers/page.tsx");
  const architecture = read("app/docs/architecture/page.tsx");
  const pkg = JSON.parse(read("package.json"));
  const vitestPkg = JSON.parse(read("node_modules/vitest/package.json"));

  it("quotes package.json's engines range in full", () => {
    expect(
      developers,
      "the Node callout quotes the engines field; it must be the whole " +
        "range, since the paragraph's point is which versions are excluded",
    ).toContain(`"node": "${pkg.engines.node}"`);
  });

  it("quotes what .nvmrc actually pins", () => {
    const nvmrc = read(".nvmrc").trim();
    expect(developers).toContain(nvmrc);
    // The old text said "which says 22", which is the major, not the pin.
    expect(developers).not.toMatch(/\.nvmrc \(which says \d+\)/);
  });

  it("names the test runner's real major", () => {
    const major = String(vitestPkg.version).split(".")[0];
    expect(developers).toContain(`vitest@${major}`);
    // Nothing should still be pointing at a different one.
    const named = [...developers.matchAll(/vitest@(\d+)/g)].map((m) => m[1]);
    expect(new Set(named)).toEqual(new Set([major]));
  });

  it("quotes the test runner's real engines range", () => {
    // Rendered with &gt; for the `>=` branch, so compare against that form.
    const range = String(vitestPkg.engines.node).replace(/>/g, "&gt;");
    expect(
      developers,
      "the Node version policy quotes vitest's own engines field",
    ).toContain(range);
  });

  it("describes dependabot auto-merge the way the workflow gates it", () => {
    const wf = read(".github/workflows/dependabot-auto-merge.yml");
    const merges = new Set(
      [...wf.matchAll(/version-update:semver-(patch|minor|major)/g)].map(
        (m) => m[1],
      ),
    );
    const claimed = architecture.match(/auto-merge ([a-z+ ]+?) only/)?.[1];
    expect(claimed, "the CI diagram's dependabot line").toBeTruthy();
    const claimedSet = new Set(
      (claimed as string).split("+").map((p) => p.trim()),
    );
    expect(claimedSet).toEqual(merges);
  });

  it("shows requireStaff with the arity it actually has", () => {
    const authorization = read("lib/auth/authorization.ts");
    const params = authorization.match(
      /export async function requireStaff\(([^)]*)\)/,
    )?.[1];
    expect(params, "requireStaff's declaration").toBeDefined();
    if ((params as string).trim() === "") {
      expect(
        architecture,
        "requireStaff takes no arguments, so the helper list must not " +
          "show it taking one",
      ).not.toMatch(/requireStaff\([^)]+\)/);
    }
  });

  it("states the Discord OAuth state TTL the config sets", () => {
    const configValues = read("lib/config/config-values.ts");
    const seconds = Number(
      configValues.match(
        /CONFIG_DISCORD_OAUTH_STATE_TTL_SECONDS\s*=\s*(\d+)/,
      )?.[1],
    );
    expect(Number.isFinite(seconds)).toBe(true);
    const minutes = seconds / 60;
    // The bullet names Discord's own TTL, which is deliberately tighter than
    // the general OAuth flow's. Quoting the general one read as correct.
    const discordBullet = architecture.slice(
      architecture.indexOf("Discord OAuth:"),
    );
    expect(discordBullet.slice(0, 600)).toContain(`${minutes}-minute TTL`);
  });
});

/**
 * The Node patch the setup page states.
 *
 * It said the Dockerfile builds on node:22.23.3-alpine after the Dockerfile had
 * moved to 22.23.4, because a dependency bump changed the one and nothing
 * pointed at the other. The Dockerfile is the source of truth for "what the
 * image runs", so the page is checked against its FROM lines rather than
 * against a number typed into this test.
 */
describe("the Node pin the setup page states", () => {
  const pins = new Set(
    [
      ...read("Dockerfile").matchAll(/^FROM node:(\d+\.\d+\.\d+)-alpine\b/gm),
    ].map((m) => m[1]),
  );
  const setup = read("app/docs/setup/page.tsx");

  it("finds the Dockerfile's base image, and every stage agrees on it", () => {
    expect(
      [...pins],
      "the Dockerfile's stages are on different Node patches, so the setup " +
        "page cannot name one",
    ).toHaveLength(1);
  });

  it("names the patch the Dockerfile builds on", () => {
    for (const pin of pins) {
      expect(setup).toContain(`node:${pin}-alpine`);
    }
  });

  it("names no other patch of the image", () => {
    const named = [...setup.matchAll(/node:(\d+\.\d+\.\d+)-alpine/g)].map(
      (m) => m[1],
    );
    expect(named.filter((version) => !pins.has(version))).toEqual([]);
  });
});

/**
 * Links into the four operator pages from anywhere under app/docs.
 *
 * The README, the .env.example, the config page and the self-hosting page all
 * point at anchors on each other (#network-egress, #key-rotation, #health,
 * #oauth-redirect-uris). An anchor that does not exist scrolls nowhere and says
 * nothing, so a rename on one page strands every link to it.
 */
describe("links into the operator pages land on a real anchor", () => {
  const TARGETS: Record<string, string> = {
    "/docs/self-hosting": "app/docs/self-hosting/page.tsx",
    "/docs/setup": "app/docs/setup/page.tsx",
    "/docs/config": "app/docs/config/page.tsx",
    "/docs/administration": "app/docs/administration/page.tsx",
  };

  function pageFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return pageFiles(p);
      return name === "page.tsx" ? [p.split("\\").join("/")] : [];
    });
  }

  const hasAnchor = (source: string, anchor: string) =>
    new RegExp(`\\bid(?:=|:\\s*)"${anchor}"`).test(source);

  it("resolves every /docs/<page>#anchor link to an id on that page", () => {
    const broken: string[] = [];
    for (const file of pageFiles("app/docs")) {
      const source = read(file);
      for (const m of source.matchAll(
        /(\/docs\/(?:self-hosting|setup|config|administration))#([a-z0-9-]+)/g,
      )) {
        const target = read(TARGETS[m[1]]);
        if (!hasAnchor(target, m[2])) broken.push(`${file} -> ${m[1]}#${m[2]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("resolves every in-page #anchor link to an id on the same page", () => {
    const broken: string[] = [];
    for (const [, file] of Object.entries(TARGETS)) {
      const source = read(file);
      for (const m of source.matchAll(/href="#([a-z0-9-]+)"/g)) {
        if (!hasAnchor(source, m[1])) broken.push(`${file} -> #${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("keeps the anchors the README and .env.example are told about", () => {
    const selfHosting = read(TARGETS["/docs/self-hosting"]);
    for (const anchor of [
      "network-egress",
      "key-rotation",
      "health",
      "in-app-updater",
      "stripe",
    ]) {
      expect(hasAnchor(selfHosting, anchor), `#${anchor}`).toBe(true);
    }
  });
});

/**
 * Network egress.
 *
 * The self-hosting page lists the hosts the server calls so an operator behind
 * a firewall knows what to open. A host added to the code and not to the page
 * is a rule they learn about from a feature that quietly stopped working, so
 * every host that code under these directories fetches has to be named there.
 * Only calls that are visible as a literal are found (fetch, the passive
 * subdomain fetcher, and *_URL or *Url constants): that is a floor, not a
 * proof, which is why the page's own rows were read off the code by hand.
 */
describe("the self-hosting page names every host the server fetches", () => {
  const EGRESS_DIRS = [
    "lib/scanner",
    "lib/browserbase",
    "lib/github",
    "lib/updater",
    "lib/discord",
    "lib/auth",
    "app/api",
  ];
  /** Page-check detectors hold sample strings for what the scanner looks for in
   *  a target, not calls this server makes. */
  const SKIP = ["page-checks", "node_modules"];
  const EXTRA_FILES = ["lib/config/constants.ts"];

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (SKIP.includes(name)) return [];
      if (statSync(p).isDirectory()) return sources(p);
      return /\.(ts|mjs)$/.test(name) ? [p.split("\\").join("/")] : [];
    });
  }

  /** Matches the patterns below but is not a call this server makes: a URL
   *  stored in users.avatar_url for the visitor's browser to load. */
  const NOT_SERVER_CALLS = new Set(["cdn.discordapp.com"]);

  const hostsCalled = new Map<string, string>();
  for (const file of [...EGRESS_DIRS.flatMap(sources), ...EXTRA_FILES]) {
    const text = read(file);
    const patterns = [
      /\b(?:fetch|fetchPassiveSource)\(\s*[`"']https?:\/\/([a-z0-9.-]+)/g,
      /\b[A-Za-z][A-Za-z0-9_]*(?:_URL|_ENDPOINT|_BASE|Url)\s*=\s*[`"']https?:\/\/([a-z0-9.-]+)/g,
    ];
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        // A trailing dot is a host built from the scan target at run time
        // (mta-sts.<domain>), which no list can name.
        if (m[1].endsWith(".") || NOT_SERVER_CALLS.has(m[1])) continue;
        if (!hostsCalled.has(m[1])) hostsCalled.set(m[1], file);
      }
    }
  }

  const page = read("app/docs/self-hosting/page.tsx");

  it("finds the calls it is meant to check", () => {
    expect(hostsCalled.size).toBeGreaterThan(15);
    expect(hostsCalled.has("api.osv.dev")).toBe(true);
    expect(hostsCalled.has("www.gravatar.com")).toBe(true);
  });

  it("lists each one in the Network egress section", () => {
    const missing = [...hostsCalled.entries()]
      .filter(([host]) => !page.includes(host))
      .map(([host, file]) => `${host} (${file})`);
    expect(
      missing,
      "these hosts are fetched by the server but are not named in " +
        "app/docs/self-hosting/page.tsx, so an operator filtering egress " +
        "does not know to allow them",
    ).toEqual([]);
  });
});

/**
 * The health endpoint's statuses, as documented.
 */
describe("the health check the operator pages describe", () => {
  const route = read("app/api/v3/health/route.ts");
  const selfHosting = read("app/docs/self-hosting/page.tsx");

  it("documents every status the route can return", () => {
    for (const status of ["ok", "degraded", "unhealthy"]) {
      expect(route, `route returns ${status}`).toContain(`"${status}"`);
      expect(selfHosting, `page documents ${status}`).toContain(
        `status: "${status}"`,
      );
    }
  });

  it("documents the fields the response carries", () => {
    for (const field of [
      "uptime_s",
      "latency_ms",
      "schema_version",
      "schema_required",
      "schema_ok",
      "missing_tables",
    ]) {
      expect(route, `route has ${field}`).toContain(field);
      expect(selfHosting, `page shows ${field}`).toContain(field);
    }
  });
});

/**
 * Redirect URIs.
 *
 * These are registered in consoles the app does not control, so the table on
 * /docs/config is a promise that a route answers at exactly that path. Each is
 * checked against the file that serves it, with the dynamic [provider] segment
 * substituted for the three sign-in providers.
 */
describe("the OAuth redirect URIs the config page lists are served", () => {
  const config = read("app/docs/config/page.tsx");
  const uris = [
    ...new Set(
      [...config.matchAll(/"(\/api\/v3\/auth\/[a-z/-]+\/callback)"/g)].map(
        (m) => m[1],
      ),
    ),
  ];

  it("lists the five flows", () => {
    expect(uris.sort()).toEqual([
      "/api/v3/auth/discord/callback",
      "/api/v3/auth/oauth/discord/callback",
      "/api/v3/auth/oauth/github/callback",
      "/api/v3/auth/oauth/google/callback",
      "/api/v3/auth/staff-oidc/callback",
    ]);
  });

  it.each(uris)("has a route for %s", (uri) => {
    const direct = `app${uri}/route.ts`;
    const viaProvider = `app${uri.replace(
      /\/oauth\/(google|github|discord)\//,
      "/oauth/[provider]/",
    )}/route.ts`;
    expect(
      existsSync(direct) || existsSync(viaProvider),
      `${uri} is documented as a registered redirect URI but neither ` +
        `${direct} nor ${viaProvider} exists`,
    ).toBe(true);
  });

  it("tells the reader the callback paths do not move", () => {
    expect(config).toContain("These paths do not move");
  });
});

/**
 * The first account is already super_admin.
 *
 * The config page's checklist told the reader to run
 * UPDATE users SET role = 'admin' for "the first user", which demotes it, and
 * the self-hosting page spends a warning saying exactly that. Any page that
 * shows the statement has to be addressing a later account.
 */
describe("no operator page promotes the first account with SQL", () => {
  for (const path of [
    "app/docs/self-hosting/page.tsx",
    "app/docs/setup/page.tsx",
    "app/docs/config/page.tsx",
    "app/docs/administration/page.tsx",
  ]) {
    it(`${path} only shows the admin UPDATE for a later account`, () => {
      const source = read(path);
      for (const m of source.matchAll(
        /UPDATE users\s+SET role = (?:'|&apos;)admin/g,
      )) {
        const at = m.index ?? 0;
        const around = source.slice(Math.max(0, at - 800), at + 800);
        expect(
          around,
          `${path} shows the admin UPDATE with nothing nearby saying it is ` +
            `for a later account`,
        ).toMatch(/later/i);
      }
    });
  }
});

describe("the admin tab descriptions", () => {
  it("cover every admin tab, and only those", () => {
    expect(Object.keys(ADMIN_TAB_DESCRIPTIONS).sort()).toEqual(
      [...VALID_TABS].sort(),
    );
  });

  it("are a sentence each, not an empty cell or a paragraph", () => {
    for (const [tab, text] of Object.entries(ADMIN_TAB_DESCRIPTIONS)) {
      expect(text.trim().length, tab).toBeGreaterThan(40);
      expect(text.length, tab).toBeLessThan(400);
    }
  });
});

/**
 * House copy rules, for the pages and files this cluster rewrote: no em dash,
 * en dash or middle dot in user-facing text.
 */
describe("operator copy avoids dash punctuation", () => {
  const banned = new RegExp(`[${String.fromCharCode(0x2014, 0x2013, 0xb7)}]`);
  for (const path of [
    "app/docs/self-hosting/page.tsx",
    "app/docs/setup/page.tsx",
    "app/docs/config/page.tsx",
    "app/docs/config/layout.tsx",
    "app/docs/administration/page.tsx",
    "app/docs/administration/admin-tab-descriptions.ts",
    ".env.example",
    "lib/updater/environment.ts",
  ]) {
    it(`${path} has none`, () => {
      expect(read(path)).not.toMatch(banned);
    });
  }
});
