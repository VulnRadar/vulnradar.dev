import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * db:backup, db:migrate and db:restore have to see the same settings the app
 * does. They read only .env.local, and returned early whenever DATABASE_URL was
 * already set, while every install guide says to put settings in .env: a source
 * install could not find its database at all, and one with DATABASE_URL
 * exported lost BACKUP_ENCRYPTION_KEY and wrote an unencrypted backup.
 *
 * Each case runs in a child process because the env loader's state lives in the
 * process, and a script only ever starts with a clean one.
 */

const ENV_MODULE = pathToFileURL(
  resolve(import.meta.dirname, "../../../scripts/_lib/_lib.env.mjs"),
).href;

/** A child with nothing inherited; Windows needs SystemRoot to start one. */
function childEnv(extra: Record<string, string> = {}) {
  return {
    SystemRoot: process.env.SystemRoot ?? "",
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vr-env-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Outcome {
  loaded: boolean;
  env: Record<string, string | undefined>;
}

async function load(
  files: Record<string, string>,
  shell: Record<string, string> = {},
  body = "",
): Promise<Outcome> {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content);
  }
  const script = `
    import { loadEnv } from ${JSON.stringify(ENV_MODULE)};
    const loaded = loadEnv({ root: ${JSON.stringify(root)} });
    ${body}
    process.stdout.write(JSON.stringify({ loaded, env: process.env }));
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      encoding: "utf8",
      env: childEnv(shell),
    },
  );
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as Outcome;
}

describe("loadEnv", () => {
  it("reads .env when it is the only file", async () => {
    const { loaded, env } = await load({
      ".env": "DATABASE_URL=postgresql://a/b\nDATABASE_SSL=true\n",
    });
    expect(loaded).toBe(true);
    expect(env.DATABASE_URL).toBe("postgresql://a/b");
    expect(env.DATABASE_SSL).toBe("true");
  });

  it("still loads the other keys when DATABASE_URL is already set", async () => {
    const { env } = await load(
      { ".env.local": "BACKUP_ENCRYPTION_KEY=abc\n" },
      { DATABASE_URL: "postgresql://shell/db" },
    );
    expect(env.BACKUP_ENCRYPTION_KEY).toBe("abc");
    expect(env.DATABASE_URL).toBe("postgresql://shell/db");
  });

  it("prefers .env.local key by key and fills the rest from .env", async () => {
    const { env } = await load({
      ".env.local": "DATABASE_URL=postgresql://local/db\n",
      ".env": "DATABASE_URL=postgresql://env/db\nDATABASE_SSL=true\n",
    });
    expect(env.DATABASE_URL).toBe("postgresql://local/db");
    expect(env.DATABASE_SSL).toBe("true");
  });

  it("lets the shell win over both files, even with an empty value", async () => {
    const { env } = await load(
      { ".env.local": "A=local\nB=local\n", ".env": "A=env\nB=env\n" },
      { A: "shell", B: "" },
    );
    expect(env.A).toBe("shell");
    expect(env.B).toBe("");
  });

  it("does not expand or shorten a shell value that a file also sets", async () => {
    // Next's expansion rewrites process.env for every key a file names, shell
    // values included, so `ab$cd` came back as `ab`: a backup encrypted under
    // a key nobody typed.
    const shell = {
      BACKUP_ENCRYPTION_KEY: "ab$cd",
      DATABASE_URL: "postgresql://u:pa$sword@shell/db",
    };
    const { env } = await load(
      {
        ".env.local": "BACKUP_ENCRYPTION_KEY=local\n",
        ".env": "BACKUP_ENCRYPTION_KEY=env\nDATABASE_URL=postgresql://env/db\n",
      },
      shell,
    );
    expect(env.BACKUP_ENCRYPTION_KEY).toBe(shell.BACKUP_ENCRYPTION_KEY);
    expect(env.DATABASE_URL).toBe(shell.DATABASE_URL);
  });

  it("returns false and throws nothing when neither file exists", async () => {
    const { loaded, env } = await load({});
    expect(loaded).toBe(false);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("does not undo a database a script picked when called a second time", async () => {
    const { env } = await load(
      { ".env": "DATABASE_URL=postgresql://env/db\n" },
      {},
      `process.env.DATABASE_URL = "postgresql://env/picked"; loadEnv({ root: ${JSON.stringify(root)} });`,
    );
    expect(env.DATABASE_URL).toBe("postgresql://env/picked");
  });
});

describe("parsing follows the app's rules", () => {
  it("turns \\n in a double-quoted value into a newline, which a PEM CA needs", async () => {
    const { env } = await load({
      ".env": 'DATABASE_SSL_CA="-----BEGIN-----\\nabc\\n-----END-----"\n',
    });
    expect(env.DATABASE_SSL_CA).toBe("-----BEGIN-----\nabc\n-----END-----");
  });

  it("keeps \\n literal in a single-quoted value", async () => {
    const { env } = await load({ ".env": "A='x\\ny'\n" });
    expect(env.A).toBe("x\\ny");
  });

  it("accepts a real multi-line quoted value", async () => {
    const { env } = await load({ ".env": 'A="one\ntwo"\nB=three\n' });
    expect(env.A).toBe("one\ntwo");
    expect(env.B).toBe("three");
  });

  it("handles an export prefix and an inline comment", async () => {
    const { env } = await load({ ".env": "export A=one # note\n" });
    expect(env.A).toBe("one");
  });

  it("expands $VAR the way Next does, and honours an escaped dollar", async () => {
    const { env } = await load({
      ".env": "HOST=db.test\nURL=postgresql://$HOST/x\nPW=a\\$b\n",
    });
    expect(env.URL).toBe("postgresql://db.test/x");
    expect(env.PW).toBe("a$b");
  });

  it("gives the same result as Next's own loader for the same files", async () => {
    const files = {
      ".env.local": 'A="local\\nline"\nC=$A-c\n',
      ".env": "A=env\nB=two # c\nexport D='four'\n",
    };
    const ours = await load(files, { NODE_ENV: "production" });
    const script = `
      import next from "@next/env";
      const { parsedEnv } = next.loadEnvConfig(${JSON.stringify(root)}, false, { info() {}, error() {} });
      process.stdout.write(JSON.stringify(parsedEnv));
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        cwd: resolve(import.meta.dirname, "../../.."),
        env: childEnv({ NODE_ENV: "production" }),
      },
    );
    const theirs = JSON.parse(result.stdout) as Record<string, string>;
    expect(Object.keys(theirs).sort()).toEqual(["A", "B", "C", "D"]);
    for (const [key, value] of Object.entries(theirs)) {
      expect(ours.env[key]).toBe(value);
    }
  });
});

describe("requireDatabaseUrl", () => {
  it("exits non-zero and names both files in the order they are read", () => {
    const script = `
      import { requireDatabaseUrl } from ${JSON.stringify(ENV_MODULE)};
      requireDatabaseUrl();
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8", env: childEnv() },
    );
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/\.env\.local.*\.env\b/);
  });
});
