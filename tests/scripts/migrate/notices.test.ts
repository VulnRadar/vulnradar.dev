import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

/**
 * gap-migration-upgrade-path-10. The 2.0.0 -> 3.0.0 upgrade skips
 * idx_users_email_lower with a RAISE WARNING when two accounts share an email
 * in different case, and tells the operator what to resolve. A RAISE arrives
 * as a pg `notice` event and nothing listened for one, so the warning went
 * nowhere and case-insensitive uniqueness stayed off without a word.
 */
const { runPlan, repairAllSequences } =
  await import("@/scripts/migrate/_runner.mjs");

const SKIPPED_INDEX =
  "Skipped idx_users_email_lower: could not create unique index. Resolve them by hand.";

function fakeClient(onQuery: (client: EventEmitter, sql: string) => void) {
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => {
      onQuery(client, String(sql));
      return { rows: [], rowCount: 0 };
    },
    release: vi.fn(),
  });
  return client;
}

const step = (sql: string) => ({
  kind: "createIndex",
  sql,
  label: sql,
  destructive: false,
  dataLoss: null,
});

describe("database notices during a migration", () => {
  let logged: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args.join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const shown = (text: string) => logged.some((line) => line.includes(text));

  it("surfaces a RAISE WARNING from a plan step", async () => {
    const client = fakeClient((c, sql) => {
      if (sql.startsWith("DO $$ skip")) {
        c.emit("notice", { severity: "WARNING", message: SKIPPED_INDEX });
      }
    });
    await runPlan(
      { connect: async () => client },
      { steps: [step("DO $$ skip")] },
    );
    expect(shown(SKIPPED_INDEX)).toBe(true);
  });

  it("surfaces a notice raised during the sequence repair", async () => {
    const client = fakeClient((c, sql) => {
      if (sql.includes("pg_sequence_last_value")) {
        c.emit("notice", { severity: "WARNING", message: "sequence oddity" });
      }
    });
    await repairAllSequences(client);
    expect(shown("sequence oddity")).toBe(true);
  });

  it("keeps the routine IF NOT EXISTS chatter out of the output", async () => {
    // Every idempotent statement in the plan answers with one of these, and a
    // screen of them is how the one warning that matters gets missed.
    const client = fakeClient((c) => {
      c.emit("notice", {
        severity: "NOTICE",
        code: "42P07",
        message: 'relation "users" already exists, skipping',
      });
    });
    await runPlan(
      { connect: async () => client },
      { steps: [step("CREATE TABLE IF NOT EXISTS users ()")] },
    );
    expect(shown("already exists, skipping")).toBe(false);
  });

  it("removes its listener before the client goes back to the pool", async () => {
    const client = fakeClient(() => {});
    await runPlan(
      { connect: async () => client },
      { steps: [step("SELECT 1")] },
    );
    expect(client.listenerCount("notice")).toBe(0);
  });

  it("removes its listener when a step fails", async () => {
    const client = fakeClient((_c, sql) => {
      if (sql === "BROKEN") throw new Error("boom");
    });
    await runPlan({ connect: async () => client }, { steps: [step("BROKEN")] });
    expect(client.listenerCount("notice")).toBe(0);
  });

  it("does not stack listeners when the sequence repair runs inside a plan", async () => {
    let peak = 0;
    const client = fakeClient((c) => {
      peak = Math.max(peak, c.listenerCount("notice"));
    });
    await runPlan(
      { connect: async () => client },
      { steps: [step("SELECT 1")] },
    );
    expect(peak).toBe(1);
  });
});
