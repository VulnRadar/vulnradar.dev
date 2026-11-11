/**
 * The behavior to pass to a programmatic scroll: instant when the visitor has
 * asked for reduced motion, smooth otherwise. A literal `behavior: "smooth"`
 * ignores that setting, so a long jump animates for someone who turned
 * animation off.
 *
 * A local copy of the helper the profile page state is gaining. When that one
 * lands, this file becomes a re-export and then goes.
 */
export function scrollBehavior(): ScrollBehavior {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "auto";
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
