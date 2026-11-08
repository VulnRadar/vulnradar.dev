import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * The commands and claims on /docs/setup, checked against what they describe.
 * Reads the source for the same reason operator-docs-claims.test.ts does: the
 * point is the literal a reader will copy.
 */

const read = (file: string) =>
  readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const page = read("app/docs/setup/page.tsx");
const flat = page
  .replace(/\{" "\}/g, " ")
  .replace(/\s+/g, " ")
  .replace(/&rsquo;/g, "'");

function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  expect(start, `marker "${from}"`).toBeGreaterThan(-1);
  expect(end, `marker "${to}"`).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("database setup", () => {
  const database = between(page, 'id="database"', 'id="environment"');

  it("uses one user name in the SQL and in DATABASE_URL", () => {
    expect(database).toContain("CREATE USER vulnradar WITH PASSWORD");
    expect(database).toContain("CREATE DATABASE vulnradar OWNER vulnradar;");
    expect(page).toContain(
      "DATABASE_URL=postgresql://vulnradar:your-password@localhost:5432/vulnradar",
    );
    expect(page).not.toContain("vulnradar_user");
  });

  it("keeps the shell line out of the SQL block", () => {
    expect(database).toContain('code="psql -U postgres" language="bash"');
    expect(database).not.toMatch(/`psql -U postgres/);
  });

  it("has a troubleshooting entry for a rejected password", () => {
    const troubleshooting = between(
      page,
      'id="troubleshooting"',
      'id="deployment"',
    );
    expect(troubleshooting).toContain(
      'password authentication failed for user "vulnradar"',
    );
  });
});

describe("running without TLS", () => {
  it("puts the callout straight after the Production card", () => {
    const running = between(page, 'id="running"', 'id="verification"');
    expect(running.indexOf(">Production<")).toBeGreaterThan(-1);
    expect(running.indexOf('title="No TLS yet?"')).toBeGreaterThan(
      running.indexOf(">Production<"),
    );
    expect(running).toContain("ALLOW_INSECURE_HTTP=1");
  });

  it("sets the switch the middleware reads in the local .env", () => {
    expect(read("middleware.ts")).toContain("process.env.ALLOW_INSECURE_HTTP");
    expect(between(page, 'id="environment"', 'id="config"')).toMatch(
      /^ALLOW_INSECURE_HTTP=1$/m,
    );
  });
});

describe("verification", () => {
  const verification = between(page, 'id="verification"', 'id="health"');

  it("targets the instance being verified, not the hosted one", () => {
    expect(verification).toContain("http://localhost:3000/api/v3/scan");
    expect(verification).toContain("or your NEXT_PUBLIC_APP_URL");
    expect(verification).not.toContain("${APP_URL}");
  });

  it("uses the labels the API keys screen really has", () => {
    const flatStep = verification.replace(/\s+/g, " ");
    expect(flatStep).toContain('<DocsUiPath to="profile.developer.apiKeys" />');
    expect(flatStep).toContain("Create key");
    expect(flatStep).toContain("The key is shown once.");
    expect(read("components/profile/tabs/profile-developer-tab.tsx")).toContain(
      'label: "API Keys"',
    );
    expect(
      read("components/profile/tabs/developer/api-keys-section.tsx"),
    ).toContain('"Create key"');
  });

  it("names the scopes a new key starts with", () => {
    const defaults = between(
      read("lib/config/client-constants.ts"),
      "DEFAULT_NEW_KEY_SCOPES",
      "];",
    );
    expect(defaults).toContain("API_KEY_SCOPES.SCAN_WRITE");
    expect(defaults).toContain("API_KEY_SCOPES.SCAN_READ");
    expect(defaults).not.toContain("SCAN_DELETE");
    expect(verification.replace(/\s+/g, " ")).toContain(
      "keep the scan scopes ticked",
    );
  });

  it("polls the route that exists and states the finished status", () => {
    expect(existsSync("app/api/v3/scan/status/[id]/route.ts")).toBe(true);
    expect(verification).toContain(
      'curl "http://localhost:3000/api/v3/scan/status/SCAN_ID"',
    );
    expect(verification).toContain("status: completed");
  });
});

describe("deployment options", () => {
  const deployment = between(page, 'id="deployment"', 'id="docker"');

  it("has no Vercel card anywhere on the page", () => {
    expect(page).not.toContain("Vercel");
  });

  it("opens with the plain serverless warning and links self-hosting", () => {
    const opening = deployment.slice(0, deployment.indexOf("<Card"));
    const text = opening.replace(/\{" "\}/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Serverless hosts are not supported.");
    expect(text).toContain(
      "Background workers and detached scans never run there.",
    );
    expect(text).toContain("PM2 or systemd");
    expect(opening).toContain('href="/docs/self-hosting"');
  });

  it("gives a real systemd unit", () => {
    expect(deployment).toContain(
      'filename="/etc/systemd/system/vulnradar.service"',
    );
    for (const line of [
      "User=",
      "WorkingDirectory=",
      "Environment=NODE_ENV=production",
      "Environment=PORT=3000",
      "ExecStart=/usr/bin/npm start",
      "Restart=on-failure",
    ]) {
      expect(deployment, line).toContain(line);
    }
    expect(deployment).toContain("sudo systemctl enable --now vulnradar");
  });

  it("gives the PM2 line for a script that exists", () => {
    expect(deployment).toContain("pm2 start npm --name vulnradar -- start");
    expect(JSON.parse(read("package.json")).scripts.start).toBeDefined();
  });
});

describe("the Docker section", () => {
  const docker = between(page, 'id="docker"', 'id="migration"');

  it("is only the pointer", () => {
    const text = docker.replace(/\{" "\}/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Deploying with Docker? Follow");
    expect(text).toContain(", which is the supported path.");
    expect(docker).toContain('href="/docs/self-hosting"');
    expect(docker).not.toContain("CodeBlock");
    expect(docker).not.toContain("<Card");
  });

  it("leaves no compose walkthrough behind elsewhere on the page", () => {
    expect(page).not.toContain("Step 3: Configure .env");
    expect(page).not.toContain("docker compose restart");
    expect(page).not.toContain('href="#docker"');
    expect(flat).not.toContain("See the Docker section below");
  });

  it("sends an upgrade to the one Upgrading section", () => {
    expect(page).toContain('href="/docs/self-hosting#updates"');
    expect(page).not.toContain("docker compose pull");
  });
});

describe("secrets", () => {
  it("generates them with openssl", () => {
    expect(page).toContain("openssl rand -hex 32");
    expect(page).not.toContain("randomBytes");
  });

  it("does not say restart after a .env edit without saying how", () => {
    expect(flat).not.toMatch(/into \.env, restart\./);
    expect(page).toContain("# Docker: docker compose up -d app");
  });
});

describe("anchors other pages depend on", () => {
  it.each([
    "prerequisites",
    "installation",
    "database",
    "environment",
    "config",
    "running",
    "verification",
    "health",
    "troubleshooting",
    "deployment",
    "docker",
    "migration",
    "version",
  ])("keeps #%s", (id) => {
    expect(page).toContain(`id="${id}"`);
  });
});
