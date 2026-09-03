/**
 * The noun for a count, with the plural rule applied once instead of being
 * rewritten at every call site. Written for the shape this app kept getting
 * wrong: a row built as `${n} members`, which reads "1 members" the moment a
 * team has a single person in it.
 *
 * `count` is typed loose on purpose. Postgres returns COUNT(*) as a bigint and
 * node-postgres hands a bigint back as a *string*, so a component comparing
 * `count !== 1` against "1" takes the plural branch on a singular row even
 * though its TypeScript type says `number`. That was the live bug on the teams
 * list. Coercing here means no caller has to know which of its counts came out
 * of a COUNT(*).
 *
 * Pass `pluralForm` for anything the trailing "s" gets wrong ("entry"/
 * "entries").
 */
export function plural(
  count: number | string | null | undefined,
  singular: string,
  pluralForm?: string,
): string {
  return Number(count) === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/**
 * `plural` with the number in front: "1 member", "4 members". Use this where
 * the count is plain text; where the digits carry their own styling (a
 * `tabular-nums` span, say) use `plural` for the noun alone.
 */
export function pluralize(
  count: number | string | null | undefined,
  singular: string,
  pluralForm?: string,
): string {
  const n = Number(count);
  return `${Number.isFinite(n) ? n : 0} ${plural(count, singular, pluralForm)}`;
}
