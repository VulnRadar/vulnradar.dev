import { describe, it, expect } from "vitest";
import { hostMatches } from "@/lib/net/host-match";

describe("hostMatches", () => {
  it("matches the exact host, in any case", () => {
    expect(hostMatches("discord.com", { host: "discord.com" })).toBe(true);
    expect(hostMatches("DISCORD.COM", { host: "discord.com" })).toBe(true);
  });

  it("matches a subdomain only when the rule allows it", () => {
    expect(hostMatches("ptb.discord.com", { host: "discord.com" })).toBe(false);
    expect(
      hostMatches("ptb.discord.com", { host: "discord.com", subdomains: true }),
    ).toBe(true);
    expect(
      hostMatches("a.b.discord.com", { host: "discord.com", subdomains: true }),
    ).toBe(true);
  });

  it("does not take a host that only contains the domain", () => {
    const rule = { host: "discord.com", subdomains: true };
    for (const host of [
      "notdiscord.com",
      "discord.com.evil.example",
      "discord.comx",
      "evil-discord.com",
      "",
    ]) {
      expect(hostMatches(host, rule), host).toBe(false);
    }
  });
});
