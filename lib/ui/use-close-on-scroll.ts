import { useEffect } from "react";

/**
 * Close an open, page-anchored overlay when the PAGE scrolls.
 *
 * A fixed / Floating-UI-anchored overlay (a Radix Popover, a custom dropdown)
 * re-runs its position calculation on every scroll frame to stay glued to its
 * trigger. On iOS Safari that synchronous repositioning during momentum scroll
 * forces layout onto the main thread every frame and visibly hitches the page.
 * Once the user is actually scrolling, tracking the trigger isn't useful, so we
 * just close. This is the behavior the scan form's check-families panels
 * established; this hook is the shared version so every overlay behaves the
 * same way.
 *
 * Registered on window with capture so it also sees scroll events from nested
 * scrollable elements (those don't bubble, but capture-phase listeners fire
 * regardless). It closes ONLY on an actual page-level scroll
 * (`event.target === document`); a scroll whose target is the overlay's own
 * scrollable list is ignored, so the overlay's internal content stays
 * scrollable instead of snapping shut the moment you scroll it.
 *
 * Pass a stable `onClose` (e.g. from useCallback) so the listener isn't torn
 * down and re-registered on every render.
 */
export function useCloseOnScroll(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    function handleScroll(event: Event) {
      if (event.target !== document) return;
      onClose();
    }
    window.addEventListener("scroll", handleScroll, {
      passive: true,
      capture: true,
    });
    return () =>
      window.removeEventListener("scroll", handleScroll, { capture: true });
  }, [open, onClose]);
}
