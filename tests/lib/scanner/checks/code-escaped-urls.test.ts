import { describe, it, expect } from "vitest";
import { detectors } from "@/lib/scanner/checks/code";

/**
 * A URL that reaches the page inside a JSON blob or a JS string often has its
 * slashes written as \/ (WordPress settings, json_encode, some bundlers). The
 * secret tier read the raw text, so https:\/\/discord.com\/api\/webhooks\/...
 * was a leaked webhook nobody reported, while urlRefs had read that spelling
 * as plain slashes for a long time.
 *
 * Every value is assembled at runtime: push protection rejects a
 * credential-shaped literal even when it is a made-up fixture.
 */

const escapeSlashes = (s: string) => s.replace(/\//g, "\\/");

const DISCORD = [
  "https:",
  "",
  "discord.com",
  "api",
  "webhooks",
  "123456789012345678",
  "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT1uV2wX3yZ4aB5cD6eF7gH8iJ9kL1mN2oP3qR4s",
].join("/");
const SLACK = [
  "https:",
  "",
  "hooks.slack.com",
  "services",
  "T0AB1CD2EF",
  "B0GH3IJ4KL",
  "aB1cD2eF3gH4iJ5kL6mN7oP8",
].join("/");
const POSTGRES = [
  "postgres:",
  "",
  "admin:s3cretPassw0rd@db.acme.io:5432",
  "app",
].join("/");
const SENTRY = [
  "https:",
  "",
  `${"3f2a9c1d7e4b8a65".repeat(2)}@o123.ingest.sentry.io`,
  "4567",
].join("/");
const FIREBASE = "https://acme-prod.firebaseio.com";
const TWILIO_SID = `AC${"3f2a9c1d7e4b8a65".repeat(2)}`;

function run(id: string, body: string): string | null {
  return detectors[id]("https://example.com", new Headers(), body);
}

function inJson(value: string): string {
  return `<script>var settings = {"hook":"${value}"};</script>`;
}

const CASES = [
  ["Discord Webhook", "hardcoded-secrets-client-exposed", DISCORD],
  ["Slack Webhook", "hardcoded-secrets", SLACK],
  ["PostgreSQL URI", "hardcoded-secrets", POSTGRES],
  ["Sentry DSN", "hardcoded-secrets-client-exposed", SENTRY],
  ["Firebase Database URL", "hardcoded-secrets-low-risk", FIREBASE],
] as const;

describe("URL-shaped secrets are read through JSON-escaped slashes", () => {
  it.each(CASES)("%s fires when written plainly", (name, id, value) => {
    expect(run(id, inJson(value))).toContain(name);
  });

  it.each(CASES)("%s fires when its slashes are escaped", (name, id, value) => {
    expect(run(id, inJson(escapeSlashes(value)))).toContain(name);
  });

  it.each(CASES)(
    "%s reports the same excerpt either way, with no backslash in it",
    (_name, id, value) => {
      const escaped = run(id, inJson(escapeSlashes(value)));
      expect(escaped).toBe(run(id, inJson(value)));
      expect(escaped).not.toContain("\\");
    },
  );

  it("counts one secret once when a page carries both spellings", () => {
    const out = run(
      "hardcoded-secrets-client-exposed",
      inJson(DISCORD) + inJson(escapeSlashes(DISCORD)),
    );
    expect(out?.match(/Discord Webhook:/g)).toHaveLength(1);
  });

  it("reads a base64 secret that had a slash escaped", () => {
    const key = ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYzEXAMQLE"].join("/");
    const usable = key.replace("EXAMQLE", "ABCDEFG");
    expect(
      run(
        "code-cloud-aws-hardcoded-credentials",
        `<script>new S3({secretAccessKey:"${escapeSlashes(usable)}"})</script>`,
      ),
    ).not.toBeNull();
  });

  it("still judges the host of an escaped URL", () => {
    expect(
      run(
        "hardcoded-secrets-client-exposed",
        inJson(
          escapeSlashes(DISCORD.replace("discord.com", "evildiscord.com")),
        ),
      ),
    ).toBeNull();
    expect(
      run(
        "hardcoded-secrets",
        inJson(
          escapeSlashes(SLACK.replace("hooks.slack.com", "xhooks.slack.com")),
        ),
      ),
    ).toBeNull();
  });

  it("still drops a placeholder written with escaped slashes", () => {
    expect(
      run(
        "hardcoded-secrets",
        inJson(
          escapeSlashes(POSTGRES.replace("s3cretPassw0rd", "your_password")),
        ),
      ),
    ).toBeNull();
  });
});

describe("the judgements that need the body as served still get it", () => {
  it("treats an escaped value shown only in a code block as an example", () => {
    expect(
      run(
        "hardcoded-secrets-client-exposed",
        `<p>Config:</p><pre>{"hook":"${escapeSlashes(DISCORD)}"}</pre>`,
      ),
    ).toBeNull();
  });

  it("reports an escaped value that is also outside the code block", () => {
    expect(
      run(
        "hardcoded-secrets-client-exposed",
        `<pre>{"hook":"${escapeSlashes(DISCORD)}"}</pre>${inJson(escapeSlashes(DISCORD))}`,
      ),
    ).toContain("Discord Webhook");
  });

  // Both of these go wrong if the nearby window is cut with an index from the
  // normalised text: every escape ahead of the match shifts it by one.
  const PADDING = '"a\\/b",'.repeat(300);
  const sidLiteral = `"${TWILIO_SID}"`;

  it("finds a keyword that really is next to the match", () => {
    expect(
      run(
        "hardcoded-secrets",
        `<script>var p=[${PADDING}];var twilio=${sidLiteral};</script>`,
      ),
    ).toContain("Twilio Account SID");
  });

  it("does not count a keyword that is only near the shifted position", () => {
    expect(
      run(
        "hardcoded-secrets",
        `<script>var p=[${PADDING}];var twilio=1;/*${"x".repeat(300)}*/var a=${sidLiteral};</script>`,
      ),
    ).toBeNull();
  });
});

describe("regular expression source is not a leaked connection string", () => {
  // A JS regex literal has to escape its slashes, so it looks exactly like a
  // JSON-escaped URL. Read with plain slashes, these all have the shape of a
  // URI with a password in it, and that finding is critical.
  it.each([
    String.raw`/^mongodb:\/\/([^:]+):([^@]+)@(.+)$/`,
    String.raw`/postgres(?:ql)?:\/\/[^:]+:[^@]+@[^\/]+/i`,
    String.raw`/redis:\/\/\w+:\w+@\w+\.\w+/`,
    String.raw`/mysql:\/\/.+:.+@.+/;var a=1`,
  ])("does not report %s", (literal) => {
    expect(
      run("hardcoded-secrets", `<script>var r=${literal};</script>`),
    ).toBeNull();
  });

  it("still reports the connection string that same script holds", () => {
    expect(
      run(
        "hardcoded-secrets",
        String.raw`<script>var r=/^mongodb:\/\/([^:]+)/;var c="${escapeSlashes(POSTGRES)}";</script>`,
      ),
    ).toContain("PostgreSQL URI");
  });
});
