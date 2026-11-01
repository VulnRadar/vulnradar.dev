import { describe, it, expect } from "vitest";
import {
  detectWebhookType,
  resolveWebhookType,
  WEBHOOK_TYPES,
  WEBHOOK_TYPE_ERROR,
} from "@/lib/webhooks/detect-type";

/**
 * detectWebhookType decides which payload shape lib/webhooks/delivery.ts
 * sends, so getting it wrong means a webhook that is registered, reported
 * healthy, and silently rejected by the receiving platform. Pure function,
 * no mocking needed.
 */
describe("detectWebhookType", () => {
  it("detects Discord on both of its hostnames", () => {
    expect(detectWebhookType("https://discord.com/api/webhooks/123/abc")).toBe(
      "discord",
    );
    expect(
      detectWebhookType("https://discordapp.com/api/webhooks/123/abc"),
    ).toBe("discord");
  });

  it("detects Slack", () => {
    expect(detectWebhookType("https://hooks.slack.com/services/T/B/X")).toBe(
      "slack",
    );
  });

  it("is case-insensitive", () => {
    expect(detectWebhookType("HTTPS://DISCORD.COM/API/WEBHOOKS/1/x")).toBe(
      "discord",
    );
    expect(detectWebhookType("https://HOOKS.SLACK.COM/services/T/B/X")).toBe(
      "slack",
    );
  });

  it("falls back to generic for anything else", () => {
    expect(detectWebhookType("https://example.com/hook")).toBe("generic");
    expect(detectWebhookType("")).toBe("generic");
  });

  it("does not classify a Discord host without the webhooks path", () => {
    // The delivery payload differs per type, so matching the bare domain
    // would send a Discord-shaped body to an ordinary endpoint.
    expect(detectWebhookType("https://discord.com/channels/1/2")).toBe(
      "generic",
    );
  });

  it("detects Discord's ptb and canary hosts", () => {
    expect(detectWebhookType("https://ptb.discord.com/api/webhooks/1/x")).toBe(
      "discord",
    );
    expect(
      detectWebhookType("https://canary.discordapp.com/api/webhooks/1/x"),
    ).toBe("discord");
  });

  // The three checks below were unanchored regexes over the whole string
  // (CodeQL js/regex/missing-regexp-anchor), so a provider's name anywhere in
  // the URL picked that provider's payload shape for an unrelated host. Each
  // list maps to one of the old patterns, so bringing any one back fails here.
  const allGeneric = (urls: string[]) =>
    expect(urls.map((u) => [u, detectWebhookType(u)])).toEqual(
      urls.map((u) => [u, "generic"]),
    );

  it("does not take a host as Slack because hooks.slack.com appears in the URL", () => {
    allGeneric([
      "https://hooks.slack.com.evil.example/x",
      "https://evil.example/?u=hooks.slack.com",
      "https://evil.example/hooks.slack.com/services/T/B/X",
      "https://hooks.slack.com@evil.example/services/T/B/X",
      "https://nothooks.slack.com/services/T/B/X",
    ]);
  });

  it("does not take a host as Discord because discord.com/api/webhooks appears in the URL", () => {
    allGeneric([
      "https://evil.example/?u=discord.com/api/webhooks/1/x",
      "https://evil.example/discord.com/api/webhooks/1/x",
      "https://discord.com.evil.example/api/webhooks/1/x",
      "https://notdiscord.com/api/webhooks/1/x",
    ]);
  });

  it("does not take a host as Discord because discordapp.com/api/webhooks appears in the URL", () => {
    allGeneric([
      "https://evil.example/?u=discordapp.com/api/webhooks/1/x",
      "https://discordapp.com.evil.example/api/webhooks/1/x",
      "https://discordapp.com@evil.example/api/webhooks/1/x",
      "https://evildiscordapp.com/api/webhooks/1/x",
    ]);
  });

  // Discord documents its API with a version in the path, and a webhook URL
  // copied from its docs or a library can carry one. Read as /api/webhooks/
  // only, every such URL was saved as generic and the channel got flat JSON
  // instead of an embed.
  it("detects Discord's versioned webhook paths on every Discord host", () => {
    for (const host of [
      "discord.com",
      "discordapp.com",
      "ptb.discord.com",
      "canary.discordapp.com",
    ]) {
      for (const version of ["v6", "v9", "v10", "V10"]) {
        const url = `https://${host}/api/${version}/webhooks/123/abc`;
        expect(detectWebhookType(url), url).toBe("discord");
      }
    }
  });

  it("does not take a lookalike host as Discord because its path is versioned", () => {
    allGeneric([
      "https://discord.com.evil.example/api/v10/webhooks/1/x",
      "https://notdiscord.com/api/v10/webhooks/1/x",
      "https://discordapp.com@evil.example/api/v10/webhooks/1/x",
      "https://evil.example/?u=discord.com/api/v10/webhooks/1/x",
      "https://evil.example/api/v10/webhooks/1/x",
    ]);
  });

  it("does not stretch the version segment to other paths on a Discord host", () => {
    allGeneric([
      "https://discord.com/api/v/webhooks/1/x",
      "https://discord.com/api/vten/webhooks/1/x",
      "https://discord.com/api/v10x/webhooks/1/x",
      "https://discord.com/api/v10/v10/webhooks/1/x",
      "https://discord.com/api/v10/channels/1/messages",
      "https://discord.com/x/api/v10/webhooks/1/x",
    ]);
  });

  it("treats a string that is not a URL as generic", () => {
    expect(detectWebhookType("hooks.slack.com/services/T/B/X")).toBe("generic");
    expect(detectWebhookType("not a url")).toBe("generic");
  });
});

/**
 * The same function's other half: what a caller is allowed to ASK for.
 *
 * Both routes used to take any non-"auto" value and write it to the column
 * unchanged, and the create route did not even check it was a string. Nothing
 * downstream validates it either -- scan-notifications.ts branches on
 * "discord" and "slack" and treats everything else as generic -- so a Discord
 * webhook saved as "Discord" quietly received flat JSON instead of an embed
 * for the rest of its life, with no error at any point.
 */
describe("resolveWebhookType", () => {
  const DISCORD = "https://discord.com/api/webhooks/1/x";

  it("detects when the caller says nothing, or says auto", () => {
    expect(resolveWebhookType(undefined, DISCORD)).toBe("discord");
    expect(resolveWebhookType(null, DISCORD)).toBe("discord");
    expect(resolveWebhookType("auto", DISCORD)).toBe("discord");
  });

  it("lets a caller pin a real type against the detected one", () => {
    // Deliberate: a proxy in front of a Discord URL may want generic JSON.
    expect(resolveWebhookType("generic", DISCORD)).toBe("generic");
    expect(resolveWebhookType("slack", DISCORD)).toBe("slack");
  });

  it("refuses a near-miss rather than storing it", () => {
    // Every one of these used to be written to the column verbatim and then
    // fall through every branch in scan-notifications.ts as generic.
    for (const bad of ["Discord", "DISCORD", "disc0rd", "teams", ""]) {
      expect(resolveWebhookType(bad, DISCORD), bad).toBeNull();
    }
  });

  it("refuses a value that is not a string at all", () => {
    // The create route destructured straight out of request.json() with no
    // typeof check, so any of these reached the INSERT.
    for (const bad of [1, true, {}, [], ["discord"]]) {
      expect(resolveWebhookType(bad, DISCORD), JSON.stringify(bad)).toBeNull();
    }
  });

  it("never returns auto, because auto is not a stored value", () => {
    expect(WEBHOOK_TYPES as readonly string[]).not.toContain("auto");
    expect(resolveWebhookType("auto", "https://example.com/hook")).toBe(
      "generic",
    );
  });

  it("names every accepted value in the error it hands back", () => {
    for (const t of WEBHOOK_TYPES) expect(WEBHOOK_TYPE_ERROR).toContain(t);
    expect(WEBHOOK_TYPE_ERROR).toContain("auto");
  });
});
