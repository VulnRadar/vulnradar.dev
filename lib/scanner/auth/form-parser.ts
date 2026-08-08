/**
 * Login form parsing.
 *
 * Enough HTML understanding to find a login form, work out which input is
 * the identifier and which is the secret, and carry every hidden field
 * through untouched. That last part is what makes CSRF work: Django's
 * `csrfmiddlewaretoken`, Rails' `authenticity_token` and Laravel's `_token`
 * are all just hidden inputs, so copying every hidden input verbatim covers
 * all three without special-casing any of them.
 *
 * This is a parser for the scanner's own use against a site the user owns.
 * It is not a security boundary and it does not need to be a real HTML
 * parser: a login form that this cannot read is a case for the cookie
 * injection escape hatch.
 */

const FORM_BLOCK = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
const INPUT_TAG = /<input\b([^>]*?)\/?>/gi;
const META_TAG = /<meta\b([^>]*?)\/?>/gi;
const ATTRIBUTE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Names an identifier input commonly uses, most specific first. */
const IDENTIFIER_NAMES = [
  "email",
  "username",
  "user",
  "login",
  "userid",
  "user_id",
  "user_name",
  "identifier",
  "identity",
  "account",
  "j_username",
  "user[email]",
  "session[email]",
  "user[login]",
];

const IDENTIFIER_TYPES = new Set(["email", "text", "tel", ""]);

export interface ParsedInput {
  name: string;
  value: string;
  type: string;
}

export interface ParsedLoginForm {
  /** Absolute URL the form submits to. */
  action: string;
  method: "GET" | "POST";
  /** Every hidden field, carried through so CSRF tokens survive. */
  hiddenFields: Record<string, string>;
  identifierField: string;
  secretField: string;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(raw)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!(key in attrs)) attrs[key] = decodeEntities(value);
  }
  return attrs;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function parseInputs(formBody: string): ParsedInput[] {
  const inputs: ParsedInput[] = [];
  INPUT_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INPUT_TAG.exec(formBody)) !== null) {
    const attrs = parseAttributes(match[1]);
    const name = attrs.name ?? "";
    if (!name) continue;
    inputs.push({
      name,
      value: attrs.value ?? "",
      type: (attrs.type ?? "").toLowerCase(),
    });
  }
  return inputs;
}

/** True when the markup contains a password input. */
export function hasPasswordInput(html: string): boolean {
  INPUT_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INPUT_TAG.exec(html)) !== null) {
    const attrs = parseAttributes(match[1]);
    if ((attrs.type ?? "").toLowerCase() === "password") return true;
  }
  return false;
}

/**
 * Read a CSRF token out of a meta tag. Rails, Laravel and several SPA
 * frameworks put it there and accept it back as an X-CSRF-Token header.
 */
export function extractMetaCsrfToken(html: string): string | null {
  META_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = META_TAG.exec(html)) !== null) {
    const attrs = parseAttributes(match[1]);
    const name = (attrs.name ?? attrs.property ?? "").toLowerCase();
    if (
      name === "csrf-token" ||
      name === "csrf_token" ||
      name === "_csrf" ||
      name === "xsrf-token"
    ) {
      const content = attrs.content ?? "";
      if (content) return content;
    }
  }
  return null;
}

/**
 * Find every candidate login form on the page and describe how to submit
 * each one. A "candidate" is any `<form>` with a resolvable password field
 * and a resolvable identifier field; a form offering, say, an SSO button
 * with no password input never becomes a candidate here.
 *
 * `configuredIdentifier` and `configuredSecret` let the caller override the
 * field names when a form is unusual enough to defeat detection.
 */
export function findLoginFormCandidates(
  html: string,
  baseUrl: string,
  options: {
    configuredIdentifier?: string;
    configuredSecret?: string;
    submitUrl?: string;
  } = {},
): ParsedLoginForm[] {
  const rawCandidates: Array<{ attrs: Record<string, string>; body: string }> =
    [];
  FORM_BLOCK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FORM_BLOCK.exec(html)) !== null) {
    rawCandidates.push({ attrs: parseAttributes(match[1]), body: match[2] });
  }
  if (rawCandidates.length === 0) return [];

  const results: ParsedLoginForm[] = [];

  for (const candidate of rawCandidates) {
    const inputs = parseInputs(candidate.body);

    const secretField =
      pickByName(inputs, options.configuredSecret) ??
      inputs.find((input) => input.type === "password")?.name ??
      null;
    if (!secretField) continue;

    const identifierField =
      pickByName(inputs, options.configuredIdentifier) ??
      pickIdentifier(inputs, secretField);
    if (!identifierField) continue;

    const hiddenFields: Record<string, string> = {};
    for (const input of inputs) {
      if (input.type !== "hidden") continue;
      if (input.name === identifierField || input.name === secretField)
        continue;
      hiddenFields[input.name] = input.value;
    }

    const rawAction = options.submitUrl || candidate.attrs.action || baseUrl;
    let action: string;
    try {
      action = new URL(rawAction, baseUrl).href;
    } catch {
      continue;
    }

    const method =
      (candidate.attrs.method ?? "").toUpperCase() === "GET" ? "GET" : "POST";

    results.push({
      action,
      method,
      hiddenFields,
      identifierField,
      secretField,
    });
  }

  return results;
}

/**
 * Find the login form and describe how to submit it. Returns the first
 * candidate `findLoginFormCandidates` finds; use that function directly
 * when the caller needs to know whether the page held more than one.
 */
export function parseLoginForm(
  html: string,
  baseUrl: string,
  options: {
    configuredIdentifier?: string;
    configuredSecret?: string;
    submitUrl?: string;
  } = {},
): ParsedLoginForm | null {
  return findLoginFormCandidates(html, baseUrl, options)[0] ?? null;
}

function pickByName(
  inputs: ParsedInput[],
  configured: string | undefined,
): string | null {
  if (!configured) return null;
  const found = inputs.find((input) => input.name === configured);
  return found ? found.name : null;
}

function pickIdentifier(
  inputs: ParsedInput[],
  secretField: string,
): string | null {
  const usable = inputs.filter(
    (input) =>
      input.name !== secretField &&
      input.type !== "hidden" &&
      input.type !== "password" &&
      input.type !== "submit" &&
      input.type !== "button" &&
      input.type !== "checkbox" &&
      input.type !== "radio",
  );

  for (const wanted of IDENTIFIER_NAMES) {
    const found = usable.find(
      (input) => input.name.toLowerCase() === wanted.toLowerCase(),
    );
    if (found) return found.name;
  }

  const byType = usable.find((input) => IDENTIFIER_TYPES.has(input.type));
  return byType ? byType.name : null;
}
