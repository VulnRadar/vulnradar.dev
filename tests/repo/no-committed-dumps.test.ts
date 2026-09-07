import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * No database dump is ever a tracked file.
 *
 * This exists because one was. An encrypted production dump
 * (backups/vulnradar-backup-2026-09-04T03-38-18-064Z.sql.gz.enc, 1.3 MB of
 * AES-256-GCM over a full pg_dump, with its IV and auth tag in a sidecar
 * beside it) was committed from a local run and shipped inside the published
 * v3.8.1 release tarball before anyone noticed. .gitignore was widened in
 * response, and .gitignore alone would not have caught it: the file was
 * already tracked by then, and git ignores nothing it is already tracking.
 *
 * So this asserts the state rather than the rule. It reads the actual index,
 * which means it fails on a dump added with `git add -f`, on one that lands
 * outside the ignored directories because BACKUP_DIR points somewhere else,
 * and on one that arrives in a branch whose .gitignore predates the fix.
 *
 * It deliberately does NOT look at history. The v3.8.1 blob is still back
 * there and removing it means rewriting published history, which is a
 * decision with consequences for every clone and fork rather than something
 * a test should assert into existence.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Every path git currently tracks. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

/**
 * Shapes a database dump takes here: what scripts/backup-db.mjs writes (plain
 * SQL, gzipped, and gzipped-then-encrypted, each with an optional metadata
 * sidecar) and what pg_dump produces directly.
 */
const DUMP_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\.sql$/i, what: "a plain SQL dump" },
  { re: /\.sql\.gz$/i, what: "a gzipped SQL dump" },
  { re: /\.sql\.gz\.enc$/i, what: "an encrypted SQL dump" },
  { re: /\.sql\.gz\.enc\.json$/i, what: "an encrypted dump's IV and auth tag" },
  { re: /\.dump$/i, what: "a pg_dump custom-format archive" },
  { re: /^backups?\//i, what: "a file in the backup output directory" },
];

/**
 * Checked-in SQL that is part of the product rather than a dump of it. Keep
 * this list short and specific: a broad exemption here is how the next dump
 * gets through.
 */
function isAllowed(file: string): boolean {
  // Migration and fixture SQL shipped with the code, mirroring the
  // `!scripts/**/*.sql` negation .gitignore already carries.
  return file.startsWith("scripts/");
}

describe("no database dump is committed", () => {
  const tracked = trackedFiles();

  it("git tracks no file shaped like a database dump", () => {
    const offenders: string[] = [];
    for (const file of tracked) {
      if (isAllowed(file)) continue;
      const hit = DUMP_PATTERNS.find((p) => p.re.test(file));
      if (hit) offenders.push(`${file}  (${hit.what})`);
    }

    expect(
      offenders,
      "A database dump is tracked by git. These carry real customer data and " +
        "are published in the release tarball. Remove it from the index " +
        "(`git rm --cached <file>`) before committing:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the ignore rules that back this up are still in place", () => {
    // The test above catches a file that is already tracked. These stop one
    // becoming tracked in the first place, and the two are not the same
    // guarantee: git ignores nothing it is already tracking, which is exactly
    // why widening .gitignore after the fact did not remove the v3.8.1 blob.
    const gitignore = execFileSync("git", ["show", "HEAD:.gitignore"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    for (const rule of ["/backups/", "*.sql.gz.enc", "*.sql.gz"]) {
      expect(gitignore).toContain(rule);
    }
  });
});
