import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { detectWebhookType } from "@/lib/webhooks/detect-type";
import { detectors } from "@/lib/scanner/checks/code";

/**
 * Two places decide whether a URL is a Discord webhook: the type detector,
 * which picks the payload a registered webhook is sent, and the scanner's
 * leaked-webhook pattern. Each carried its own host list and its own path
 * regex, so teaching one of them the versioned /api/v<n>/ path had to be
 * repeated by hand in the other, and the two disagreed on case: the detector
 * matched the path case-insensitively and the scanner matched neither the
 * host nor the path that way. A webhook URL written as Discord.com or
 * /API/WEBHOOKS/ was saved as a Discord webhook and was not reported as a
 * leaked one.
 *
 * The id and token are assembled at runtime: push protection rejects a
 * credential-shaped literal even when it is a made-up fixture.
 */

const ID = "123456789012345678";
const TOKEN = [
  "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT1uV2wX3",
  "yZ4aB5cD6eF7gH8iJ9kL1mN2oP3qR4s",
].join("");

function scannerFires(url: string): boolean {
  const out = detectors["hardcoded-secrets-client-exposed"](
    "https://example.com",
    new Headers(),
    `<script>fetch("${url}")</script>`,
  );
  return (out ?? "").includes("Discord Webhook");
}

const HOSTS = [
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discordapp.com",
  "Discord.com",
  "DISCORDAPP.COM",
  "Canary.Discord.com",
  // The detector parses the URL and drops the port; the scanner reads text.
  "discord.com:443",
  "user@discord.com",
];

const PREFIXES = [
  "/api/webhooks/",
  "/api/v10/webhooks/",
  "/api/V9/webhooks/",
  "/API/WEBHOOKS/",
  "/Api/V10/Webhooks/",
];

// No "example" in these: the scanner drops any match containing it as a
// placeholder before the host is looked at, so a lookalike spelt that way
// would pass without testing the host rule at all.
const LOOKALIKES = [
  `https://discord.com.evil.test/api/webhooks/${ID}/${TOKEN}`,
  `https://notdiscord.com/api/v10/webhooks/${ID}/${TOKEN}`,
  `https://evildiscordapp.com/API/WEBHOOKS/${ID}/${TOKEN}`,
  `https://evil.test/api/webhooks/${ID}/${TOKEN}`,
  `https://discord.com@evil.test/api/webhooks/${ID}/${TOKEN}`,
  `https://discord.com.evil.test:443/api/webhooks/${ID}/${TOKEN}`,
  `https://discord.com/api/v10x/webhooks/${ID}/${TOKEN}`,
  `https://discord.com/api/channels/${ID}/${TOKEN}`,
];

describe("the Discord webhook detector and the scanner agree", () => {
  for (const host of HOSTS) {
    for (const prefix of PREFIXES) {
      const url = `https://${host}${prefix}${ID}/${TOKEN}`;
      it(`both take ${host}${prefix} as a Discord webhook`, () => {
        expect(detectWebhookType(url)).toBe("discord");
        expect(scannerFires(url)).toBe(true);
      });
    }
  }

  for (const url of LOOKALIKES) {
    it(`neither takes ${url.slice(0, 48)}... as one`, () => {
      expect(detectWebhookType(url)).toBe("generic");
      expect(scannerFires(url)).toBe(false);
    });
  }
});

describe("one host list and one path pattern for both", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const files = ["lib/webhooks/detect-type.ts", "lib/scanner/checks/code.ts"];

  for (const file of files) {
    it(`${file} builds on the shared definition`, () => {
      const src = read(file);
      expect(src).toMatch(/from "@\/lib\/net\/discord-webhook"/);
      // A local copy of either half is the drift this replaced.
      expect(src).not.toMatch(/DISCORD_HOSTS\s*:/);
      expect(src).not.toMatch(/host:\s*"discord(?:app)?\.com"/);
      expect(src).not.toContain(String.raw`webhooks\/`);
    });
  }
});
