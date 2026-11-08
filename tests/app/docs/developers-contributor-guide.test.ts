import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * A contributor following this page used to reach `npm run dev` with no
 * database and no idea what to put in DATABASE_URL, and the pre-push step named
 * two of the checks that fail a PR while CI ran seven jobs.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const page = read("app/docs/developers/page.tsx");
const ci = read(".github/workflows/ci.yml");
const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("Quick Start", () => {
  const start = page.indexOf('id="quick-start"');
  const section = page.slice(start, page.indexOf("</DocsSection>", start));

  it("starts a database the DATABASE_URL it sets can reach", () => {
    const url = section.match(
      /DATABASE_URL=postgresql:\/\/(\w+):(\w+)@localhost:5432\/(\w+)/,
    );
    expect(url, "the DATABASE_URL line").toBeTruthy();
    const [, user, password, db] = url!;
    const run = section.match(/docker run [^\n]*postgres:16-alpine/)?.[0] ?? "";
    expect(run).toContain(`POSTGRES_USER=${user}`);
    expect(run).toContain(`POSTGRES_PASSWORD=${password}`);
    expect(run).toContain(`POSTGRES_DB=${db}`);
    expect(run).toContain("5432:5432");
  });

  it("uses the Postgres major the dev compose file runs", () => {
    const composeMajor = read("docker-compose.dev.yml").match(
      /image: postgres:(\d+)\./,
    )?.[1];
    expect(section).toContain(`postgres:${composeMajor}-alpine`);
  });

  it("sets the four values, with a key the shell actually generates", () => {
    expect(section).toContain("DATABASE_SSL=false");
    expect(section).toContain("NEXT_PUBLIC_APP_URL=http://localhost:3000");
    // A .env file does not run $(...), so this line only works inside the
    // unquoted heredoc that the shell expands.
    const heredoc = section.match(/cat >> \.env <<EOF\n([\s\S]*?)\nEOF/)?.[1];
    expect(heredoc).toContain("API_KEY_ENCRYPTION_KEY=$(openssl rand -hex 32)");
  });

  it("names the dev compose file, which exists", () => {
    expect(section).toContain(
      "docker compose -f docker-compose.dev.yml up -d --build",
    );
    expect(existsSync(path.join(ROOT, "docker-compose.dev.yml"))).toBe(true);
  });

  it("does not write a real-looking address in the SQL sample", () => {
    expect(section).toContain("WHERE email = '<your-email>'");
    expect(section).not.toContain("example.com");
  });
});

describe("Tests subsection", () => {
  it("quotes the two integration commands from tests/README.md", () => {
    const readme = read("tests/README.md");
    const block = readme.match(/own database:\n\n```bash\n([\s\S]*?)```/)?.[1];
    expect(block, "the integration block in tests/README.md").toBeTruthy();
    // tests/README.md wraps each command with a trailing backslash.
    const commands = block!
      .replace(/\\\n\s*/g, "")
      .split("\n\n")
      .map((c) => flat(c).trim());
    expect(commands).toHaveLength(2);
    const compact = flat(page);
    for (const command of commands) expect(compact).toContain(command);
  });

  it("states the unit tier needs no database and links the guide", () => {
    expect(page).toContain('<DocsSubSection id="tests" title="Tests">');
    expect(flat(page)).toMatch(/needs no database/);
    expect(page).toContain("/blob/main/tests/README.md");
  });
});

describe("Pull Request Process", () => {
  const start = page.indexOf('id="pull-requests"');
  const section = page.slice(start, page.indexOf("</DocsSection>", start));

  it("lists the pre-push checks as one chain of real scripts", () => {
    const chain = section
      .match(/npm run format:check[\s\S]*?check-stats\.generated\.ts/)?.[0]
      .replace(/\s*&&\s*/g, " && ");
    expect(chain).toContain(
      "npm run format:check && npm run lint && npm run typecheck && npm run test:coverage && npm run build:knowledge && git diff",
    );
    for (const script of [
      "format:check",
      "lint",
      "typecheck",
      "test:coverage",
      "build:knowledge",
    ]) {
      expect(pkg.scripts[script], script).toBeDefined();
    }
  });

  it("uses the diff CI uses, not a stricter one that always fails", () => {
    const fromCi = ci.match(/git diff --exit-code [^\n]+/)?.[0];
    expect(fromCi, "the diff line in ci.yml").toBeTruthy();
    expect(section).toContain(fromCi);
  });

  it("names the jobs CI adds, each one a real job", () => {
    const line = flat(section).match(/CI additionally runs: ([^.]+)\./)?.[1];
    const names = (line ?? "")
      .split(",")
      .map((n) => n.replace(/\(.*\)/, "").trim());
    expect(names).toEqual([
      "Integration",
      "Extension",
      "Build",
      "Self-host smoke test",
    ]);
    for (const name of names) expect(ci).toContain(`name: ${name}\n`);
  });

  it("no longer offers the short list", () => {
    expect(section).not.toContain("<InlineCode>npm test</InlineCode>");
  });
});

describe("the maintenance commands", () => {
  it("drops the avatar migration the boot backfill replaced", () => {
    expect(page).not.toContain("db:migrate-avatars");
  });
});

describe("the section ids other pages link to", () => {
  it("keeps every one", () => {
    for (const id of [
      "quick-start",
      "scripts",
      "linting",
      "typecheck",
      "commits",
      "pull-requests",
      "structure",
      "pitfalls",
      "debugging",
      "contributing",
    ]) {
      expect(page, id).toContain(`id="${id}"`);
    }
  });
});
