import {
  MAX_RULE_WEIGHT,
  MIN_RULE_WEIGHT,
  VENDOR_DOCS_MAX_WEIGHT,
  type Detection,
  type Fingerprint,
  type InventoryInput,
  type Rule,
  type SoftwareCategory,
} from "./types";
import {
  chooseVersion,
  normalizeVersion,
  type VersionCandidate,
} from "./version";

/**
 * The fingerprint engine: `detect(input, table)` turns one response (see
 * ./input.ts) and a table of fingerprints into detections.
 *
 * Evidence is weighted and combined, so no single weak signal names a product:
 * every matching rule is an independent chance that the product is there, and
 * the confidence is the chance that at least one of them is right (noisy-OR).
 * Products imply other products (Laravel implies PHP), and the implication is
 * recomputed from the current confidences each round, so a strong detection
 * found late lifts what a weak one implied early.
 */

/** Detections below this confidence are dropped. */
export const DISPLAY_FLOOR = 60;
/** From here up a detection is shown plain; between the floor and this, "likely". */
export const CERTAIN_CONFIDENCE = 90;
/** A vulnerability lookup needs this confidence AND an exact version. */
export const LOOKUP_MIN_CONFIDENCE = 90;

const MAX_IMPLY_ROUNDS = 4;
const MAX_EVIDENCE = 12;
const MAX_LABEL_CHARS = 100;

/**
 * Most important first, so a cap on the number of items keeps the products a
 * reader cares about (what runs the site) over the ones that merely load on
 * it.
 */
export const CATEGORY_PRIORITY: readonly SoftwareCategory[] = [
  "panel",
  "cms",
  "ecommerce",
  "application",
  "framework",
  "server",
  "language",
  "runtime",
  "cdn",
  "library",
];

/** Distro vendors whose packaging backports security fixes without bumping the version. */
const DISTROS: readonly [RegExp, string][] = [
  [/^ubuntu\b/i, "Ubuntu"],
  [/^debian\b/i, "Debian"],
  [/^raspbian\b/i, "Raspbian"],
  [/^centos\b/i, "CentOS"],
  [/^red ?hat\b|^rhel\b/i, "Red Hat"],
  [/^fedora\b/i, "Fedora"],
  [/^alpine\b/i, "Alpine"],
  [/^(?:open)?suse\b|^sles\b/i, "SUSE"],
  [/^rocky\b/i, "Rocky Linux"],
  [/^alma(?:linux)?\b/i, "AlmaLinux"],
  [/^amazon\b/i, "Amazon Linux"],
  [/^oracle\b/i, "Oracle Linux"],
];

// ── The compiled table ──────────────────────────────────────────────────────

/** A table after `compileTable`: rules normalized, products indexed by name. */
export interface RuleTable {
  readonly fingerprints: readonly Fingerprint[];
  readonly byName: ReadonlyMap<string, Fingerprint>;
}

function plainRegExp(re: RegExp): RegExp {
  // exec() on a global or sticky regex starts at lastIndex, which carries over
  // between inputs. A rule written with /g (copied from the code it replaced)
  // would then miss or hit depending on what the previous page was.
  return re.global || re.sticky
    ? new RegExp(re.source, re.flags.replace(/[gy]/g, ""))
    : re;
}

function compileRule(rule: Rule): Rule {
  const next = { ...rule } as Record<string, unknown>;
  for (const key of ["match", "valueMatch"] as const) {
    const value = next[key];
    if (value instanceof RegExp) next[key] = plainRegExp(value);
  }
  if (rule.in === "header" || rule.in === "meta") {
    next.name = rule.name.toLowerCase();
  }
  if (rule.in === "cookie" && rule.name instanceof RegExp) {
    next.name = plainRegExp(rule.name);
  }
  if (rule.in === "attr") {
    if (typeof rule.name === "string") next.name = rule.name.toLowerCase();
    else next.name = plainRegExp(rule.name);
    if (rule.tag) next.tag = rule.tag.toLowerCase();
  }
  return next as unknown as Rule;
}

/**
 * Normalize a table once so matching never has to: regexes lose their global
 * and sticky flags and header, meta and attribute names are lowercased. Every
 * rule keeps all of its other fields, including `source`, which the engine
 * never reads.
 */
export function compileTable(table: readonly Fingerprint[]): RuleTable {
  const fingerprints = table.map((fingerprint) => ({
    ...fingerprint,
    rules: fingerprint.rules.map(compileRule),
  }));
  const byName = new Map<string, Fingerprint>();
  for (const fingerprint of fingerprints) {
    if (!byName.has(fingerprint.name))
      byName.set(fingerprint.name, fingerprint);
  }
  return { fingerprints, byName };
}

const compiled = new WeakMap<readonly Fingerprint[], RuleTable>();

function tableFor(table: readonly Fingerprint[] | RuleTable): RuleTable {
  if (!Array.isArray(table)) return table as RuleTable;
  const source = table as readonly Fingerprint[];
  let result = compiled.get(source);
  if (!result) {
    result = compileTable(source);
    compiled.set(source, result);
  }
  return result;
}

/**
 * Problems in a table, as sentences. Empty when it is sound. A data module's
 * registry test asserts this is empty; the engine itself never refuses a
 * table, because a scan must produce a result for whatever it is given.
 */
export function validateTable(table: readonly Fingerprint[]): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const fingerprint of table) {
    const where = fingerprint.name || "(unnamed)";
    if (!fingerprint.name) problems.push("a fingerprint has no name");
    if (names.has(fingerprint.name)) {
      problems.push(`${where}: name is not unique`);
    }
    names.add(fingerprint.name);
    if (fingerprint.rules.length === 0) problems.push(`${where}: no rules`);
    for (const rule of fingerprint.rules) {
      const label = `${where}: ${rule.in} rule`;
      if (
        !Number.isInteger(rule.weight) ||
        rule.weight < MIN_RULE_WEIGHT ||
        rule.weight > MAX_RULE_WEIGHT
      ) {
        problems.push(
          `${label}: weight ${rule.weight} is outside ${MIN_RULE_WEIGHT}..${MAX_RULE_WEIGHT}`,
        );
      }
      if (
        rule.provenance === "vendor-docs" &&
        rule.weight > VENDOR_DOCS_MAX_WEIGHT
      ) {
        problems.push(
          `${label}: a vendor-docs rule is capped at ${VENDOR_DOCS_MAX_WEIGHT} until a fixture backs it`,
        );
      }
      if (rule.source && rule.source.technology.trim() === "") {
        problems.push(`${label}: source names no technology`);
      }
      if ("version" in rule && rule.version) {
        if (!Number.isInteger(rule.version.group) || rule.version.group < 1) {
          problems.push(`${label}: version group must be a capture group`);
        }
      }
    }
  }
  const known = new Set(names);
  for (const fingerprint of table) {
    for (const implied of fingerprint.implies ?? []) known.add(implied.name);
  }
  for (const fingerprint of table) {
    for (const required of fingerprint.requires ?? []) {
      if (!known.has(required)) {
        problems.push(
          `${fingerprint.name}: requires ${required}, which no entry provides`,
        );
      }
    }
  }
  return problems;
}

// ── Matching ────────────────────────────────────────────────────────────────

interface RuleHit {
  weight: number;
  /** A label, never a cookie value, a query string or a token. */
  label: string;
  version?: VersionCandidate & { headerName?: string; headerValue?: string };
}

/** Printable ASCII only and bounded, so a label cannot carry markup or a secret by length. */
function safeLabel(text: string): string {
  return text.replace(/[^ -~]/g, "").slice(0, MAX_LABEL_CHARS);
}

/** An asset's path with its host, query and fragment removed. */
function assetPath(url: string): string {
  let path = url;
  if (!path.startsWith("/")) {
    const scheme = path.indexOf("://");
    if (scheme > 0) {
      const slash = path.indexOf("/", scheme + 3);
      path = slash < 0 ? "/" : path.slice(slash);
    }
  }
  const cut = path.search(/[?#]/);
  return safeLabel(cut < 0 ? path : path.slice(0, cut));
}

function readVersion(
  rule: Rule,
  match: RegExpExecArray,
): VersionCandidate | undefined {
  if (!("version" in rule) || !rule.version) return undefined;
  const raw = match[rule.version.group];
  if (typeof raw !== "string") return undefined;
  const normalized = normalizeVersion(raw, rule.version.minComponents);
  if (!normalized) return undefined;
  return { ...normalized, weight: rule.weight };
}

/** The first time `re` matches `text`, or a hit with no capture when there is no `re`. */
function test(
  re: RegExp | undefined,
  text: string,
): RegExpExecArray | null | true {
  if (!re) return true;
  re.lastIndex = 0;
  return re.exec(text);
}

function hit(
  rule: Rule,
  label: string,
  result: RegExpExecArray | true,
  extra?: { headerName: string; headerValue: string },
): RuleHit {
  const version = result === true ? undefined : readVersion(rule, result);
  return {
    weight: rule.weight,
    label,
    version: version ? { ...version, ...extra } : undefined,
  };
}

function matchRule(rule: Rule, input: InventoryInput): RuleHit | null {
  switch (rule.in) {
    case "header": {
      for (const value of input.headers.get(rule.name) ?? []) {
        const result = test(rule.match, value);
        if (result) {
          return hit(rule, safeLabel(`header ${rule.name}`), result, {
            headerName: rule.name,
            headerValue: value,
          });
        }
      }
      return null;
    }
    case "cookie": {
      for (const cookie of input.cookies) {
        const nameMatches =
          typeof rule.name === "string"
            ? cookie.name === rule.name
            : test(rule.name, cookie.name);
        if (!nameMatches) continue;
        if (rule.valueMatch && !test(rule.valueMatch, cookie.value)) continue;
        // The name only: the value is session material and the inventory is public.
        return hit(rule, safeLabel(`cookie ${cookie.name}`), true);
      }
      return null;
    }
    case "meta": {
      for (const meta of input.metas) {
        if (meta.name !== rule.name) continue;
        const result = test(rule.match, meta.content);
        if (result) return hit(rule, safeLabel(`meta ${rule.name}`), result);
      }
      return null;
    }
    case "asset": {
      for (const asset of input.assets) {
        const result = test(rule.match, asset);
        if (result) {
          return hit(rule, safeLabel(`asset ${assetPath(asset)}`), result);
        }
      }
      return null;
    }
    case "attr": {
      for (const attribute of input.attributes) {
        if (rule.tag && attribute.tag !== rule.tag) continue;
        const nameMatches =
          typeof rule.name === "string"
            ? attribute.name === rule.name
            : test(rule.name, attribute.name);
        if (!nameMatches) continue;
        const result = test(rule.match, attribute.value);
        if (result) {
          return hit(
            rule,
            safeLabel(`attribute ${attribute.tag} ${attribute.name}`),
            result,
          );
        }
      }
      return null;
    }
    case "html": {
      const result = test(rule.match, input.body);
      return result ? hit(rule, "page markup", result) : null;
    }
    case "title": {
      const result = test(rule.match, input.title);
      return result ? hit(rule, "page title", result) : null;
    }
    case "comment": {
      for (const comment of input.comments) {
        const result = test(rule.match, comment);
        if (result) return hit(rule, "html comment", result);
      }
      return null;
    }
    default:
      return null;
  }
}

function evaluate(fingerprint: Fingerprint, input: InventoryInput): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of fingerprint.rules) {
    try {
      const result = matchRule(rule, input);
      if (result) hits.push(result);
    } catch {
      // A rule that throws (a malformed table entry) is skipped; the rest of
      // the table still runs.
    }
  }
  return hits;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * The chance that at least one of independent signals is right, 0..100:
 * `100 * (1 - product(1 - w/100))`.
 */
export function noisyOr(weights: readonly number[]): number {
  let miss = 1;
  for (const weight of weights) {
    miss *= 1 - Math.min(Math.max(weight, 0), 100) / 100;
  }
  return Math.round(100 * (1 - miss));
}

interface ImpliedEvidence {
  from: string;
  weight: number;
  category: SoftwareCategory;
}

function confidencesOf(
  direct: ReadonlyMap<string, RuleHit[]>,
  implied: ReadonlyMap<string, ImpliedEvidence[]>,
): Map<string, number> {
  const names = new Set([...direct.keys(), ...implied.keys()]);
  const out = new Map<string, number>();
  for (const name of names) {
    out.set(
      name,
      noisyOr([
        ...(direct.get(name) ?? []).map((h) => h.weight),
        ...(implied.get(name) ?? []).map((e) => e.weight),
      ]),
    );
  }
  return out;
}

/**
 * What each detected product implies, from the confidences of this round.
 *
 * A source's confidence leaves out whatever the target itself implied about
 * it: two products that imply each other would otherwise lift one another to
 * certainty from a single weak signal.
 */
function impliedFrom(
  table: RuleTable,
  direct: ReadonlyMap<string, RuleHit[]>,
  previous: ReadonlyMap<string, ImpliedEvidence[]>,
  confidences: ReadonlyMap<string, number>,
): Map<string, ImpliedEvidence[]> {
  const next = new Map<string, ImpliedEvidence[]>();
  for (const [source, confidence] of confidences) {
    if (confidence < DISPLAY_FLOOR) continue;
    const fingerprint = table.byName.get(source);
    if (!fingerprint?.implies) continue;
    for (const target of fingerprint.implies) {
      const independent = noisyOr([
        ...(direct.get(source) ?? []).map((h) => h.weight),
        ...(previous.get(source) ?? [])
          .filter((e) => e.from !== target.name)
          .map((e) => e.weight),
      ]);
      if (independent < DISPLAY_FLOOR) continue;
      const share = Math.min(Math.max(target.weight ?? 100, 1), 100);
      const list = next.get(target.name) ?? [];
      list.push({
        from: source,
        weight: Math.round((independent * share) / 100),
        category: target.category,
      });
      next.set(target.name, list);
    }
  }
  return next;
}

function impliedKey(map: ReadonlyMap<string, ImpliedEvidence[]>): string {
  return [...map]
    .map(
      ([name, list]) =>
        `${name}=${list
          .map((e) => `${e.from}:${e.weight}`)
          .sort()
          .join(",")}`,
    )
    .sort()
    .join(";");
}

function distroOf(serverHeader: string): string | undefined {
  for (const match of serverHeader.matchAll(/\(([^()]{1,40})\)/g)) {
    const token = match[1].trim();
    for (const [pattern, name] of DISTROS) {
      if (pattern.test(token)) return name;
    }
  }
  return undefined;
}

export interface DetectOptions {
  /** Lowest confidence to return. Defaults to {@link DISPLAY_FLOOR}. */
  floor?: number;
}

function run(
  input: InventoryInput,
  table: RuleTable,
  options: DetectOptions,
): Detection[] {
  const floor = options.floor ?? DISPLAY_FLOOR;
  const direct = new Map<string, RuleHit[]>();
  const pending: Fingerprint[] = [];

  const evaluateInto = (fingerprint: Fingerprint) => {
    const hits = evaluate(fingerprint, input);
    if (hits.length === 0) return;
    direct.set(fingerprint.name, [
      ...(direct.get(fingerprint.name) ?? []),
      ...hits,
    ]);
  };

  for (const fingerprint of table.fingerprints) {
    if (fingerprint.requires?.length) pending.push(fingerprint);
    else evaluateInto(fingerprint);
  }

  let implied = new Map<string, ImpliedEvidence[]>();
  for (let round = 0; round < MAX_IMPLY_ROUNDS; round++) {
    let confidences = confidencesOf(direct, implied);

    // A product whose rules wait on another is evaluated only once what it
    // requires is there, so its rules cost nothing on pages that lack it.
    let evaluatedAny = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const fingerprint = pending[i];
      const met = (fingerprint.requires ?? []).every(
        (name) => (confidences.get(name) ?? 0) >= DISPLAY_FLOOR,
      );
      if (!met) continue;
      pending.splice(i, 1);
      evaluateInto(fingerprint);
      evaluatedAny = true;
    }
    if (evaluatedAny) confidences = confidencesOf(direct, implied);

    const next = impliedFrom(table, direct, implied, confidences);
    const stable = !evaluatedAny && impliedKey(next) === impliedKey(implied);
    implied = next;
    if (stable) break;
  }

  const confidences = confidencesOf(direct, implied);
  const detections: Detection[] = [];
  for (const [name, confidence] of confidences) {
    if (confidence < floor) continue;
    const fingerprint = table.byName.get(name);
    const hits = direct.get(name) ?? [];
    const impliedBy = implied.get(name) ?? [];
    const category = fingerprint?.category ?? impliedBy[0]?.category;
    if (!category) continue;

    const evidence = [
      ...hits.map((h) => ({ weight: h.weight, label: h.label })),
      ...impliedBy.map((e) => ({
        weight: e.weight,
        label: safeLabel(`implied by ${e.from}`),
      })),
    ]
      .sort((a, b) => b.weight - a.weight)
      .map((e) => e.label)
      .filter((label, index, all) => all.indexOf(label) === index)
      .slice(0, MAX_EVIDENCE);

    const chosen = chooseVersion(
      hits.flatMap((h) => (h.version ? [h.version] : [])),
    );
    const detection: Detection = { name, category, confidence, evidence };
    if (chosen) {
      detection.version = chosen.version;
      detection.versionKind = chosen.kind;
      if (chosen.headerName === "server" && chosen.headerValue) {
        const patchedBy = distroOf(chosen.headerValue);
        if (patchedBy) detection.patchedBy = patchedBy;
      }
    }
    detections.push(detection);
  }

  return detections.sort(
    (a, b) =>
      CATEGORY_PRIORITY.indexOf(a.category) -
        CATEGORY_PRIORITY.indexOf(b.category) ||
      b.confidence - a.confidence ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/**
 * Detect software in one response. Pure and synchronous; never throws.
 *
 * `table` is a list of fingerprints (compiled once and cached per list) or the
 * result of {@link compileTable}.
 */
export function detect(
  input: InventoryInput,
  table: readonly Fingerprint[] | RuleTable,
  options: DetectOptions = {},
): Detection[] {
  try {
    return run(input, tableFor(table), options);
  } catch {
    return [];
  }
}
