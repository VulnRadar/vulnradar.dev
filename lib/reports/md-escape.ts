/**
 * Neutralize characters that are active in Markdown / HTML before a stored
 * finding field is interpolated into an exported .md or compliance report.
 * Finding text (evidence especially) can echo attacker-controlled response
 * snippets from a scanned target, e.g. `<img src=x onerror=alert(1)>`.
 *
 * VulnRadar itself never renders these reports back as HTML, so this is pure
 * defense-in-depth for the case where a downloaded report is opened in a
 * third-party Markdown viewer that DOES render embedded HTML.
 */

/** Escape angle brackets so raw HTML in a value renders as literal text. */
export function mdText(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Make a value safe to place inside an inline `code` span: a backtick would
 *  otherwise close the span and let the rest render as Markdown/HTML. */
export function mdInlineCode(value: string): string {
  return value.replace(/`/g, "'");
}

/** Make a value safe to place inside a ``` fenced ``` block: the content is
 *  already inert HTML-wise inside a code fence, so the only hazard is a triple
 *  backtick breaking out of the fence. */
export function mdFenced(value: string): string {
  return value.replace(/```/g, "''''");
}
