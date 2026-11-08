import { describe, it, expect } from "vitest";
import { detectors as contentDetectors } from "@/lib/scanner/checks/content";
import { detectors as codeDetectors } from "@/lib/scanner/checks/code";

/**
 * discord-webhook-exposed kept its own host list and path regex after the
 * secret tier and the webhook type detector moved to lib/net/discord-webhook,
 * so it missed the versioned path and every subdomain but ptb and canary.
 *
 * Every value is assembled at runtime: push protection rejects a
 * credential-shaped literal even when it is a made-up fixture.
 */

const ID = "123456789012345678";
const TOKEN = [
  "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT1uV2wX3",
  "yZ4aB5cD6eF7gH8iJ9kL1mN2oP3qR4s",
].join("");

const webhook = (host: string, prefix = "/api/webhooks/") =>
  `https://${host}${prefix}${ID}/${TOKEN}`;

function exposed(body: string): boolean {
  return (
    contentDetectors["discord-webhook-exposed"](
      "https://example.com",
      new Headers(),
      body,
    ) !== null
  );
}

function secretTier(body: string): boolean {
  return (
    codeDetectors["hardcoded-secrets-client-exposed"](
      "https://example.com",
      new Headers(),
      body,
    ) ?? ""
  ).includes("Discord Webhook");
}

const inScript = (url: string) => `<script>fetch("${url}")</script>`;

const HOSTS = [
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discordapp.com",
  "cdn.discord.com",
  "Discord.com",
  "discord.com:443",
];
const PREFIXES = [
  "/api/webhooks/",
  "/api/v10/webhooks/",
  "/api/V9/webhooks/",
  "/API/WEBHOOKS/",
];

describe("discord-webhook-exposed uses the shared host and path rules", () => {
  for (const host of HOSTS) {
    for (const prefix of PREFIXES) {
      it(`fires on ${host}${prefix}, as the secret tier does`, () => {
        const body = inScript(webhook(host, prefix));
        expect(exposed(body)).toBe(true);
        expect(secretTier(body)).toBe(true);
      });
    }
  }

  it("fires without a scheme, as the secret tier does", () => {
    const body = inScript(`discord.com/api/webhooks/${ID}/${TOKEN}`);
    expect(exposed(body)).toBe(true);
    expect(secretTier(body)).toBe(true);
  });

  it.each([
    "evildiscord.com",
    "discord.com.evil.net",
    "notdiscordapp.com",
    "discord.com.",
  ])("does not fire on the lookalike %s", (host) => {
    expect(exposed(inScript(webhook(host)))).toBe(false);
  });

  it("reads JSON-escaped slashes, as the secret tier does", () => {
    const body = inScript(webhook("discord.com").replace(/\//g, "\\/"));
    expect(exposed(body)).toBe(true);
    expect(secretTier(body)).toBe(true);
  });

  it("still reports a webhook carried in another URL's query string", () => {
    expect(
      exposed(`<a href="https://r.acme.io/?u=${webhook("discord.com")}">x</a>`),
    ).toBe(true);
  });

  it("does not fire on a path that is not a webhook", () => {
    expect(exposed(inScript(`https://discord.com/api/users/${ID}`))).toBe(
      false,
    );
  });
});

// The reason this check was rebuilt rather than retired as a duplicate: the
// secret tier deliberately stays quiet on all of these, so removing this
// detector would remove the only finding these pages get.
describe("what only this check reports", () => {
  it.each([
    ["shown only in a code block", `<pre>${webhook("discord.com")}</pre>`],
    [
      "a token shorter than the live format",
      inScript(`https://discord.com/api/webhooks/${ID}/abc123`),
    ],
    [
      "a token holding a run the secret tier treats as a placeholder",
      inScript(
        `https://discord.com/api/webhooks/${ID}/${TOKEN.slice(0, 20)}0000${TOKEN.slice(24)}`,
      ),
    ],
  ])("%s", (_name, body) => {
    expect(exposed(body)).toBe(true);
    expect(secretTier(body)).toBe(false);
  });
});
