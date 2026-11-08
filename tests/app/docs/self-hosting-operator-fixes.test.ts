import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The operator-facing claims on /docs/self-hosting, checked against the code
 * they describe.
 *
 * Every one of these was a command or a sentence that sent someone the wrong
 * way: a rollback that could not restore, a .env that locked out the first
 * admin, a restart that did not load the file just edited. They read fine, so
 * the only way to keep them right is to tie them to the source of the thing
 * they describe. Anything the page can render from a constant already is.
 */

const read = (file: string) =>
  readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const page = read("app/docs/self-hosting/page.tsx");

/** JSX wraps prose across lines and splits it with {" "}. */
const flat = page
  .replace(/\{" "\}/g, " ")
  .replace(/\s+/g, " ")
  .replace(/&rsquo;/g, "'");

/** The same, with the inline-code tags gone, for sentences that contain one. */
const prose = flat.replace(/<\/?InlineCode>/g, "").replace(/\s+/g, " ");

/** The text between two markers. Fails loudly rather than slicing to nothing. */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  expect(start, `marker "${from}"`).toBeGreaterThan(-1);
  expect(end, `marker "${to}"`).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("rolling back", () => {
  const rollback = between(page, 'title="Rolling back"', "Rehearse this");
  const bundled = rollback.slice(0, rollback.indexOf("On a managed database"));
  const managed = between(rollback, "On a managed database", "The migrator");

  it("stops the app, restores with --replace, then goes back to the code", () => {
    const stop = bundled.indexOf("docker compose stop app");
    const restore = bundled.indexOf("npm run db:restore");
    const code = bundled.lastIndexOf("git checkout <previous-tag>");
    expect(stop).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(stop);
    expect(code).toBeGreaterThan(restore);
    expect(bundled).toContain("--replace --yes");
  });

  it("does not describe --force as a way to replace a database", () => {
    expect(page).not.toMatch(/db:restore[^`]*--force/);
    expect(rollback).not.toContain("--force");
  });

  it("drops and recreates the database only for a managed database", () => {
    expect(bundled).not.toContain("DROP DATABASE");
    expect(managed.replace(/\s+/g, " ")).toContain("DROP DATABASE vulnradar");
    expect(managed.replace(/\s+/g, " ")).toContain(
      "CREATE DATABASE vulnradar OWNER vulnradar",
    );
    expect(managed).toContain("DATABASE_URL");
    expect(managed).not.toContain("--replace");
  });

  it("stops the app before the managed database is dropped", () => {
    const stop = managed.indexOf("docker compose stop app");
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(managed.indexOf("DROP DATABASE"));
  });
});

describe("backups", () => {
  it("says the offsite URL takes one object with the IV and tag inside it", () => {
    const row = between(
      page,
      'name: "BACKUP_OFFSITE_UPLOAD_URL"',
      'title="Use a persistent volume"',
    );
    expect(row).toContain("exactly one object");
    expect(row).toContain("IV and auth tag inside it");
  });

  it("names the sidecar only as the older format", () => {
    const callout = between(page, 'title="Encryption and restore"', "Rehearse");
    expect(callout.replace(/\s+/g, " ")).toContain("from before that format");
  });
});

describe("SMTP in the .env example", () => {
  const env = between(page, 'id="env"', 'id="ai"');

  it("leaves every SMTP line commented out", () => {
    for (const name of [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASS",
      "SMTP_FROM",
    ]) {
      expect(env, name).toContain(`# ${name}=`);
      expect(env, name).not.toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("leaves the other optional keys commented out too", () => {
    // TURNSTILE_ENABLED is true for any non-empty site key, so a copied
    // placeholder refuses every sign-up, the first admin's included.
    expect(read("lib/config/client-constants.ts")).toContain(
      "TURNSTILE_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    );
    for (const name of [
      "DISCORD_CLIENT_ID",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]) {
      expect(env, name).toContain(`# ${name}=`);
      expect(env, name).not.toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("explains the lock-out, which is what the signup code does", () => {
    expect(env).toContain('title="SMTP on/off changes sign-up"');
    expect(read("lib/auth/auth.ts")).toContain(
      "const autoVerify = !isEmailConfigured();",
    );
  });

  it("has a recovery row quoting the message login really sends", () => {
    expect(read("app/api/v3/auth/login/route.ts")).toContain(
      "Please verify your email",
    );
    expect(page).toContain(
      'symptom: "Cannot log in: Please verify your email"',
    );
    expect(page).toContain(
      "UPDATE users SET email_verified_at = NOW() WHERE email = '<your-email>'",
    );
  });
});

describe("running without TLS", () => {
  const env = between(page, 'id="env"', 'id="ai"');

  it("offers the switch the middleware reads, commented out", () => {
    expect(read("middleware.ts")).toContain("process.env.ALLOW_INSECURE_HTTP");
    expect(env).toContain("# ALLOW_INSECURE_HTTP=1  # only for a trusted LAN");
    expect(env).not.toMatch(/^ALLOW_INSECURE_HTTP=/m);
    expect(env).toContain('title="No TLS yet?"');
  });

  it("names the bind address compose defaults to", () => {
    expect(read("docker-compose.yml")).toContain("${HOST_BIND:-127.0.0.1}:");
    expect(env).toContain("HOST_BIND=0.0.0.0");
  });

  it("puts HTTPS required before the file it applies to", () => {
    expect(env.indexOf('title="HTTPS required"')).toBeGreaterThan(-1);
    expect(env.indexOf('title="HTTPS required"')).toBeLessThan(
      env.indexOf("cp .env.example .env"),
    );
  });
});

describe("the nginx block", () => {
  const tls = between(page, 'id="tls"', 'id="stripe"');

  it.each([
    "proxy_pass http://127.0.0.1:3000;",
    "proxy_set_header Host $host;",
    "proxy_set_header X-Real-IP $remote_addr;",
    "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "proxy_set_header X-Forwarded-Proto $scheme;",
  ])("sets %s", (line) => {
    expect(tls).toContain(line);
  });

  it("comes after the Caddyfile and replaces the external link", () => {
    expect(tls.indexOf("reverse_proxy localhost:3000")).toBeLessThan(
      tls.indexOf("proxy_pass"),
    );
    expect(tls).not.toContain("nextjs.org/docs");
  });

  it.each(["Host", "X-Real-IP", "X-Forwarded-For", "X-Forwarded-Proto"])(
    "says what %s is for",
    (header) => {
      expect(tls).toContain(`<InlineCode>${header}</InlineCode>:`);
    },
  );

  it("describes headers the app really reads", () => {
    const utils = read("lib/api/request-utils.ts");
    expect(utils).toContain('h.get("x-forwarded-for")');
    expect(utils).toContain('h.get("x-real-ip")');
    expect(read("middleware.ts")).toContain('.get("x-forwarded-proto")');
  });
});

describe("the Upgrading section", () => {
  const updates = between(page, 'id="updates"', 'id="in-app-updater"');

  it("keeps the anchor and has one tab for each install type", () => {
    expect(updates).toContain('title="Upgrading"');
    expect(updates).toContain('label: "Image"');
    expect(updates).toContain('label: "Source"');
  });

  it("gives the image install the five real steps", () => {
    const image = between(updates, 'id: "image"', 'id: "source"');
    const order = [
      "npm run db:backup",
      "image: ghcr.io/vulnradar/vulnradar:v<new>",
      "docker compose pull app",
      "npm run db:migrate:dry-run",
      "docker compose run --rm app npm run db:migrate\n",
      "docker compose up -d",
    ].map((step) => image.indexOf(step));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("names the image docker-compose.yml actually pulls", () => {
    expect(read("docker-compose.yml")).toMatch(
      /image: ghcr\.io\/vulnradar\/vulnradar:v/,
    );
  });

  it("moves a checkout to the release tag and never to main", () => {
    expect(updates).toContain("git fetch --tags && git rebase v<new>");
    expect(updates).not.toContain("git pull");
    expect(flat).toContain("git switch -c local-config v${APP_VERSION}");
    expect(flat).toContain("git add lib/config/config-values.ts");
  });

  it("says the updater is off in the published image", () => {
    expect(read("Dockerfile")).toContain("ENV VULNRADAR_UPDATER_DISABLED=true");
    expect(updates).toContain("VULNRADAR_UPDATER_DISABLED");
  });
});

describe("the troubleshooting table", () => {
  const rows = between(
    page,
    "const TROUBLESHOOTING_ROWS",
    "function TroubleshootingTable",
  );
  const each = rows.split("symptom:").slice(1);

  it("leads with the restart-after-schema-lines row", () => {
    expect(each[0]).toContain("Container restarts after Schema version lines");
    expect(each[0]).toContain("DATABASE_URL or DATABASE_SSL wrong");
    expect(each[0]).toContain("docker compose logs postgres");
  });

  it("no longer suggests editing the required schema version", () => {
    expect(rows).not.toContain("CONFIG_MIN_SCHEMA_VERSION");
    expect(page).not.toContain("upgrade CONFIG_MIN_SCHEMA_VERSION");
  });

  it.each(["Too many redirects", "Everyone is rate limited together"])(
    "has a row for %s",
    (symptom) => {
      expect(rows).toContain(`symptom: "${symptom}"`);
    },
  );

  it("links each row to the section that fixes it, and that section exists", () => {
    expect(each.length).toBeGreaterThanOrEqual(10);
    for (const row of each) {
      const anchors = [...row.matchAll(/anchor="([a-z-]+)"/g)].map((m) => m[1]);
      expect(anchors.length, row.slice(0, 60)).toBeGreaterThan(0);
      for (const anchor of anchors) {
        expect(page, anchor).toContain(`id="${anchor}"`);
      }
    }
  });
});

describe("secrets and hosts", () => {
  it("generates every secret with openssl", () => {
    expect(page).toContain("openssl rand -hex 32");
    expect(page).not.toContain("randomBytes");
  });

  it("asks for git or curl, not Node, on the host", () => {
    const prerequisites = between(flat, 'id="prerequisites"', 'id="clone"');
    expect(prerequisites).toContain("git for your own build, or curl");
    expect(prerequisites).not.toContain("Node.js");
  });

  it("says how to protect .env and drops the Docker secrets advice", () => {
    expect(prose).toContain(
      "Lock the file down (chmod 600 .env, outside any web root); the app reads plain environment variables only.",
    );
    expect(page).not.toContain("Docker secrets");
  });

  it("quotes the limits docker-compose.yml sets", () => {
    const compose = read("docker-compose.yml");
    const limits = (service: string, next: string) =>
      between(compose, `  ${service}:\n`, next).match(
        /memory: (\S+)\s+cpus: "(\d+)\.0"/,
      );
    const postgres = limits("postgres", "  app:\n");
    const app = limits("app", "volumes:\n  postgres_data");
    expect(postgres).not.toBeNull();
    expect(app).not.toBeNull();
    expect(prose).toContain(
      `the app at ${app?.[1]} of memory and ${app?.[2]} CPUs, Postgres at ${postgres?.[1]} and ${postgres?.[2]} CPU`,
    );
  });
});

describe("prebuilt image or your own build", () => {
  const section = between(flat, 'id="image-or-build"', 'id="hardware"');

  it("states the baked-in URL and what a NEXT_PUBLIC value costs", () => {
    expect(section).toContain("only if you accept the upstream URL baked");
    expect(section).toContain("docker compose up -d --build");
  });

  it("describes what the publish workflow really bakes in", () => {
    const workflow = read(".github/workflows/docker-publish.yml");
    expect(workflow).toContain("NEXT_PUBLIC_APP_URL=");
    expect(workflow).not.toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY=");
    expect(workflow).not.toContain("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=");
  });

  it("takes the compose file from a release tag", () => {
    expect(section).toContain("/v${APP_VERSION}/docker-compose.yml");
    expect(section).toContain("/v${APP_VERSION}/.env.example");
  });
});

describe("applying a .env change", () => {
  it("explains why restart is not enough", () => {
    expect(prose).toContain(
      "restart reuses the container's old environment; up -d recreates it with the new .env",
    );
  });

  it("never tells anyone to restart after a .env edit", () => {
    expect(/\.env,? and restart/i.test(prose)).toBe(false);
    expect(page.includes("Re-copy from Stripe dashboard, restart app")).toBe(
      false,
    );
  });

  it("only names docker compose restart beside a warning", () => {
    for (const m of prose.matchAll(/docker compose restart app/g)) {
      const around = prose.slice(
        Math.max(0, (m.index ?? 0) - 200),
        (m.index ?? 0) + 200,
      );
      expect(around).toContain("does not reload .env");
    }
  });
});

describe("anchors other pages depend on", () => {
  it.each([
    "overview",
    "hardware",
    "prerequisites",
    "clone",
    "env",
    "ai",
    "docker",
    "start",
    "health",
    "admin",
    "tls",
    "stripe",
    "backups",
    "key-rotation",
    "updates",
    "in-app-updater",
    "network-egress",
    "renaming",
    "troubleshooting",
    "security",
  ])("keeps #%s", (id) => {
    expect(page).toContain(`id="${id}"`);
  });
});
