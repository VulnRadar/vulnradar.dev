/**
 * The safety gate for a fingerprint table's regular expressions.
 *
 * Every pattern in a table runs against attacker-controlled markup of up to
 * 1 MiB in the same Node process that serves every other scan, so a pattern
 * with a super-linear shape is a denial of service that any scanned site can
 * trigger. `assertLinear` runs one pattern against the adversarial shapes and
 * fails when it takes longer than the ceiling.
 *
 * SHAPES is copied from tests/lib/scanner/inventory-perf.test.ts on purpose
 * rather than imported: that file belongs to the wiring work and importing a
 * test file registers its tests a second time.
 */

export const SUBJECT_CHARS = 256 * 1024;
export const CEILING_MS = 100;
const PREFIX_REPEATS = 5_000;

/** Markup that opens a tag and never closes it, which is the whole trick. */
export const SHAPES: Readonly<Record<string, string>> = {
  unterminatedGeneratorMeta: '<meta name="generator" '.repeat(1_400),
  unterminatedContentMeta: '<meta content="x" '.repeat(1_800),
  unterminatedScriptSrc: '<script src="'.repeat(2_500),
  unterminatedAnyTag: "<meta ".repeat(5_000),
  openAngleRun: "<".repeat(32_768),
  attrSoup: '<script src="a" src="b" '.repeat(1_400),
};

/** Shapes that stress version and name patterns rather than tag patterns. */
const EXTRA_SHAPES: Readonly<Record<string, string>> = {
  longWord: "a".repeat(SUBJECT_CHARS),
  dottedDigits: "1.".repeat(SUBJECT_CHARS / 2),
  attributeRun: 'a="b" '.repeat(SUBJECT_CHARS / 6),
  slashRun: "/".repeat(SUBJECT_CHARS),
};

function grow(unit: string): string {
  return unit
    .repeat(Math.ceil(SUBJECT_CHARS / unit.length))
    .slice(0, SUBJECT_CHARS);
}

/**
 * The leading literal of a pattern, so the rule's own opening text can be
 * repeated: `<a wire` for `<a wire:click`. Backtracking trouble starts where a
 * pattern's anchor text repeats, and no fixed shape knows what that text is.
 */
export function literalPrefix(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      const next = source[i + 1];
      if (next === undefined || /[a-zA-Z0-9]/.test(next)) break;
      out += next;
      i++;
      continue;
    }
    if ("^$.|?*+()[]{}".includes(char)) break;
    out += char;
  }
  return out.length >= 2 ? out : "<a ";
}

export function adversarialSubjects(regex: RegExp): Record<string, string> {
  const subjects: Record<string, string> = {};
  for (const [name, unit] of Object.entries(SHAPES))
    subjects[name] = grow(unit);
  for (const [name, text] of Object.entries(EXTRA_SHAPES))
    subjects[name] = text;
  subjects.ownPrefix = literalPrefix(regex.source)
    .repeat(PREFIX_REPEATS)
    .slice(0, SUBJECT_CHARS);
  return subjects;
}

function timeOnce(regex: RegExp, subject: string): number {
  regex.lastIndex = 0;
  const started = performance.now();
  regex.exec(subject);
  return performance.now() - started;
}

/**
 * Throws when `regex` takes longer than `ceilingMs` on any adversarial
 * subject. A slow first run is timed again and the faster of the two counts,
 * so a busy machine does not fail a pattern that is genuinely linear.
 */
export function assertLinear(
  regex: RegExp,
  ceilingMs: number = CEILING_MS,
): void {
  const plain = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ""));
  for (const [shape, subject] of Object.entries(adversarialSubjects(plain))) {
    let elapsed = timeOnce(plain, subject);
    if (elapsed > ceilingMs)
      elapsed = Math.min(elapsed, timeOnce(plain, subject));
    if (elapsed > ceilingMs) {
      throw new Error(
        `${String(regex)} took ${Math.round(elapsed)}ms on ${shape} ` +
          `(${subject.length} chars, ceiling ${ceilingMs}ms): a scanned page can stall every scan`,
      );
    }
  }
}
