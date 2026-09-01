import { describe, it, expect } from "vitest";
import { detectWebhookType } from "@/lib/webhooks/detect-type";

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
});
