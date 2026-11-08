/**
 * Runs `run` unless a run that took the same flag is still going.
 *
 * A ref, not state: two Enter presses land in the same tick, before React has
 * re-rendered with a `busy` value, so a state check lets both through and the
 * second invite hits the API for an address the first one already invited.
 */
export async function runOnce(
  flag: { current: boolean },
  run: () => Promise<void>,
): Promise<void> {
  if (flag.current) return;
  flag.current = true;
  try {
    await run();
  } finally {
    flag.current = false;
  }
}
