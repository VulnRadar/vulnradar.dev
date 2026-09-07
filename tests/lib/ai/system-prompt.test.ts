import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  sanitizeUserName,
  VULNRADAR_SYSTEM_PROMPT,
} from "@/lib/ai/system-prompt";
import { AI_BOT_NAME } from "@/lib/config/client-constants";

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

/**
 * The chat widget kept answering "I'm MiniMax" when asked who it was. The
 * prompt did name the assistant, once, in its opening sentence, and the
 * closing CRITICAL block (the part that survives a truncated context) said
 * only "you are the VulnRadar assistant" without ever giving the name or
 * saying what to do when the question is asked directly. So the model fell
 * back on the identity in its own weights.
 *
 * These assertions pin the parts of the fix that a future edit could quietly
 * undo: the name has to come from the configured constant, it has to appear
 * in the closing block as well as the opening one, and the prompt has to
 * answer the actual question rather than only forbidding the wrong answer.
 */
describe("assistant identity", () => {
  const prompt = buildSystemPrompt({ name: "Alice" });

  it("opens by naming the assistant from the configured bot name", () => {
    expect(prompt.startsWith(`You are ${AI_BOT_NAME},`)).toBe(true);
  });

  it("names the assistant again in the closing block that survives truncation", () => {
    // Everything after the CRITICAL banner is what stays in context when the
    // knowledge sections get dropped. The name has to be in there.
    const closing = prompt.slice(prompt.indexOf("NON-NEGOTIABLE SCOPE"));
    expect(closing).toContain(AI_BOT_NAME);
  });

  it("tells the model what to say, not only what not to say", () => {
    expect(prompt).toContain(
      `you are\n${AI_BOT_NAME}, VulnRadar's support assistant`,
    );
  });

  it("names the specific denials the model was actually producing", () => {
    for (const wrong of [
      '"I am MiniMax."',
      '"I\'m Claude."',
      '"I\'m ChatGPT."',
      `"I'm not really ${AI_BOT_NAME}."`,
    ]) {
      expect(prompt).toContain(wrong);
    }
  });

  it("still allows naming the model underneath, which is a fair question", () => {
    expect(prompt).toContain("Naming the model is allowed. Being it is not.");
  });

  it("numbers the CRITICAL rules without repeating one", () => {
    const closing = prompt.slice(prompt.indexOf("NON-NEGOTIABLE SCOPE"));
    const numbers = [...closing.matchAll(/^(\d+)\. [A-Z]/gm)].map((m) => m[1]);
    expect(numbers).toEqual([...new Set(numbers)]);
  });
});
