import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyTreeOverlay,
  pruneExtraneous,
} from "@/lib/updater/copy-with-excludes";

/**
 * Exercises the real filesystem inside isolated temp directories rather
 * than mocking node:fs -- this is the exact code path lib/updater/apply.ts
 * uses to copy an extracted release over the running app directory, so a
 * mock here would (per tests/README.md) risk asserting against a
 * hand-written copy of the exclusion logic instead of the real thing.
 */

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function writeFile(root: string, relPath: string, content = "x") {
  const full = path.join(root, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("copyTreeOverlay", () => {
  it("copies regular files from src into dest, preserving relative paths", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(src, "package.json", '{"name":"vulnradar"}');
    await writeFile(src, "app/page.tsx", "export default function Page() {}");

    const result = await copyTreeOverlay(src, dest);

    expect(result.filesCopied).toBe(2);
    expect(await exists(path.join(dest, "package.json"))).toBe(true);
    expect(await exists(path.join(dest, "app/page.tsx"))).toBe(true);
    expect(await fs.readFile(path.join(dest, "package.json"), "utf8")).toBe(
      '{"name":"vulnradar"}',
    );
  });

  it("never touches .env or .env.* files in the destination, because the release tree never contains one", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    // Simulate a real deployment: dest has a live .env the update must
    // never overwrite or delete.
    await writeFile(dest, ".env", "DATABASE_URL=postgres://real-secret");
    await writeFile(dest, ".env.production", "SECRET=abc123");
    await writeFile(src, "package.json", "{}");
    // Defense in depth: even if a .env-shaped file somehow ended up in
    // the source tree, it must still never be copied over.
    await writeFile(src, ".env", "DATABASE_URL=malicious-override");

    const result = await copyTreeOverlay(src, dest);

    expect(await fs.readFile(path.join(dest, ".env"), "utf8")).toBe(
      "DATABASE_URL=postgres://real-secret",
    );
    expect(await exists(path.join(dest, ".env.production"))).toBe(true);
    expect(result.skipped).toContain(".env");
  });

  it("never touches node_modules/ or .git/ even if present in the source tree", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(
      dest,
      "node_modules/some-pkg/index.js",
      "module.exports = {};",
    );
    await writeFile(dest, ".git/HEAD", "ref: refs/heads/main");
    await writeFile(src, "node_modules/malicious/index.js", "evil();");
    await writeFile(src, ".git/config", "[core]");
    await writeFile(src, "package.json", "{}");

    const result = await copyTreeOverlay(src, dest, {
      excludeNames: [".git", "node_modules"],
    });

    expect(await exists(path.join(dest, "node_modules/malicious"))).toBe(false);
    expect(await exists(path.join(dest, ".git/config"))).toBe(false);
    // Pre-existing dest content under those dirs is untouched.
    expect(
      await exists(path.join(dest, "node_modules/some-pkg/index.js")),
    ).toBe(true);
    expect(await exists(path.join(dest, ".git/HEAD"))).toBe(true);
    expect(result.skipped.some((s) => s.startsWith("node_modules"))).toBe(true);
    expect(result.skipped.some((s) => s.startsWith(".git"))).toBe(true);
  });

  it("never touches an excluded uploads/avatars directory prefix", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(dest, "data/avatars/42.png", "real-uploaded-avatar-bytes");
    await writeFile(src, "data/avatars/42.png", "malicious-replacement-bytes");
    await writeFile(src, "package.json", "{}");

    const result = await copyTreeOverlay(src, dest, {
      excludePrefixes: ["data/avatars"],
    });

    expect(
      await fs.readFile(path.join(dest, "data/avatars/42.png"), "utf8"),
    ).toBe("real-uploaded-avatar-bytes");
    // The whole directory is skipped at the top -- copyTreeOverlay never
    // descends into it, so the skip list names the directory itself
    // rather than every file inside it.
    expect(result.skipped).toContain("data/avatars");
  });

  it("is additive, not a mirror: it never deletes dest files absent from src", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(dest, "some-local-only-file.txt", "kept");
    await writeFile(src, "package.json", "{}");

    await copyTreeOverlay(src, dest);

    expect(await exists(path.join(dest, "some-local-only-file.txt"))).toBe(
      true,
    );
  });

  it("overwrites an existing dest file with the src version when not excluded", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(dest, "package.json", '{"version":"1.0.0"}');
    await writeFile(src, "package.json", '{"version":"2.0.0"}');

    await copyTreeOverlay(src, dest);

    expect(await fs.readFile(path.join(dest, "package.json"), "utf8")).toBe(
      '{"version":"2.0.0"}',
    );
  });

  it("creates nested destination directories that don't exist yet", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(src, "lib/updater/deep/nested/file.ts", "export {};");

    const result = await copyTreeOverlay(src, dest);

    expect(result.dirsCreated).toBeGreaterThan(0);
    expect(
      await exists(path.join(dest, "lib/updater/deep/nested/file.ts")),
    ).toBe(true);
  });
});

// Standard protected/strip lists mirroring lib/updater/apply.ts.
const PROTECTED_NAMES = ["node_modules", ".git"];
const PROTECTED_PREFIXES = [".next", "data", "backups", ".npm", ".cache"];
const STRIP_PREFIXES = [
  "tests",
  ".github",
  "extension",
  "audits",
  "LICENSE",
  "CONTRIBUTING.md",
];
const pruneOpts = {
  protectedNames: PROTECTED_NAMES,
  protectedPrefixes: PROTECTED_PREFIXES,
  stripPrefixes: STRIP_PREFIXES,
};

describe("pruneExtraneous", () => {
  it("deletes a dest file the new release no longer ships (the stale-file bug)", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    // The release still ships permissions-client.ts but dropped permissions.ts.
    await writeFile(src, "lib/auth/permissions-client.ts", "export {};");
    await writeFile(dest, "lib/auth/permissions-client.ts", "export {};");
    await writeFile(
      dest,
      "lib/auth/permissions.ts",
      "// stale, removed upstream",
    );

    const result = await pruneExtraneous(src, dest, pruneOpts);

    expect(await exists(path.join(dest, "lib/auth/permissions.ts"))).toBe(
      false,
    );
    expect(
      await exists(path.join(dest, "lib/auth/permissions-client.ts")),
    ).toBe(true);
    expect(result.deleted).toContain("lib/auth/permissions.ts");
  });

  it("never deletes protected user data or dependency/build output", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(src, "package.json", "{}");
    // None of these exist in the release tree, but all must survive.
    await writeFile(dest, ".env", "DATABASE_URL=secret");
    await writeFile(dest, ".env.local", "SECRET=1");
    await writeFile(dest, "node_modules/pkg/index.js", "x");
    await writeFile(dest, ".git/HEAD", "ref");
    await writeFile(dest, "data/avatars/7.png", "avatar-bytes");
    await writeFile(dest, "backups/dump.sql.gz.enc", "backup-bytes");
    await writeFile(dest, ".next/build-id", "abc");

    await pruneExtraneous(src, dest, pruneOpts);

    expect(await exists(path.join(dest, ".env"))).toBe(true);
    expect(await exists(path.join(dest, ".env.local"))).toBe(true);
    expect(await exists(path.join(dest, "node_modules/pkg/index.js"))).toBe(
      true,
    );
    expect(await exists(path.join(dest, ".git/HEAD"))).toBe(true);
    expect(await exists(path.join(dest, "data/avatars/7.png"))).toBe(true);
    expect(await exists(path.join(dest, "backups/dump.sql.gz.enc"))).toBe(true);
    expect(await exists(path.join(dest, ".next/build-id"))).toBe(true);
  });

  it("strips dev-only paths even when the release still ships them", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    // The release tarball DOES contain these (tracked files), but a running
    // install should not keep them.
    await writeFile(src, "LICENSE", "GPL");
    await writeFile(src, "CONTRIBUTING.md", "how to contribute");
    await writeFile(src, "tests/foo.test.ts", "test");
    await writeFile(src, "package.json", "{}");
    await writeFile(dest, "LICENSE", "GPL");
    await writeFile(dest, "CONTRIBUTING.md", "how to contribute");
    await writeFile(dest, "tests/foo.test.ts", "test");
    await writeFile(dest, "package.json", "{}");

    await pruneExtraneous(src, dest, pruneOpts);

    expect(await exists(path.join(dest, "LICENSE"))).toBe(false);
    expect(await exists(path.join(dest, "CONTRIBUTING.md"))).toBe(false);
    expect(await exists(path.join(dest, "tests/foo.test.ts"))).toBe(false);
    // A real app file the release ships is kept.
    expect(await exists(path.join(dest, "package.json"))).toBe(true);
  });

  it("prunes a stale file inside a directory the release still ships (recursion)", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(src, "lib/scanner/keep.ts", "export {};");
    await writeFile(dest, "lib/scanner/keep.ts", "export {};");
    await writeFile(dest, "lib/scanner/removed.ts", "// gone upstream");

    await pruneExtraneous(src, dest, pruneOpts);

    expect(await exists(path.join(dest, "lib/scanner/keep.ts"))).toBe(true);
    expect(await exists(path.join(dest, "lib/scanner/removed.ts"))).toBe(false);
  });

  it("refuses to run against an empty source tree (never wipes the install)", async () => {
    const src = await makeTempDir("vulnradar-src-");
    const dest = await makeTempDir("vulnradar-dest-");
    await writeFile(dest, "app/page.tsx", "export default () => null;");

    await expect(pruneExtraneous(src, dest, pruneOpts)).rejects.toThrow(
      /empty/i,
    );
    // Nothing was deleted.
    expect(await exists(path.join(dest, "app/page.tsx"))).toBe(true);
  });
});
