import { describe, it, expect, vi } from "vitest";
import { fastestRunMs } from "./timing";

/** A clock that advances by the given run lengths, one per measurement. */
function clockFor(durations: number[]) {
  let t = 0;
  let starting = true;
  const queue = [...durations];
  return () => {
    if (!starting) t += queue.shift() as number;
    starting = !starting;
    return t;
  };
}

describe("fastestRunMs", () => {
  it("ignores a run that was descheduled", () => {
    expect(fastestRunMs(() => {}, clockFor([900, 12, 40]))).toBe(12);
  });

  it("still reports slow when every run was slow", () => {
    expect(fastestRunMs(() => {}, clockFor([700, 900, 800]))).toBe(700);
  });

  it("does the work three times", () => {
    const run = vi.fn();
    fastestRunMs(run, clockFor([1, 1, 1]));
    expect(run).toHaveBeenCalledTimes(3);
  });
});
