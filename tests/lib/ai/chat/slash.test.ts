/**
 * Server-side slash commands. The file-backed ones run against the committed
 * knowledge files, so a file that grows past what one turn should carry fails
 * here rather than quietly costing every /legal request.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  canMakeRequest: async () => ({
    allowed: true,
    used: 0,
    limit: 25,
    remaining: 25,
    resetsAt: "2026-10-26T00:00:00.000Z",
  }),
}));

const { expandSlashCommand, parseSlashCommand } =
  await import("@/lib/ai/chat/slash");
const { SLASH_COMMANDS } = await import("@/lib/ai/commands");

/** About 15k tokens: the most one command may add to one request. */
const PER_COMMAND_CAP = 60_000;

describe("parseSlashCommand", () => {
  it("recognises the real commands with their argument", () => {
    expect(parseSlashCommand("/history abc123")).toEqual({
      cmd: "history",
      arg: "abc123",
    });
    expect(parseSlashCommand("  /ME ")).toEqual({ cmd: "me", arg: "" });
  });

  it("leaves anything else as an ordinary message", () => {
    expect(parseSlashCommand("/findings x")).toBeNull();
    expect(parseSlashCommand("/etc/nginx/nginx.conf")).toBeNull();
    expect(parseSlashCommand("what does /docs do")).toBeNull();
  });
});

describe("expandSlashCommand", () => {
  it("handles every command the widget offers", async () => {
    for (const { cmd } of SLASH_COMMANDS) {
      const out = await expandSlashCommand(`/${cmd}`, 42);
      expect(out, `/${cmd}`).not.toBeNull();
      expect(out!.instruction).toContain(`/${cmd}`);
    }
  });

  it("keeps what each command adds to one turn bounded", async () => {
    for (const { cmd } of SLASH_COMMANDS) {
      const out = await expandSlashCommand(`/${cmd}`, 42);
      expect(
        out!.context.length,
        `/${cmd} adds ${out!.context.length} chars to the turn`,
      ).toBeLessThanOrEqual(PER_COMMAND_CAP);
    }
  });

  it("/finding reads the real check, not a fixture", async () => {
    const out = await expandSlashCommand("/finding csp-missing", 42);
    const data = JSON.parse(out!.context);
    expect(data.found).toBe(true);
    expect(data.id).toBe("csp-missing");
    expect(data.fixSteps.length).toBeGreaterThan(0);
  });

  it("/finding without an id asks which one", async () => {
    const out = await expandSlashCommand("/finding", 42);
    expect(out!.context).toBe("");
    expect(out!.instruction).toMatch(/Ask for the check id/);
  });

  it("/changelog with a version returns that release", async () => {
    const out = await expandSlashCommand("/changelog 3.9.0", 42);
    expect(JSON.parse(out!.context).releases[0].heading).toMatch(/^v3\.9\.0/);
  });
});
