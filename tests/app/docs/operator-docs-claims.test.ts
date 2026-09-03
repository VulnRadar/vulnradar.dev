import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

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
  // indent, which is what that file uses and what compose requires.
  const compose = read("docker-compose.yml");
  const servicesBlock =
    compose.match(/^services:\n([\s\S]*?)(?=^\S|\Z)/m)?.[1] ?? "";
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
