import { it, expect, vi, afterEach } from "vitest";
import pool from "@/lib/database/db";
import { migrateBase64AvatarsToDatabase } from "@/lib/uploads/avatar-migration";
import { describeIntegration, createUser } from "./_db";

/**
 * The boot backfill against the real schema. The unit tier fakes the pool, and
 * a faked pool answers a scan naming a column that does not exist exactly as it
 * answers a correct one, which here would turn every boot into a failed scan
 * and leave every legacy avatar where it is.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const dataUrl = (bytes: Buffer) =>
  `data:image/png;base64,${bytes.toString("base64")}`;

async function storedUrl(userId: number): Promise<string | null> {
  const { rows } = await pool.query<{ avatar_url: string | null }>(
    "SELECT avatar_url FROM users WHERE id = $1",
    [userId],
  );
  return rows[0]?.avatar_url ?? null;
}

async function setAvatar(userId: number, url: string): Promise<void> {
  await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [
    url,
    userId,
  ]);
}

describeIntegration("legacy base64 avatar backfill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts an avatar the old upload limit allowed and the new one does not", async () => {
    const user = await createUser();
    await setAvatar(
      user.id,
      dataUrl(Buffer.concat([PNG_MAGIC, Buffer.alloc(400 * 1024)])),
    );

    await migrateBase64AvatarsToDatabase();

    expect(await storedUrl(user.id)).toMatch(/^\/api\/v3\/avatar\//);
    const { rows } = await pool.query(
      "SELECT 1 FROM user_avatars WHERE user_id = $1",
      [user.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("reports a row it cannot convert once, however many boots follow", async () => {
    const user = await createUser();
    const unusable = dataUrl(Buffer.from("this is not an image"));
    await setAvatar(user.id, unusable);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const aboutThisUser = () =>
      logged.mock.calls.filter((call) =>
        String(call[0]).includes(`user ${user.id}:`),
      );

    await migrateBase64AvatarsToDatabase();
    await migrateBase64AvatarsToDatabase();

    expect(aboutThisUser()).toHaveLength(1);
    expect(await storedUrl(user.id)).toBe(unusable);
  });
});
