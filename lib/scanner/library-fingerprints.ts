/**
 * Which client-side library, at which exact version, a script URL loads.
 *
 * Two checks read this: the static known-vulnerable table in
 * checks/page-checks/libraries.ts, which works offline, and the live OSV.dev
 * lookup in osv-check.ts. Each used to carry its own copy of these patterns
 * and they drifted: the static copy learned that jsDelivr and unpkg pin a
 * version as name@1.2.3 and that momentum.js is not Moment.js, the OSV copy
 * learned Vue, React, Alpine and GSAP, and neither knew what the other did.
 * One table now, so a library is either detected by both or by neither.
 *
 * Passive and safe by construction: this reads a URL and never fetches or
 * executes the script. A version the URL does not carry is not guessed.
 */

export interface LibraryFingerprint {
  name: string;
  /** The npm package name, which is also what OSV.dev is queried with. */
  npmPackage: string;
  /** Matches the library's identity in the resolved script URL. */
  filePattern: RegExp;
  /**
   * Extracts a full x.y.z version from the same URL. Accepts the ways CDNs
   * and build output encode one: jquery-1.12.4.min.js, jquery.1.12.4.js,
   * npm/jquery@1.12.4 (jsDelivr, unpkg, esm.sh) and cdnjs's
   * ajax/libs/jquery/1.12.4/ or lodash.js/4.17.15/ directories.
   */
  versionPattern: RegExp;
}

/** `name` followed by an optional `.js`, a separator, and x.y.z. */
function versionAfter(name: string): RegExp {
  return new RegExp(`${name}(?:\\.js)?[-.@/]?v?(\\d+\\.\\d+\\.\\d+)`, "i");
}

// Order matters only where one library's name contains another's: a script
// is matched by the first fingerprint whose file AND version patterns both
// match, so jQuery UI is listed before jQuery.
export const LIBRARY_FINGERPRINTS: readonly LibraryFingerprint[] = [
  {
    name: "DOMPurify",
    npmPackage: "dompurify",
    filePattern: /dompurify|purify(?:\.min)?\.js/i,
    versionPattern: versionAfter("dompurify"),
  },
  {
    name: "marked",
    npmPackage: "marked",
    filePattern: /(?:^|[/@-])marked(?:\.min)?\.js|marked[@/-]\d/i,
    versionPattern: versionAfter("marked"),
  },
  {
    name: "TinyMCE",
    npmPackage: "tinymce",
    filePattern: /tinymce/i,
    versionPattern: versionAfter("tinymce"),
  },
  {
    name: "Prism",
    npmPackage: "prismjs",
    filePattern: /prism(?:\.min)?\.js|prismjs|\/prism\//i,
    versionPattern: /prism(?:js)?(?:\.js)?[-.@/]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "jQuery UI",
    npmPackage: "jquery-ui",
    filePattern: /jquery-?ui/i,
    versionPattern: /jquery-?ui(?:\.js)?[-.@/]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "jQuery",
    npmPackage: "jquery",
    filePattern: /jquery(?!-?ui)/i,
    versionPattern: versionAfter("jquery"),
  },
  {
    name: "Bootstrap",
    npmPackage: "bootstrap",
    filePattern: /bootstrap/i,
    versionPattern: versionAfter("bootstrap"),
  },
  {
    name: "Lodash",
    npmPackage: "lodash",
    filePattern: /lodash/i,
    versionPattern: versionAfter("lodash"),
  },
  {
    name: "Moment.js",
    npmPackage: "moment",
    // Anchored so it does not also match momentum.js, which is a different
    // library that has never had Moment's CVEs.
    filePattern: /(?:^|[/@._-])moment(?:[@/._-]|$)/i,
    versionPattern: versionAfter("moment"),
  },
  {
    name: "Handlebars",
    npmPackage: "handlebars",
    filePattern: /handlebars/i,
    versionPattern: versionAfter("handlebars"),
  },
  {
    name: "Underscore.js",
    npmPackage: "underscore",
    filePattern: /underscore/i,
    versionPattern: versionAfter("underscore"),
  },
  {
    name: "Axios",
    npmPackage: "axios",
    filePattern: /axios/i,
    versionPattern: versionAfter("axios"),
  },
  {
    name: "Vue.js",
    npmPackage: "vue",
    filePattern: /\bvue[@/.]/i,
    versionPattern: /\bvue[@/-]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "React",
    npmPackage: "react",
    filePattern: /\breact(?!-dom)[@/.]/i,
    versionPattern: /\breact[@/-]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Alpine.js",
    npmPackage: "alpinejs",
    filePattern: /alpinejs/i,
    versionPattern: /alpinejs[@/-]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "GSAP",
    npmPackage: "gsap",
    filePattern: /\bgsap[@/.]/i,
    versionPattern: /gsap[@/-]?(\d+\.\d+\.\d+)/i,
  },
];

export interface DetectedLibrary {
  name: string;
  npmPackage: string;
  version: string;
}

/** The library and exact version a script URL loads, or null. */
export function detectLibrary(scriptUrl: string): DetectedLibrary | null {
  for (const fp of LIBRARY_FINGERPRINTS) {
    if (!fp.filePattern.test(scriptUrl)) continue;
    const m = scriptUrl.match(fp.versionPattern);
    if (!m) continue;
    return { name: fp.name, npmPackage: fp.npmPackage, version: m[1] };
  }
  return null;
}

/**
 * The finding `component` for a detected library: `npm-package@version`.
 * Both library checks set it, which is what lets dedupe merge their two
 * findings about one library without merging two different libraries.
 */
export function libraryComponent(lib: DetectedLibrary): string {
  return `${lib.npmPackage}@${lib.version}`;
}

/**
 * True when dotted version `a` sorts below `b`, comparing numeric parts left
 * to right and treating a missing part as 0. Not full semver: a prerelease
 * suffix is read as further numeric parts. Shared by both library checks and
 * by framework-fingerprint.ts, which compares CMS core versions.
 */
export function versionBelow(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
