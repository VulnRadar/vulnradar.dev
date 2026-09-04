/**
 * Layout maths and remembered panel state for the live browser viewer
 * (app/browser/[id]/page.tsx).
 *
 * Both pieces live here rather than inline in the page because both are the
 * kind of thing that is wrong silently. The fit was: the page gave Browserbase's
 * live viewer an iframe whose shape had nothing to do with the remote screen's,
 * so the viewer letterboxed a 16:9 screencast inside a ~1.6:1 box and the user
 * saw thick black bands above and below the site. Nothing errored, nothing
 * logged, the picture was just wrong.
 */

export interface Size {
  width: number;
  height: number;
}

export interface FittedEmbed extends Size {
  /** Rendered size divided by the remote viewport size. */
  scale: number;
}

const ZERO: FittedEmbed = { width: 0, height: 0, scale: 0 };

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * The largest box with `viewport`'s aspect ratio that fits inside `container`.
 *
 * A contain fit, never a stretch: the remote browser renders at a fixed
 * resolution and squashing it to the container's shape would misreport what the
 * page being scanned actually looks like. Whatever room is left over is dead
 * space around the frame, which the page centres and paints with its own
 * surface instead of leaving to the viewer's black.
 *
 * Both dimensions floor rather than round, so the result can never come back a
 * sub-pixel larger than the box it has to fit in and push a scrollbar onto a
 * pane that is meant to be exactly viewport-height. That costs at most one
 * pixel of ratio accuracy.
 *
 * Returns zeros when either box is not yet measured (width 0 before the first
 * ResizeObserver callback) or is nonsense, which the caller reads as "do not
 * mount the frame yet" rather than mounting it at 0x0.
 */
export function fitEmbed(container: Size, viewport: Size): FittedEmbed {
  if (
    !isPositive(container.width) ||
    !isPositive(container.height) ||
    !isPositive(viewport.width) ||
    !isPositive(viewport.height)
  ) {
    return ZERO;
  }
  const scale = Math.min(
    container.width / viewport.width,
    container.height / viewport.height,
  );
  return {
    width: Math.floor(viewport.width * scale),
    height: Math.floor(viewport.height * scale),
    scale,
  };
}

/**
 * localStorage keys for the viewer's two remembered toggles. Versioned so a
 * later change of meaning does not read an old value as the new one.
 */
export const VIEWER_STORAGE_KEYS = {
  /** Is the network dock open. */
  networkDock: "vulnradar_browser_network_v1",
  /** Is the remote-session safety notice still showing. */
  safetyNotice: "vulnradar_browser_notice_v1",
} as const;

export type ViewerStorageKey =
  (typeof VIEWER_STORAGE_KEYS)[keyof typeof VIEWER_STORAGE_KEYS];

/** The two methods this module needs, so a test can pass a plain object. */
export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read a remembered boolean, falling back to `fallback` for anything that is
 * not exactly "1" or "0".
 *
 * The fallback matters as much as the stored value: the network dock's default
 * is device-dependent (open on a wide screen, closed on a phone where it is a
 * sheet over the browser view), so "nothing stored" is not the same answer
 * everywhere. Access is wrapped because reading localStorage throws outright in
 * a Safari private window, not just returns null.
 */
export function readViewerFlag(
  storage: FlagStorage | null | undefined,
  key: ViewerStorageKey,
  fallback: boolean,
): boolean {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeViewerFlag(
  storage: FlagStorage | null | undefined,
  key: ViewerStorageKey,
  value: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, value ? "1" : "0");
  } catch {
    /* private mode or quota: the preference is a nicety, not state to fail on */
  }
}
