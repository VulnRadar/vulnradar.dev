/**
 * Types for the data-driven software fingerprint engine.
 *
 * A product is one `Fingerprint` entry in a table plus a fixture under
 * tests/fixtures/inventory/. The engine in ./engine.ts reads the table; no
 * product has its own code path. This file holds only types and the few
 * constants the types need, so a data module can import it without pulling in
 * the engine.
 */

export type SoftwareCategory =
  | "server"
  | "language"
  | "runtime"
  | "framework"
  | "cms"
  | "cdn"
  | "library"
  /** Billing, hosting and control panels, phpMyAdmin. */
  | "panel"
  /** Magento, WooCommerce, PrestaShop, OpenCart, Shopify. */
  | "ecommerce"
  /** Moodle, Redmine and other hosted web apps. */
  | "application";

/**
 * Where a rule came from.
 *
 * - `fixture`: seen in a real or hand-built response saved under
 *   tests/fixtures/inventory/.
 * - `wappalyzer`: taken from the webappanalyzer open data set (GPL-3.0).
 * - `vendor-docs`: written from vendor documentation with no capture behind
 *   it. Its weight is capped (see {@link VENDOR_DOCS_MAX_WEIGHT}) until a
 *   fixture backs it, so an unproven product can only ever show as "likely"
 *   and never reaches a CVE lookup.
 */
export type RuleProvenance = "fixture" | "wappalyzer" | "vendor-docs";

/**
 * Metadata for a rule that was derived from an upstream data set. The engine
 * never reads it for matching: it exists so a notices file and a refresh
 * script can tell which rules came from where. Absent on our own rules.
 */
export interface RuleSource {
  upstream: "webappanalyzer";
  /** The technology's name in the upstream data set. */
  technology: string;
}

/** The highest weight a `vendor-docs` rule may carry. */
export const VENDOR_DOCS_MAX_WEIGHT = 80;

/** Highest and lowest weight a rule may carry. 100 is reserved for `implies`. */
export const MIN_RULE_WEIGHT = 1;
export const MAX_RULE_WEIGHT = 99;

interface Weighted {
  /** P(product | this rule alone), 1..99. */
  weight: number;
  provenance: RuleProvenance;
  /** Set on rules derived from an upstream data set; never read by matching. */
  source?: RuleSource;
}

/**
 * Which capture group holds a version, and how many numeric components make
 * it exact. `minComponents` defaults to 3; WordPress needs 2 because it
 * prints `6.4` for the first 6.4 release.
 */
export interface VersionCapture {
  version?: { group: number; minComponents?: number };
}

export type Rule = Weighted &
  (
    | ({ in: "header"; name: string; match?: RegExp } & VersionCapture)
    /** The value is tested, never stored and never reported. */
    | { in: "cookie"; name: string | RegExp; valueMatch?: RegExp }
    /** Matches a meta tag's `name` or `property`. */
    | ({ in: "meta"; name: string; match?: RegExp } & VersionCapture)
    /** script src, link href, and same-origin a/form/img URLs. */
    | ({ in: "asset"; match: RegExp } & VersionCapture)
    /** An attribute NAME on any tag (`wire:click`, `x-data`), optionally its value. */
    | ({
        in: "attr";
        name: string | RegExp;
        tag?: string;
        match?: RegExp;
      } & VersionCapture)
    /** Bounded and linear, the last resort. Runs once over the whole body. */
    | ({ in: "html"; match: RegExp } & VersionCapture)
    | ({ in: "title"; match: RegExp } & VersionCapture)
    | ({ in: "comment"; match: RegExp } & VersionCapture)
  );

export type RuleKind = Rule["in"];

/** A product the matched product implies, such as PHP from Laravel. */
export interface Implied {
  name: string;
  category: SoftwareCategory;
  /** 1..100, default 100: how sure the implication is when the source is certain. */
  weight?: number;
}

export interface Fingerprint {
  /** Canonical display name. Also the TechIcon key and the CVE map key. */
  name: string;
  category: SoftwareCategory;
  /** At least one. */
  rules: readonly Rule[];
  implies?: readonly Implied[];
  /** Rules only run once these products were found at the display floor or above. */
  requires?: readonly string[];
  notes?: string;
}

/**
 * How trustworthy a version is for a vulnerability lookup.
 *
 * - `exact`: enough numeric components to name one release.
 * - `major`: a single number ("Drupal 10"). Shown, never looked up: NVD reads
 *   "10" as 10.0 and answers with every range that contains it.
 * - `partial`: fewer components than the product needs, or two strong rules
 *   that disagree.
 * - `prerelease`: an alpha, beta, release candidate or similar build.
 */
export type VersionKind = "exact" | "major" | "partial" | "prerelease";

export interface Detection {
  name: string;
  category: SoftwareCategory;
  /** 0..100, the noisy-OR of the weights of the matching rules. */
  confidence: number;
  version?: string;
  versionKind?: VersionKind;
  /** The distro token from the Server header parentheses, such as "Ubuntu". */
  patchedBy?: string;
  /**
   * Labels only, strongest first: "cookie wslatl-llc-session",
   * "asset /livewire-3f8a23f8/livewire.min.js", "implied by Laravel". Never a
   * cookie value, a query string or a token.
   */
  evidence: string[];
}

/** One attribute seen on one tag, for `attr` rules. */
export interface InventoryAttribute {
  /** Lowercased tag name. */
  tag: string;
  /** Lowercased attribute name. */
  name: string;
  value: string;
}

/**
 * The response reduced to what rules can read, built once per page by
 * `buildInventoryInput`. Cookie values live here so `valueMatch` can test them
 * and nowhere else: no detection carries one.
 */
export interface InventoryInput {
  /** Lowercased header name to every value. Set-Cookie is in `cookies`, not here. */
  headers: ReadonlyMap<string, readonly string[]>;
  cookies: readonly { name: string; value: string }[];
  /** Every meta tag's `name` and `property`, lowercased, with its content. */
  metas: readonly { name: string; content: string }[];
  /**
   * Same-origin URLs as path plus query, other origins as the full URL.
   * Includes script src and link href of any origin and the a/form/img URLs of
   * the page's own origin.
   */
  assets: readonly string[];
  attributes: readonly InventoryAttribute[];
  title: string;
  comments: readonly string[];
  /** The body, capped at 1 MiB, for `html` rules. */
  body: string;
}
