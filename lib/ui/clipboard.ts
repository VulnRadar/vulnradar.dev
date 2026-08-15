/**
 * Copy text to the clipboard, awaiting and reporting real success/failure.
 *
 * The single source for this across the app -- was previously
 * reimplemented independently in 6+ components, all but one calling the
 * unchecked `navigator.clipboard.writeText()` and showing "Copied" on the
 * click handler returning, not on the copy actually succeeding. This is
 * that one correct implementation (originally components/scanner/
 * share-modal.tsx's `copyText`), promoted here so every caller gets the
 * same real-success-checked behavior and the `execCommand` fallback for
 * browsers/contexts where the async Clipboard API is unavailable
 * (insecure origins, permission-denied, older WebViews).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy fallback
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
