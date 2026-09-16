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

/** cdnjs and Google Hosted Libraries: /ajax/libs/<package>/<version>/. */
const HOSTED_LIBRARY_PATH = /\/ajax\/libs\/([^/?#]+)\/v?\d+\.\d+\.\d+\//i;

/**
 * WordPress core registers each vendor library it bundles with that
 * library's own version as `?ver=`, as in
 * /wp-includes/js/jquery/jquery.min.js?ver=3.7.1. Anywhere else `?ver=` is a
 * theme's or plugin's own version or a cache key, so it is only read under
 * /wp-includes/js/ and only for the file that is the library itself:
 * jquery-migrate.min.js?ver=3.4.1 is not jQuery 3.4.1.
 */
const WORDPRESS_CORE_FILES: Readonly<Record<string, RegExp>> = {
  jquery: /^jquery(?:\.min)?\.js$/i,
  underscore: /^underscore(?:\.min)?\.js$/i,
  lodash: /^lodash(?:\.min)?\.js$/i,
  moment: /^moment(?:\.min)?\.js$/i,
  react: /^react(?:\.min)?\.js$/i,
};
const WORDPRESS_CORE_VERSION =
  /\/wp-includes\/js\/[^?#]*\?(?:[^#]*&)?ver=(\d+\.\d+\.\d+)/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the URL loads the library itself rather than something that sits
 * next to it. The library has to be the file, the package a CDN URL pins as
 * name@x.y.z, or the package directory of a hosted-library path. A directory
 * that merely shares the name is not enough: /assets/bootstrap/3.2.0/init.js
 * is a site's own start-up script, and it was reported as Bootstrap 3.2.0
 * with Bootstrap's CVEs named against it.
 */
function loadsLibrary(fp: LibraryFingerprint, scriptUrl: string): boolean {
  const path = scriptUrl.split(/[?#]/, 1)[0];
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  if (fp.filePattern.test(fileName)) return true;
  const pinned = new RegExp(
    `(?:^|/)${escapeRegExp(fp.npmPackage)}@v?\\d+\\.\\d+\\.\\d+`,
    "i",
  );
  if (pinned.test(path)) return true;
  const hosted = HOSTED_LIBRARY_PATH.exec(path);
  return !!hosted && fp.filePattern.test(`${hosted[1]}/`);
}

/** The library and exact version a script URL loads, or null. */
export function detectLibrary(scriptUrl: string): DetectedLibrary | null {
  for (const fp of LIBRARY_FINGERPRINTS) {
    if (!fp.filePattern.test(scriptUrl)) continue;
    if (!loadsLibrary(fp, scriptUrl)) continue;
    const version =
      scriptUrl.match(fp.versionPattern)?.[1] ??
      wordpressCoreVersion(fp, scriptUrl);
    if (!version) continue;
    return { name: fp.name, npmPackage: fp.npmPackage, version };
  }
  return null;
}

function wordpressCoreVersion(
  fp: LibraryFingerprint,
  scriptUrl: string,
): string | undefined {
  const file = WORDPRESS_CORE_FILES[fp.npmPackage];
  if (!file) return undefined;
  const path = scriptUrl.split(/[?#]/, 1)[0];
  if (!file.test(path.slice(path.lastIndexOf("/") + 1))) return undefined;
  return WORDPRESS_CORE_VERSION.exec(scriptUrl)?.[1];
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
 * True when version `a` sorts below `b`, in semver order: numeric parts left
 * to right with a missing part read as 0, then a prerelease below the release
 * it leads up to. Shared by both library checks, the OSV interval logic and
 * framework-fingerprint.ts, which compares CMS core versions.
 *
 * The prerelease used to be read as more numeric parts, so 2.0.0 sorted below
 * 2.0.0-rc.1 and a site on 2.0.0 was reported for an advisory fixed in that
 * release candidate. A leading "v" is ignored rather than read as 0.
 */
export function versionBelow(a: string, b: string): boolean {
  return compareVersions(a, b) < 0;
}

function parseVersion(v: string): { core: number[]; pre: string[] | null } {
  const bare = v.trim().replace(/^v/i, "").split("+", 1)[0];
  const dash = bare.indexOf("-");
  const core = (dash === -1 ? bare : bare.slice(0, dash))
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pre = dash === -1 ? "" : bare.slice(dash + 1);
  return { core, pre: pre ? pre.split(".") : null };
}

function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < Math.max(va.core.length, vb.core.length); i++) {
    const d = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
    if (d !== 0) return d;
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
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
