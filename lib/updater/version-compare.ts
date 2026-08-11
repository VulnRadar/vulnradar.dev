/**
 * Pure semver-ish comparison logic shared by GET /api/version and the
 * admin Updater endpoints (GET /api/v3/admin/updater/status). Extracted
 * from app/api/version/route.ts so both routes compare versions the same
 * way instead of maintaining two copies of the same three-part comparison.
 */

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

function parseVersionParts(version: string): number[] {
  return version.split(".").map(Number);
}

/**
 * Compares two "X.Y.Z"-shaped version strings. Missing/non-numeric parts
 * are treated as 0 (matches the original inline logic in
 * app/api/version/route.ts, which never validated its inputs either).
 */
export function compareVersions(
  current: string,
  latest: string,
): VersionComparison {
  const currentParts = parseVersionParts(current);
  const latestParts = parseVersionParts(latest);

  let status: VersionStatus = "unknown";
  let message = "";

  for (let i = 0; i < 3; i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (c > l) {
      status = "ahead";
      message =
        TIME_TRAVELER_MESSAGES[
          Math.floor(Math.random() * TIME_TRAVELER_MESSAGES.length)
        ];
      break;
    }
    if (c < l) {
      status = "behind";
      const behindMajor = latestParts[0] - currentParts[0];
      const behindMinor = latestParts[1] - currentParts[1];
      if (behindMajor > 0) {
        message = `You are ${behindMajor} major version${behindMajor > 1 ? "s" : ""} behind. Update strongly recommended.`;
      } else if (behindMinor > 0) {
        message = `A newer version (v${latest}) is available with new features and fixes.`;
      } else {
        message = `A patch update (v${latest}) is available with bug fixes.`;
      }
      break;
    }
  }

  if (status === "unknown") {
    status = "up-to-date";
    message = "You're running the latest version.";
  }

  return { status, message };
}
