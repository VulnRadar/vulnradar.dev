/**
 * Semantic-version ordering: the one answer to "is this version newer".
 *
 * Six places asked it: the admin updater and GET /api/version
 * (version-compare.ts), the boot banner (database/boot/release-check.ts), the
 * schema gate (database/boot/schema-version.ts), the health probe, the
 * library fingerprints (scanner/library-fingerprints.ts) and an inline triple
 * compare in checks/content.ts. Only the scanner's copy knew about
 * prereleases, so the app's own checks read 4.0.0-rc.1 as 4.0.0 and told a
 * release-candidate install it was up to date on the day 4.0.0 shipped.
 *
 * Order is semver.org's: the dotted numeric core left to right, a missing part
 * read as 0; then a prerelease sorts below the release it leads up to;
 * prerelease identifiers are compared one by one, numbers numerically and
 * below words, words as text, and a list below any longer list that starts
 * the same. Build metadata after `+` is ignored, and so is a leading `v`.
 * Anything that is not a number reads as 0, so a malformed string sorts low
 * instead of throwing: callers hand this whatever a CDN path, a GitHub tag or
 * a database column contained.
 */

export interface ParsedSemver {
  /** The dotted numeric core: 4.0.0 is [4, 0, 0]. Never empty. */
  core: number[];
  /** Prerelease identifiers (4.0.0-rc.1 is ["rc", "1"]); null for a release. */
  pre: string[] | null;
}

export function parseSemver(version: string): ParsedSemver {
  const bare = version.trim().replace(/^v/i, "").split("+", 1)[0];
  const dash = bare.indexOf("-");
  const core = (dash === -1 ? bare : bare.slice(0, dash))
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pre = dash === -1 ? "" : bare.slice(dash + 1);
  return { core, pre: pre ? pre.split(".") : null };
}

/** -1 when `a` is older than `b`, 1 when it is newer, 0 when they are equal. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const va = parseSemver(a);
  const vb = parseSemver(b);

  for (let i = 0; i < Math.max(va.core.length, vb.core.length); i++) {
    const d = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }

  if (!va.pre || !vb.pre) {
    if (va.pre === vb.pre) return 0;
    return va.pre ? -1 : 1;
  }

  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
