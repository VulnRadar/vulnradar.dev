/**
 * How a scanned URL is split for display, and the one rule about what counts
 * as a path.
 *
 * Its own module rather than living beside the component that renders it:
 * this is pure string work with no JSX, so a test can import it, and
 * components/history and components/compare can use it without pulling a
 * component into a data module.
 */
export interface ParsedUrl {
  subdomain: string | null;
  host: string;
  path: string;
  /** hostname + path, i.e. the whole thing minus the scheme. */
  full: string;
}

/**
 * Split a scanned URL into the three parts the app displays it as. Treated as
 * a subdomain only at 3+ labels (sub.example.com), which is deliberately naive
 * about multi-part public suffixes (example.co.uk reads as sub "example"); it
 * only affects which half of the name is emphasised, never what is shown.
 */
export function parseUrl(url: string): ParsedUrl {
  try {
    const u = new URL(url);
    // "/" is not a path, and neither is the slash on the end of one: a scan of
    // example.com/landing/ is the same page as example.com/landing and reads
    // the same way.
    const pathname =
      u.pathname.length > 1 && u.pathname.endsWith("/")
        ? u.pathname.slice(0, -1)
        : u.pathname;
    const path = pathname === "/" ? "" : pathname + (u.search || "");
    const parts = u.hostname.split(".");
    const subdomain = parts.length > 2 ? parts[0] : null;
    const host = subdomain ? parts.slice(1).join(".") : u.hostname;
    return { subdomain, host, path, full: u.hostname + path };
  } catch {
    return { subdomain: null, host: url, path: "", full: url };
  }
}
