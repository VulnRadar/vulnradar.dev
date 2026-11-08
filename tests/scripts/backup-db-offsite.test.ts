import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BACKUP_HEADER_BYTES,
  createBackupCipher,
  createBackupDecipher,
  finishEncryptedBackup,
  uploadOffsite,
} from "../../scripts/backup-db.mjs";
import {
  decryptBackupToFile,
  readBackupEncryption,
} from "../../scripts/restore-db.mjs";

/**
 * ops-5. BACKUP_OFFSITE_UPLOAD_URL is documented as a presigned PUT URL, and a
 * presigned URL authorises exactly one object. The IV and auth tag went to
 * `${url}.json`, which on a real presigned URL either fails the signature or
 * lands on the wrong path, so the offsite copy could never be decrypted and
 * the only sign of it was a warning in a nightly log. The backup is now one
 * self-contained object.
 */
const KEY = "c".repeat(64);
const PLAINTEXT = Buffer.from("-- a dump\n".repeat(200));

interface Received {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

describe("the offsite copy", () => {
  let dir: string;
  let server: Server;
  let received: Received[];
  let status: number;
  let baseUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vulnradar-offsite-test-"));
    received = [];
    status = 200;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        received.push({
          url: req.url ?? "",
          method: req.method ?? "",
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        res.statusCode = status;
        res.end();
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((done) => server.close(done));
    await rm(dir, { recursive: true, force: true });
  });

  /** The bytes runBackup produces: reserved header, ciphertext, then the stamp. */
  async function encryptedBackup(): Promise<string> {
    const path = join(dir, "vulnradar-backup-x.sql.gz.enc");
    const cipherInfo = createBackupCipher(KEY);
    const dest = createWriteStream(path);
    dest.write(Buffer.alloc(BACKUP_HEADER_BYTES));
    await pipeline([Readable.from([PLAINTEXT]), cipherInfo.cipher, dest]);
    await finishEncryptedBackup(path, cipherInfo);
    return path;
  }

  it("decrypts from the uploaded object alone", async () => {
    const path = await encryptedBackup();
    await uploadOffsite(path, `${baseUrl}/bucket/nightly?X-Amz-Signature=abc`);

    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("PUT");

    // A different directory holding only what the receiver got: no sidecar.
    const elsewhere = await mkdtemp(join(tmpdir(), "vulnradar-offsite-copy-"));
    try {
      const copy = join(elsewhere, "copy.sql.gz.enc");
      await writeFile(copy, received[0].body);
      const meta = await readBackupEncryption(copy);
      const out = join(elsewhere, "out");
      await decryptBackupToFile({
        sourcePath: copy,
        key: KEY,
        meta,
        destPath: out,
      });
      expect((await readFile(out)).equals(PLAINTEXT)).toBe(true);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("sends a content length, which presigned PUT endpoints require", async () => {
    // S3 answers a chunked PUT with 501, so a streamed body with no length
    // fails against the very URLs this setting is documented for.
    const path = await encryptedBackup();
    await uploadOffsite(path, `${baseUrl}/o`);
    expect(received[0].headers["content-length"]).toBe(
      String(received[0].body.length),
    );
    expect(received[0].headers["transfer-encoding"]).toBeUndefined();
  });

  it("rejects when the receiver refuses the object", async () => {
    status = 403;
    const path = await encryptedBackup();
    await expect(uploadOffsite(path, `${baseUrl}/o`)).rejects.toThrow(/403/);
  });

  it("never asks for a second object", () => {
    // `${url}.json` on a presigned URL is the bug itself, and it sits inside
    // runBackup, which needs a database to run.
    const src = readFileSync("scripts/backup-db.mjs", "utf8");
    expect(src).not.toMatch(/offsiteUrl\}\.json/);
    expect(src.match(/uploadOffsite\(/g)).toHaveLength(2); // definition + one call
  });

  it("does not swallow an upload failure", () => {
    const src = readFileSync("scripts/backup-db.mjs", "utf8");
    const from = src.indexOf('section("Offsite upload")');
    const to = src.indexOf('section("Retention")');
    expect(src.slice(from, to)).toMatch(/await uploadOffsite\(/);
    expect(src.slice(from, to)).not.toContain(".catch(");
  });

  it("keeps the sidecar beside the local file, and says where the data starts", async () => {
    const path = await encryptedBackup();
    const sidecar = JSON.parse(await readFile(`${path}.json`, "utf8"));
    expect(sidecar.algorithm).toBe("aes-256-gcm");
    expect(sidecar.payloadOffset).toBe(BACKUP_HEADER_BYTES);
    const meta = await readBackupEncryption(path);
    expect(meta.iv).toBe(sidecar.iv);
    expect(meta.authTag).toBe(sidecar.authTag);
  });

  it("refuses a file whose tag was never stamped", async () => {
    // A run killed between the last ciphertext byte and the stamp leaves the
    // reserved zeroes, which is no valid header at all.
    const path = join(dir, "partial.sql.gz.enc");
    await writeFile(path, Buffer.alloc(BACKUP_HEADER_BYTES + 64));
    await expect(readBackupEncryption(path)).rejects.toThrow(/sidecar|\.json/);
  });

  it("still opens a backup from before the header existed, through its sidecar", async () => {
    const path = join(dir, "old.sql.gz.enc");
    const { cipher, ivHex, getAuthTagHex } = createBackupCipher(KEY);
    const ciphertext = Buffer.concat([
      cipher.update(PLAINTEXT),
      cipher.final(),
    ]);
    await writeFile(path, ciphertext);
    await writeFile(
      `${path}.json`,
      JSON.stringify({ iv: ivHex, authTag: getAuthTagHex() }),
    );

    const meta = await readBackupEncryption(path);
    const out = join(dir, "out");
    await decryptBackupToFile({
      sourcePath: path,
      key: KEY,
      meta,
      destPath: out,
    });
    expect((await readFile(out)).equals(PLAINTEXT)).toBe(true);
  });

  it("still finds the payload through the sidecar when the header is damaged", async () => {
    const path = await encryptedBackup();
    const bytes = await readFile(path);
    bytes.fill(0, 0, 8);
    await writeFile(path, bytes);

    const meta = await readBackupEncryption(path);
    expect(meta.payloadOffset).toBe(BACKUP_HEADER_BYTES);
    const out = join(dir, "out");
    await decryptBackupToFile({
      sourcePath: path,
      key: KEY,
      meta,
      destPath: out,
    });
    expect((await readFile(out)).equals(PLAINTEXT)).toBe(true);
  });

  it("refuses an auth tag cut down to fewer bytes than the writer produces", () => {
    // A sidecar is not authenticated, and GCM on its own accepts a 4-byte tag.
    const iv = "00".repeat(12);
    expect(() => createBackupDecipher(KEY, iv, "ab".repeat(16))).not.toThrow();
    expect(() => createBackupDecipher(KEY, iv, "ab".repeat(4))).toThrow(
      /tag length/i,
    );
  });

  it("names the missing sidecar when a header-less file has none", async () => {
    const path = join(dir, "orphan.sql.gz.enc");
    await writeFile(path, Buffer.alloc(128, 7));
    await expect(readBackupEncryption(path)).rejects.toThrow(
      /orphan\.sql\.gz\.enc\.json/,
    );
  });
});

describe("the key check", () => {
  it("is the one the repair tools use", () => {
    const src = readFileSync("scripts/backup-db.mjs", "utf8");
    expect(src).toContain("isValidKeyHex(hexKey)");
    expect(src).not.toMatch(/\[0-9a-f\]\{64\}/);
  });
});
