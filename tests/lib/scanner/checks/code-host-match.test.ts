import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { detectors } from "@/lib/scanner/checks/code";

/**
 * Three of the hardcoded-secret patterns are URLs, and what makes one a
 * Slack webhook, a Discord webhook or a Firebase database is its host. The
 * patterns searched for the hostname as text, so a host that only contains
 * it (xhooks.slack.com, evildiscord.com, x.firebaseio.com.evil.example) was
 * reported as that vendor's credential.
 *
 * Every value is assembled at runtime: push protection rejects a
 * credential-shaped literal even when it is a made-up fixture.
 */

const SLACK_PATH = [
  "",
  "services",
  "T0AB1CD2EF",
  "B0GH3IJ4KL",
  "aB1cD2eF3gH4iJ5kL6mN7oP8",
].join("/");
const DISCORD_PATH = [
  "",
  "api",
  "webhooks",
  "123456789012345678",
  "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT1uV2wX3yZ4aB5cD6eF7gH8iJ9kL1mN2oP3qR4s",
].join("/");

function run(id: string, body: string): string | null {
  return detectors[id]("https://example.com", new Headers(), body);
}

describe("Slack Webhook (hardcoded-secrets) is keyed on the exact host", () => {
  it("fires on hooks.slack.com", () => {
    expect(
      run(
        "hardcoded-secrets",
        `<script>const u = "https://hooks.slack.com${SLACK_PATH}";</script>`,
      ),
    ).toContain("Slack Webhook");
  });

  it("fires without a scheme, as the pattern always has", () => {
    expect(
      run(
        "hardcoded-secrets",
        `<script>u = "hooks.slack.com${SLACK_PATH}"</script>`,
      ),
    ).toContain("Slack Webhook");
  });

  it("still fires when the webhook sits in another URL's query string", () => {
    expect(
      run(
        "hardcoded-secrets",
        `<a href="https://evil.example/?u=https://hooks.slack.com${SLACK_PATH}">`,
      ),
    ).toContain("Slack Webhook");
  });

  it("does not fire on a host that only ends in hooks.slack.com", () => {
    for (const host of ["xhooks.slack.com", "evil-hooks.slack.com"]) {
      expect(
        run(
          "hardcoded-secrets",
          `<script>const u = "https://${host}${SLACK_PATH}";</script>`,
        ) ?? "",
      ).not.toContain("Slack Webhook");
    }
  });
});

describe("Discord Webhook (hardcoded-secrets-client-exposed) is keyed on Discord's hosts", () => {
  for (const host of [
    "discord.com",
    "discordapp.com",
    "canary.discord.com",
    "ptb.discord.com",
  ]) {
    it(`fires on ${host}`, () => {
      expect(
        run(
          "hardcoded-secrets-client-exposed",
          `<script>fetch("https://${host}${DISCORD_PATH}")</script>`,
        ),
      ).toContain("Discord Webhook");
    });
  }

  for (const version of ["v6", "v9", "v10"]) {
    it(`fires on the versioned /api/${version}/webhooks/ path`, () => {
      const path = DISCORD_PATH.replace("/api/", `/api/${version}/`);
      expect(
        run(
          "hardcoded-secrets-client-exposed",
          `<script>fetch("https://discord.com${path}")</script>`,
        ),
      ).toContain("Discord Webhook");
    });
  }

  it("does not fire on a versioned path under another host", () => {
    const path = DISCORD_PATH.replace("/api/", "/api/v10/");
    expect(
      run(
        "hardcoded-secrets-client-exposed",
        `<script>fetch("https://evildiscord.com${path}")</script>`,
      ) ?? "",
    ).not.toContain("Discord Webhook");
  });

  it("does not fire on a host that only ends in discord.com", () => {
    for (const host of ["evildiscord.com", "notdiscordapp.com"]) {
      expect(
        run(
          "hardcoded-secrets-client-exposed",
          `<script>fetch("https://${host}${DISCORD_PATH}")</script>`,
        ) ?? "",
      ).not.toContain("Discord Webhook");
    }
  });
});

describe("Firebase Database URL (hardcoded-secrets-low-risk) is keyed on the whole host", () => {
  it("fires on a firebaseio.com database host", () => {
    expect(
      run(
        "hardcoded-secrets-low-risk",
        "<script>const db = 'https://my-app-prod.firebaseio.com';</script>",
      ),
    ).toContain("Firebase Database URL");
  });

  it("fires on one with a path or at the end of a sentence", () => {
    expect(
      run(
        "hardcoded-secrets-low-risk",
        "<p>Data lives at https://my-app-prod.firebaseio.com/users.json.</p>",
      ),
    ).toContain("Firebase Database URL");
  });

  it("does not fire on a host that continues past firebaseio.com", () => {
    expect(
      run(
        "hardcoded-secrets-low-risk",
        "<script>const db = 'https://my-app-prod.firebaseio.com.evil.example/x';</script>",
      ),
    ).toBeNull();
    expect(
      run(
        "hardcoded-secrets-low-risk",
        "<script>const db = 'https://my-app-prod.firebaseio.community';</script>",
      ),
    ).toBeNull();
  });
});

describe("code.ts secret hosts are not regexes over the body", () => {
  // CodeQL's js/regex/missing-regexp-anchor raised #247 to #249 on these
  // literals; this keeps them from being pasted back.
  const source = readFileSync(
    join(process.cwd(), "lib/scanner/checks/code.ts"),
    "utf8",
  );
  for (const literal of [
    String.raw`/hooks\.slack\.com\/services\/`,
    String.raw`/discord(?:app)?\.com\/api\/webhooks\/`,
    String.raw`/https:\/\/[a-z0-9-]+\.firebaseio\.com/g`,
  ]) {
    it(`does not contain ${literal}`, () => {
      expect(source).not.toContain(literal);
    });
  }
});
