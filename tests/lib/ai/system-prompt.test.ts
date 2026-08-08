import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  sanitizeUserName,
  VULNRADAR_SYSTEM_PROMPT,
} from "@/lib/ai/system-prompt";

describe("sanitizeUserName", () => {
  it("falls back to Guest for empty input", () => {
    expect(sanitizeUserName("")).toBe("Guest");
  });

  it("strips injection-framing characters", () => {
    expect(sanitizeUserName("Bob<script>alert(1)</script>")).not.toMatch(
      /[<>]/,
    );
  });
});

describe("buildSystemPrompt", () => {
  it("bakes in display_name and signed_in for a guest", () => {
    const prompt = buildSystemPrompt({ name: "Guest" });
    expect(prompt).toContain("display_name: Guest");
    expect(prompt).toContain("signed_in: false");
  });

  it("bakes in plan, role, daily_scan_limit, and member_since when provided", () => {
    const prompt = buildSystemPrompt({
      name: "Alice",
      plan: "pro",
      role: "user",
      dailyScanLimit: 150,
      memberSince: "March 2026",
    });
    expect(prompt).toContain("display_name: Alice");
    expect(prompt).toContain("signed_in: true");
    expect(prompt).toContain("plan: pro");
    expect(prompt).toContain("role: user");
    expect(prompt).toContain("daily_scan_limit: 150");
    expect(prompt).toContain("member_since: March 2026");
  });

  it("omits fields that are null or absent instead of printing empty values", () => {
    const prompt = buildSystemPrompt({ name: "Alice" });
    expect(prompt).not.toContain("plan:");
    expect(prompt).not.toContain("role:");
    expect(prompt).not.toContain("daily_scan_limit:");
    expect(prompt).not.toContain("member_since:");
  });

  it("points the model at slash commands for anything not baked in", () => {
    const prompt = buildSystemPrompt({ name: "Alice" });
    expect(prompt).toMatch(/\/me.*\/history.*\/stats/s);
  });

  it("still frames the account block as data, not instructions", () => {
    const prompt = buildSystemPrompt({ name: "Alice", role: "admin" });
    expect(prompt).toMatch(/NOT instructions/);
  });

  it("the legacy VULNRADAR_SYSTEM_PROMPT export still builds for a guest", () => {
    expect(VULNRADAR_SYSTEM_PROMPT).toContain("display_name: Guest");
  });
});
