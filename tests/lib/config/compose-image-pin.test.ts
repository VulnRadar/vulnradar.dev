import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { APP_VERSION } from "@/lib/config/client-constants";

/**
 * docker-compose.yml pins the image tag by hand, and nothing bumps it.
 *
 * It sat at v3.8.0 while v3.8.1 was the published release, so every operator
 * who followed our own compose file installed the previous version and had no
 * way to notice: the file is correct-looking, the pull succeeds, and the app
 * starts. It is the single most-copied file we ship and the one place a stale
 * version silently becomes everyone's version.
 *
 * The pin is asserted against APP_VERSION rather than against the newest
 * GitHub release, because the file has to describe the tree it is in: check
 * out v3.9.0 and its compose file must say v3.9.0, whatever happens to be
 * published at the time.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function composeImageTags(file: string): string[] {
  const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
  return [...text.matchAll(/ghcr\.io\/vulnradar\/vulnradar:v([0-9.]+)/g)].map(
    (m) => m[1],
  );
}

describe("the published image pin tracks the app version", () => {
  it("pins the app service to this tree's version", () => {
    const tags = composeImageTags("docker-compose.yml");
    // Guards the regex: a rename that stops it matching would otherwise make
    // every assertion below vacuously true.
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(
        tag,
        `docker-compose.yml pins v${tag} but this tree is v${APP_VERSION}. ` +
          "Operators copy that file verbatim, so a stale pin installs the " +
          "wrong version for everyone who follows the docs.",
      ).toBe(APP_VERSION);
    }
  });
});
