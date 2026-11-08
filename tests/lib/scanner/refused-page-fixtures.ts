import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Recorded responses from real sites that refused the scanner, trimmed and
 * named for their shape rather than their host: no scanned site is named in
 * this repo. `.hdr` is the status line and headers, `.body` the page.
 */
const DIR = join(process.cwd(), "tests/fixtures/scanner/refused-pages");

export interface RecordedResponse {
  name: string;
  status: number;
  headers: Headers;
  body: string;
}

function load(name: string): RecordedResponse {
  const [statusLine, ...lines] = readFileSync(join(DIR, `${name}.hdr`), "utf8")
    .trim()
    .split("\n");
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(":");
    headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  let body = "";
  try {
    body = readFileSync(join(DIR, `${name}.body`), "utf8");
  } catch {
    // The served-page recordings are headers only.
  }
  return { name, status: Number(statusLine.split(" ")[1]), headers, body };
}

const names = readdirSync(DIR)
  .filter((file) => file.endsWith(".hdr"))
  .map((file) => file.slice(0, -".hdr".length));

export const REFUSED_RESPONSES = names
  .filter((name) => !name.startsWith("ok-200"))
  .map(load);

export const SERVED_RESPONSES = names
  .filter((name) => name.startsWith("ok-200"))
  .map(load);
