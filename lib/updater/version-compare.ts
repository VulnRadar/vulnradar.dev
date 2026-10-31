/**
 * Pure comparison logic shared by GET /api/version and the admin Updater
 * endpoints (GET /api/v3/admin/updater/status). Extracted from
 * app/api/version/route.ts so both routes compare versions the same way
 * instead of maintaining two copies of the same comparison.
 *
 * Which of the three states applies is decided by compareSemver, so a
 * prerelease is older than the release it leads up to: 4.0.0-rc.1 is "behind"
 * 4.0.0, not "up-to-date".
 */

import { compareSemver, parseSemver } from "./semver";

export type VersionStatus = "up-to-date" | "behind" | "ahead" | "unknown";

export interface VersionComparison {
  status: VersionStatus;
  message: string;
}

// Fun messages for people somehow running a version from the future
const TIME_TRAVELER_MESSAGES = [
  "Whoa, you're running a version from the future! Can you tell us if we ever fix that one CSS bug?",
  "Nice try, time traveler. What's the stock market doing in your timeline?",
  "You're ahead of us... literally. Did the robots take over yet?",
  "Either you're from the future or you bumped the version manually. Either way, respect.",
  "Version from the future detected. Quick, what are the lottery numbers?",
  "Hold up, this version doesn't exist yet. Are you a wizard?",
  "Running unreleased code? You absolute legend.",
  "You're living in the future and we're still fixing merge conflicts.",
];

/**
 * How far behind `current` is, in words. Only the numeric core is looked at,
 * so a difference in the prerelease tag alone (4.0.0-rc.1 against 4.0.0) falls
 * through to the patch wording: the numbers are the same, only the tag moved.
 */
function behindMessage(current: string, latest: string): string {
  const [currentMajor = 0, currentMinor = 0] = parseSemver(current).core;
  const [latestMajor = 0, latestMinor = 0] = parseSemver(latest).core;
  const behindMajor = latestMajor - currentMajor;
  const behindMinor = latestMinor - currentMinor;
  if (behindMajor > 0) {
    return `You are ${behindMajor} major version${behindMajor > 1 ? "s" : ""} behind. Update strongly recommended.`;
  }
  if (behindMinor > 0) {
    return `A newer version (v${latest}) is available with new features and fixes.`;
  }
  return `A patch update (v${latest}) is available with bug fixes.`;
}

/**
 * Compares the running version against the latest release. Missing and
 * non-numeric parts are treated as 0, as the original inline logic in
 * app/api/version/route.ts did; see lib/updater/semver.ts for the ordering.
 */
export function compareVersions(
  current: string,
  latest: string,
): VersionComparison {
  const order = compareSemver(current, latest);

  if (order > 0) {
    return {
      status: "ahead",
      message:
        TIME_TRAVELER_MESSAGES[
          Math.floor(Math.random() * TIME_TRAVELER_MESSAGES.length)
        ],
    };
  }
  if (order < 0) {
    return { status: "behind", message: behindMessage(current, latest) };
  }
  return {
    status: "up-to-date",
    message: "You're running the latest version.",
  };
}
