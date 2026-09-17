import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readDumpLines } from "../../../scripts/_lib/_lib.sql-backup.mjs";

/**
 * readDumpLines has to hand back every line of the file, however long the
 * caller takes to start reading.
 *
 * restoreSqlDump awaits BEGIN before its loop starts. The reader used to be a
 * readline.Interface, which starts pulling the file the moment it is created
 * and emits each line whether or not anything is iterating yet. When the first
 * 16KB of decompressed output arrived before BEGIN came back, those lines went
 * nowhere, and the restore started reading halfway through a CREATE TABLE:
 * "Unexpected SQL outside a marked statement: "is_staff" boolean NOT NULL,".
 * It depended on whether the database answered faster than gunzip, so CI
 * failed on some runs and passed on a re-run of the same commit.
 */

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

async function gzFile(text: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "vr-reader-"));
  const path = join(dir, "dump.sql.gz");
  await writeFile(path, gzipSync(Buffer.from(text, "utf8")));
  return path;
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}

describe("readDumpLines", () => {
  it("loses nothing when the caller awaits before it starts reading", async () => {
    const expected = Array.from(
      { length: 20_000 },
      (_, i) => `line ${i} ${"x".repeat(i % 50)}`,
    );
    const path = await gzFile(expected.join("\n") + "\n");

    const lines = readDumpLines(path);
    // Long enough for the file to be read and decompressed several times over.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await collect(lines)).toEqual(expected);
  });

  it("splits CRLF and keeps a final line with no newline", async () => {
    const path = await gzFile("one\r\ntwo\nthree");
    expect(await collect(readDumpLines(path))).toEqual(["one", "two", "three"]);
  });

  it("does not split a multi-byte character that straddles a chunk", async () => {
    // Well past zlib's 16KB output chunk, with a 3-byte character on every
    // line, so some line is guaranteed to cross a chunk boundary mid-character.
    const expected = Array.from({ length: 5_000 }, (_, i) => `€${i}€`);
    const path = await gzFile(expected.join("\n"));
    expect(await collect(readDumpLines(path))).toEqual(expected);
  });

  it("raises a read error instead of ending quietly", async () => {
    dir = await mkdtemp(join(tmpdir(), "vr-reader-"));
    await expect(
      collect(readDumpLines(join(dir, "missing.sql.gz"))),
    ).rejects.toThrow(/ENOENT/);
  });

  it("raises on a truncated file", async () => {
    const whole = gzipSync(Buffer.from("a\n".repeat(50_000)));
    dir = await mkdtemp(join(tmpdir(), "vr-reader-"));
    const path = join(dir, "cut.sql.gz");
    await writeFile(path, whole.subarray(0, Math.floor(whole.length / 2)));
    await expect(collect(readDumpLines(path))).rejects.toThrow();
  });
});
