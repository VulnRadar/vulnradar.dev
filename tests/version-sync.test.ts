import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_APP_VERSION } from "@/lib/config/config-values";

/**
 * The app version is written out by hand in four places, and nothing tied
 * them together.
 *
 *   package.json                 what the build and the release workflow use
 *   CONFIG_APP_VERSION           what the UI, the scan-note footer, the admin
 *                                panel and GET /api/version report
 *   docker-compose.yml           the image tag a self-hoster pulls
 *   SECURITY.md                  the supported-versions table, by major.minor
 *
 * A release that bumps one and forgets another does not fail anything. It
 * ships code from the new version while telling every reader it is the old
 * one, and the place that is worst is the one furthest from the developer: a
 * self-hoster reading /api/version to decide whether they need to update, or
 * an issue report carrying a version number that was never what was running.
 * SECURITY.md is the quiet one: left on the previous minor, the release it
 * ships in is formally unsupported for security reports on the day it ships.
 * There is no build step and no test that would have caught it.
 *
 * These are deliberately compared against package.json rather than against
 * each other, so the file the release process actually bumps is the source of
 * truth and the others follow it.
 *
 * The CLI (cli/package.json) and the extension (extension/package.json and
 * its manifests) are NOT checked here, and that is correct: they are
 * separately shippable products on their own version lines, the release
 * workflow reads each package.json independently to name its artifacts, and
 * the extension reads its own version live from
 * browser.runtime.getManifest(). Tying them to the app version would be
 * inventing a constraint the product does not have.
 */

const ROOT = path.resolve(__dirname, "..");

const packageVersion: string = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version;

describe("app version is the same fact everywhere it is written", () => {
  it("package.json carries a plain semver", () => {
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("CONFIG_APP_VERSION matches package.json", () => {
    expect(CONFIG_APP_VERSION).toBe(packageVersion);
  });

  // The pin once sat at v3.8.0 while v3.8.1 was the published release, so
  // everyone who followed our compose file installed the previous version with
  // nothing to notice: the pull succeeds and the app starts. It is compared to
  // this tree's version, not to the newest GitHub release, because the file
  // has to describe the tree it is in. (This was also asserted a second time,
  // word for word, in tests/lib/config/compose-image-pin.test.ts.)
  it("the docker-compose image tag matches package.json", () => {
    const compose = readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");

    // Every pinned vulnradar image in the file, including the one in the
    // upgrade instructions in the comments above the service. A reader
    // following those comments is as misled by a stale tag there as by a
    // stale tag on the `image:` line itself.
    const tags = [
      ...compose.matchAll(/ghcr\.io\/vulnradar\/vulnradar:v([\d.]+)/g),
    ].map((m) => m[1]);

    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toBe(packageVersion);
    }
  });

  // The table is keyed by major.minor ("4.0.x"), so a patch release never has
  // to touch it and a minor release always does. It sat on 3.9.x with the tree
  // at 4.0.0, which would have made the release itself "unsupported".
  describe("SECURITY.md supported versions", () => {
    const [major, minor] = packageVersion.split(".").map(Number);
    const security = readFileSync(path.join(ROOT, "SECURITY.md"), "utf8");

    it("lists the current major.minor as supported", () => {
      const supported = [
        ...security.matchAll(/^\|\s*(\d+\.\d+)\.x\s*\|\s*:white_check_mark:/gm),
      ].map((m) => m[1]);

      expect(supported).toContain(`${major}.${minor}`);
    });

    it("never marks the current major.minor as unsupported", () => {
      const unsupported = [
        ...security.matchAll(/^\|\s*(<\s*)?(\d+)\.(\d+)(?:\.x)?\s*\|\s*:x:/gm),
      ];
      expect(unsupported.length).toBeGreaterThan(0);

      for (const [row, floor, rowMajor, rowMinor] of unsupported) {
        const rowValue = Number(rowMajor) * 1000 + Number(rowMinor);
        const current = major * 1000 + minor;
        if (floor) {
          // "< 4.0" is a floor: everything below it, so it may equal the
          // current line but must not sit above it.
          expect(rowValue, row).toBeLessThanOrEqual(current);
        } else {
          expect(rowValue, row).not.toBe(current);
        }
      }
    });
  });
});
