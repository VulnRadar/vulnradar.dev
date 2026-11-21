import { afterEach, expect, it, vi } from "vitest";
import pool from "@/lib/database/db";
import { createUser, describeIntegration, unique } from "./_db";

/**
 * webhooks.url at rest (enc-2), against the real boot schema.
 *
 * A Discord or Slack webhook URL is the credential for posting into that
 * channel, so the boot backfill moves every plaintext address into
 * url_encrypted and url_host and empties url. What only Postgres can say: that
 * the columns exist, that the statement's WHERE really skips moved rows on the
 * next boot, and that the guard on the old value lets an edit made between the
 * backfill's read and its write win. A faked pool answers all three the same
 * whether the SQL is right or not.
 */
const { migratePlaintextWebhookSecrets, readWebhookUrl } =
  await import("@/lib/webhooks/secret");

/** A row written the way 3.9.1 writes one: the address in url, nothing else. */
async function legacyWebhook(userId: number, url: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO webhooks (user_id, url, name, type)
     VALUES ($1, $2, 'hook', 'discord')
     RETURNING id`,
    [userId, url],
  );
  return rows[0].id;
}

async function stored(id: number) {
  const { rows } = await pool.query<{
    id: number;
    url: string;
    url_encrypted: string | null;
    url_host: string | null;
  }>(`SELECT id, url, url_encrypted, url_host FROM webhooks WHERE id = $1`, [
    id,
  ]);
  return rows[0];
}

function discordUrl(): string {
  return `https://discord.com/api/webhooks/1/${unique("token")}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describeIntegration("webhook URLs encrypted at rest", () => {
  it("moves a 3.9.1 plaintext row, leaves no https:// in url, and a second run changes nothing", async () => {
    const user = await createUser();
    const url = discordUrl();
    const id = await legacyWebhook(user.id, url);

    const first = await migratePlaintextWebhookSecrets();
    expect(first.urlsEncrypted).toBeGreaterThanOrEqual(1);

    const row = await stored(id);
    expect(row.url).toBe("");
    expect(row.url_host).toBe("discord.com");
    expect(row.url_encrypted).not.toBeNull();
    expect(row.url_encrypted).not.toContain("discord.com");
    expect(readWebhookUrl(row)).toBe(url);

    const { rows: leftovers } = await pool.query(
      `SELECT id FROM webhooks WHERE url LIKE 'https://%'`,
    );
    expect(leftovers).toEqual([]);

    const second = await migratePlaintextWebhookSecrets();
    expect(second.urlsEncrypted).toBe(0);
    expect(await stored(id)).toEqual(row);
  });

  it("keeps an edit saved between the backfill's read and its write", async () => {
    const user = await createUser();
    const original = discordUrl();
    const edited = discordUrl();
    const id = await legacyWebhook(user.id, original);

    // The edit lands after the SELECT has read the original address and
    // before the UPDATE for this row runs, the way a concurrent save would.
    const query = pool.query.bind(pool) as (...a: unknown[]) => unknown;
    vi.spyOn(pool, "query").mockImplementation(((
      text: unknown,
      values?: unknown[],
    ) => {
      if (
        typeof text === "string" &&
        text.startsWith("UPDATE webhooks SET url_encrypted") &&
        values?.[0] === id
      ) {
        return (async () => {
          await query(`UPDATE webhooks SET url = $2 WHERE id = $1`, [
            id,
            edited,
          ]);
          return query(text, values);
        })();
      }
      return query(text, values);
    }) as typeof pool.query);

    await migratePlaintextWebhookSecrets();
    vi.restoreAllMocks();

    const afterRace = await stored(id);
    expect(afterRace.url).toBe(edited);
    expect(afterRace.url_encrypted).toBeNull();

    // The next boot moves the edited address, not the one it first read.
    await migratePlaintextWebhookSecrets();
    const moved = await stored(id);
    expect(moved.url).toBe("");
    expect(readWebhookUrl(moved)).toBe(edited);
  });

  it("encrypts an address a 3.9.1 binary wrote over a row that was already moved", async () => {
    const user = await createUser();
    const original = discordUrl();
    const id = await legacyWebhook(user.id, original);
    await migratePlaintextWebhookSecrets();
    const before = await stored(id);
    expect(before.url).toBe("");

    // 3.9.1 knows only the url column: an edit there, during a rollback or a
    // rolling deploy, leaves the older ciphertext beside the new address.
    const edited = `https://hooks.slack.com/services/T0/B0/${unique("token")}`;
    await pool.query(`UPDATE webhooks SET url = $2 WHERE id = $1`, [
      id,
      edited,
    ]);
    expect(readWebhookUrl(await stored(id))).toBe(edited);

    await migratePlaintextWebhookSecrets();
    const moved = await stored(id);
    expect(moved.url).toBe("");
    expect(moved.url_host).toBe("hooks.slack.com");
    expect(moved.url_encrypted).not.toBe(before.url_encrypted);
    expect(readWebhookUrl(moved)).toBe(edited);
  });
});
