/**
 * Wall-clock guards measure the fastest of three runs.
 *
 * A guard like "stays linear on hostile input" is there to catch something
 * that is slow every time, and a backtracking regex is. A worker descheduled
 * under parallel forks is slow once, which is how a single measurement goes
 * red on a healthy build and teaches people to press rerun.
 *
 * The code under test must do the work each time: if it memoises on its input,
 * the second and third runs measure the cache and the guard stops guarding.
 */
export function fastestRunMs(
  run: () => unknown,
  now: () => number = () => performance.now(),
): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const started = now();
    run();
    fastest = Math.min(fastest, now() - started);
  }
  return fastest;
}
