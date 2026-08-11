import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyTreeOverlay } from "@/lib/updater/copy-with-excludes";

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
