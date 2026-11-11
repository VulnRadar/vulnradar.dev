import type { VersionKind } from "./types";

/**
 * Version handling for the fingerprint engine.
 *
 * The question this module answers is not "what does the page say" but "is it
 * safe to ask a vulnerability database about it". A single number such as
 * "Drupal 10" is true and worth showing, but NVD reads it as 10.0 and answers
 * with every advisory whose range contains that, so only `exact` versions are
 * eligible for a lookup.
 */

const DEFAULT_MIN_COMPONENTS = 3;
const MAX_RAW_LENGTH = 64;

/**
 * Words after the number that mark a build that is not a release. Anything
 * else after the number ("-0ubuntu1", "-fips", "+deb11u2") is a packaging
 * suffix on a release, which does not change which release it is.
 */
const PRERELEASE_WORD =
  /^[-_.+~]?(?:alpha|beta|rc|dev|pre|preview|snapshot|nightly|canary|next|a\d|b\d)/i;

export interface NormalizedVersion {
  /** The numeric dotted part, plus a trailing patch letter ("1.1.1f"). */
  version: string;
  kind: VersionKind;
}

/**
 * Reduce a raw version string to its release and say how far to trust it.
 *
 * - "10" is `major`; "6.4" is `exact` with `minComponents` 2 and `partial` with 3.
 * - "7.2-beta3-65106" is 7.2, `prerelease`.
 * - "1.1.1f" is `exact` with the letter kept: it is a different release from 1.1.1.
 * - "v5.3" is 5.3.
 * - A packaging suffix is dropped: "1.18.0-0ubuntu1" is 1.18.0.
 *
 * Returns null when there is no leading number at all.
 */
export function normalizeVersion(
  raw: string,
  minComponents: number = DEFAULT_MIN_COMPONENTS,
): NormalizedVersion | null {
  const text = raw
    .trim()
    .slice(0, MAX_RAW_LENGTH)
    .replace(/^v(?=\d)/i, "");
  const numeric = /^\d+(?:\.\d+)*/.exec(text);
  if (!numeric) return null;

  let version = numeric[0];
  const rest = text.slice(version.length);

  // Checked before the patch letter is read: "1.2.3a1" is an alpha, not 1.2.3a.
  const prerelease = PRERELEASE_WORD.test(rest) || /^[a-z]{2,}/i.test(rest);

  // A single patch letter directly after the number, not the start of a word.
  const letter = prerelease ? null : /^[a-z](?![a-z])/i.exec(rest);
  if (letter) version += letter[0].toLowerCase();

  const parts = numeric[0].split(".").length;
  if (prerelease) return { version, kind: "prerelease" };
  if (parts === 1 && !letter) return { version, kind: "major" };
  return {
    version,
    kind: parts >= Math.max(minComponents, 2) ? "exact" : "partial",
  };
}

/** A version one rule read, with the weight of the rule that read it. */
export interface VersionCandidate {
  version: string;
  kind: VersionKind;
  weight: number;
}

/** Two rules at or above this weight that disagree make the version partial. */
export const STRONG_RULE_WEIGHT = 80;

/**
 * Pick the version to report from everything the rules read.
 *
 * The highest-weight rule wins, the earlier rule on a tie. When two rules at
 * {@link STRONG_RULE_WEIGHT} or more name different versions the winner is
 * still shown but is marked `partial`, because one of two confident sources is
 * wrong and a lookup on the wrong one is a false finding.
 */
export function chooseVersion<T extends VersionCandidate>(
  candidates: readonly T[],
): T | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.weight > best.weight) best = candidate;
  }
  const conflict = candidates.some(
    (candidate) =>
      candidate.weight >= STRONG_RULE_WEIGHT &&
      best.weight >= STRONG_RULE_WEIGHT &&
      candidate.version.toLowerCase() !== best.version.toLowerCase(),
  );
  return conflict ? ({ ...best, kind: "partial" } as T) : best;
}
