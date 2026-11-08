/**
 * A plan limit in words. `-1` is the unlimited sentinel and `0` means the
 * feature is not on that plan. A fixed locale, so a limit reads the same in
 * the server's HTML and after hydration.
 */
export function limitLabel(value: number): string {
  if (value === -1) return "Unlimited";
  if (value === 0) return "Not included";
  return value.toLocaleString("en-US");
}
