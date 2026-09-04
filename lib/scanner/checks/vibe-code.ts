/**
 * Vibe-code detectors.
 *
 * Detects patterns characteristic of AI-generated (LLM-assisted) code that
 * has predictable security gaps. None of these are definitive proof of
 * vulnerability — they flag patterns with a high false-positive rate and
 * should be treated as "worth reviewing" rather than "confirmed vulnerable".
 *
 * Confidence levels are intentionally lower (body-pattern ~70%) because
 * these are heuristic-based pattern matches.
 */

import {
  stripDocBlocks,
  extractScriptContents,
  type EvidenceFn as DetectFn,
} from "../_helpers";
import { hasTagWith, tagsWith } from "./_tag-scan";

function hasScript(body: string): boolean {
  return /<script[\s\S]*?>/i.test(body);
}

/**
 * Decodes `value` only if it is genuinely canonical base64, returning the
 * bytes as latin1 so every byte survives for the printability test.
 *
 * `Buffer.from(x, "base64")` silently skips characters it does not
 * recognise and tolerates a wrong length, so it "succeeds" on any string.
 * The round-trip comparison is what makes this a validation rather than a
 * decode: a hex digest or a random token re-encodes to something other than
 * the input, so it is rejected before it can be inspected.
 */
function decodeStrictBase64(value: string): string | null {
  if (value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const buf = Buffer.from(value, "base64");
  if (buf.length === 0) return null;
  if (buf.toString("base64") !== value) return null;
  return buf.toString("latin1");
}

// Matches actual exception-handling code (a catch block, a window.onerror
// handler, an "error" event listener) so the generic-error-message check
// below only fires when a quoted phrase sits near real error handling, not
// wherever the phrase happens to appear as a data value -- an SSR
// framework's embedded i18n/state JSON (Next.js __NEXT_DATA__, Nuxt state,
// a hand-rolled translations blob) routinely contains the exact same
// friendly strings as UI copy, not as evidence of a swallowed exception.
const ERROR_HANDLING_CONTEXT =
  /catch\s*\(|\.catch\s*\(|onerror|addEventListener\s*\(\s*["']error["']/i;

// Words that routinely follow "password:" in an ordinary validation-rule
// comment ("// password: minimum 8 characters, 1 uppercase, 1 number") --
// exactly the kind of over-commenting the AI-generated code this whole
// category targets tends to produce -- rather than a literal value left
// behind after commenting out a real credential. A quoted string is always
// treated as plausible: nobody quotes a validation-rule word like "minimum".
const COMMENTED_VALUE_STOPWORDS = new Set([
  "minimum",
  "min",
  "max",
  "at",
  "least",
  "must",
  "should",
  "required",
  "characters",
  "chars",
  "character",
  "char",
  "length",
  "strength",
  "format",
  "regex",
  "pattern",
]);

function isPlausibleCommentedCredentialValue(value: string): boolean {
  const v = value.trim();
  if (/^["'][\s\S]*["']$/.test(v)) return true;
  return !COMMENTED_VALUE_STOPWORDS.has(v.toLowerCase());
}

const rawDetectors: Record<string, DetectFn> = {
  "vibe-generic-error-message": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /["']An error occurred["']/gi,
      /["']Something went wrong["']/gi,
      /["']Oops[,!]? something went wrong["']/gi,
      /["']An unexpected error occurred["']/gi,
      /["']We encountered an error["']/gi,
    ];
    // Every occurrence is checked, not just the first: the same friendly
    // string routinely appears once as i18n/state data near the top of the
    // page AND again inside the real catch block further down, and testing
    // only the first hit let the data copy mask the genuine one.
    for (const p of patterns) {
      for (const m of body.matchAll(p)) {
        const nearby = body.slice(
          Math.max(0, m.index - 150),
          m.index + m[0].length + 150,
        );
        if (ERROR_HANDLING_CONTEXT.test(nearby)) {
          return "Generic catch-all error message detected near exception-handling code, suggesting AI-generated error handling that swallows real errors.";
        }
      }
    }
    return null;
  },

  "vibe-todo-security-comment": (_url, _headers, body) => {
    const pattern =
      /\/\/\s*TODO[:\s].*(?:auth(?:entication|orization)?|secur(?:ity|e)|validat|sanitiz|csrf|inject|permission|access.control)/i;
    if (pattern.test(body)) {
      return "TODO comment referencing unimplemented security control detected in response body.";
    }
    return null;
  },

  "vibe-eval-usage": (_url, _headers, body) => {
    // Scope eval() detection to genuine <script> content, not the whole
    // body: prose that merely mentions eval() ("never use eval()", a
    // security tip, a changelog line) on a page that also happens to
    // carry any <script> otherwise self-triggers this detector.
    const scripts = extractScriptContents(body);
    if (scripts.length === 0) return null;
    const pattern = /\beval\s*\(/;
    for (const script of scripts) {
      if (pattern.test(script)) {
        return "eval() call detected in page scripts — can enable code injection if user input reaches it.";
      }
    }
    return null;
  },

  "vibe-disabled-ssl-verify": (_url, _headers, body) => {
    const patterns = [
      /rejectUnauthorized\s*:\s*false/i,
      /verify\s*=\s*False/,
      /InsecureRequestWarning/,
      /ssl_verify\s*=\s*false/i,
      /CURLOPT_SSL_VERIFYPEER\s*,\s*false/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "SSL certificate verification bypass pattern detected — disables TLS validation and enables MITM attacks.";
      }
    }
    return null;
  },

  "vibe-weak-random": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    // Bounded proximity window (matches the SQL-concat check's own
    // [\s\S]{0,150} convention above) and word-boundaried trigger terms --
    // the previous unbounded, unanchored `.*` matched across an entire
    // minified line (the production norm) and matched inside ordinary
    // identifiers containing these substrings (grid, hidden, productId,
    // keyword, encode), not just the standalone security-sensitive terms
    // it was meant to catch.
    const pattern =
      /Math\.random\(\)[\s\S]{0,150}\b(?:token|csrf|session|secret|key|nonce|id|code)\b/i;
    if (pattern.test(body)) {
      return "Math.random() used near security-sensitive term — Math.random() is not cryptographically secure.";
    }
    return null;
  },

  "vibe-placeholder-auth": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:password|passwd|pwd)\s*(?:===|==)\s*["'](?:admin|password|pass|secret|12345|test|demo|root|1234|letmein|qwerty)["']/gi,
      /["'](?:admin|password|pass|secret|test|demo|root|letmein)["']\s*(?:===|==)\s*(?:password|passwd|pwd)/gi,
    ];
    for (const p of patterns) {
      let m: RegExpExecArray | null;
      while ((m = p.exec(body)) !== null) {
        // A lone comparison is a plausible hardcoded backdoor. A chain of
        // 3+ literal comparisons nearby is almost always a common-password
        // denylist (a legitimate rejection check), not a granting bypass.
        const nearby = body.slice(
          Math.max(0, m.index - 120),
          m.index + m[0].length + 120,
        );
        const chainCount = (
          nearby.match(/(?:===|==)\s*["'][^"']{1,20}["']/g) || []
        ).length;
        if (chainCount < 3) {
          return "Hardcoded credential comparison detected — placeholder authentication logic shipped to production.";
        }
      }
    }
    return null;
  },

  "vibe-jwt-none-alg": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    // Check the jwt.verify() call's own argument list for an algorithms
    // whitelist, not the text that happens to follow the closing paren.
    // The capture tolerates one level of nested parens so a common
    // `jwt.verify(token, getKey(), { algorithms: ['HS256'] })` isn't
    // truncated at getKey()'s ')' before the algorithms option is seen.
    const verifyCallPattern = /jwt\.verify\s*\(((?:[^()]|\([^()]*\))*)\)/g;
    let vm: RegExpExecArray | null;
    while ((vm = verifyCallPattern.exec(body)) !== null) {
      if (!/algorithms\s*:/.test(vm[1])) {
        return "JWT 'none' algorithm risk pattern detected — library may accept unsigned tokens.";
      }
    }
    const patterns = [
      /alg(?:orithm)?\s*:\s*["']none["']/i,
      /algorithms\s*:\s*\[[^\]]*none[^\]]*\]/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "JWT 'none' algorithm risk pattern detected — library may accept unsigned tokens.";
      }
    }
    return null;
  },

  "vibe-sql-string-concat": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /["`']SELECT\s+.*WHERE\s+\w+\s*=\s*["'`]\s*\+/i,
      /(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,150}\+\s*(?:req\.|request\.)(?:params|body|query)\.\w+/i,
      /`SELECT[\s\S]{0,100}\$\{(?:req|request)\.(?:params|body|query)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "SQL string concatenation with request data detected — direct SQL injection vector.";
      }
    }
    return null;
  },

  "vibe-expose-stacktrace": (_url, _headers, body) => {
    const patterns = [
      /at\s+\w+\s+\([^)]+\.(?:js|ts|mjs):\d+:\d+\)/,
      /\.(?:js|ts):\d+\s+at\s+/,
      /at\s+Object\.<anonymous>\s+\(/,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "JavaScript stack trace detected in response — leaks file paths and internal code structure.";
      }
    }
    return null;
  },

  "vibe-md5-sha1-usage": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:md5|sha1|sha-1)\s*\([^)]*(?:pass|pwd|password|secret)/i,
      /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\).*update\s*\([^)]*(?:pass|pwd)/i,
      /CryptoJS\.MD5\s*\(/i,
      /hashlib\.(?:md5|sha1)\s*\([^)]*(?:pass|pwd|password)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "MD5 or SHA-1 used in password/secret context — these algorithms are cryptographically broken.";
      }
    }
    return null;
  },

  "vibe-insecure-deserialize": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /JSON\.parse\s*\(\s*(?:req\.|request\.)(?:body|params|query)/i,
      /JSON\.parse\s*\(\s*\w*[Ii]nput/i,
      /node-serialize/i,
      /unserialize\s*\(/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Unsafe deserialization of user input detected — validate schema before using parsed data.";
      }
    }
    return null;
  },

  "vibe-http-not-https": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    // Avoid localhost, 127.0.0.1, example.com, already-encoded strings, and
    // XML/RDF namespace or vocabulary identifiers that are spec'd as
    // http:// URIs and never resolved as network requests: the SVG/XHTML
    // namespace (www.w3.org), schema.org JSON-LD structured data (used by
    // nearly every SEO-conscious site, this one included), the OpenGraph
    // namespace (ogp.me), and Dublin Core / Creative Commons vocabularies.
    // These are the single most common false positive for this check --
    // any page with an inline <svg> or JSON-LD block was matching before.
    const pattern =
      /["']http:\/\/(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0|example\.com|schemas\.|www\.w3\.org|schema\.org|ogp\.me|purl\.org|creativecommons\.org)[^"']*)/i;
    if (pattern.test(body)) {
      return "Hardcoded http:// URL found in page scripts — use https:// or environment variables.";
    }
    return null;
  },

  "vibe-predictable-userid": (url, _headers, body) => {
    // Check if the URL itself has small sequential integers
    const urlPattern = /\/(?:user|account|profile|order)s?\/([1-9]\d{0,3})\b/i;
    const m = urlPattern.exec(url);
    if (m) {
      return `Sequential integer ID (${m[1]}) in URL path — predictable IDs enable IDOR enumeration.`;
    }
    // Check if response JSON contains "id": small-integer patterns near
    // user/account context, not just any public resource id (a blog post,
    // product, or JSON-LD block that happens to use the key "id").
    if (!hasScript(body)) return null;
    const bodyPattern = /"(?:id|user_id|userId)"\s*:\s*([1-9]\d{0,3})(?!\d)/g;
    let bm: RegExpExecArray | null;
    while ((bm = bodyPattern.exec(body)) !== null) {
      const nearby = body.slice(
        Math.max(0, bm.index - 150),
        bm.index + bm[0].length + 150,
      );
      if (
        /"(?:email|password|role|session|account|profile|token|username)"/i.test(
          nearby,
        )
      ) {
        return `Sequential integer ID (${bm[1]}) in API response — consider UUIDs to prevent enumeration.`;
      }
    }
    return null;
  },

  "vibe-missing-csrf": (_url, _headers, body) => {
    const hasPostForm = hasTagWith(body, "form", /method\s*=\s*["']?post/i);
    if (!hasPostForm) return null;
    const hasCsrfToken =
      /(?:csrf|_token|authenticity_token)\s*['"]/i.test(body) ||
      /name\s*=\s*["'](?:_csrf|csrf_token|authenticity_token)["']/i.test(
        body,
      ) ||
      /type\s*=\s*["']hidden["'][^>]*(?:csrf|token)/i.test(body);
    if (!hasCsrfToken) {
      return "POST form detected without a visible CSRF token field — verify server-side CSRF protection is present.";
    }
    return null;
  },

  "vibe-base64-sensitive": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    // The value used to be accepted on its character class alone
    // (`[A-Za-z0-9+/]{20,}`), which is satisfied by every hex digest,
    // random session/CSRF token, build id and opaque public key on the
    // page. None of those are "base64-encoded credentials", and the check
    // fired "high" on them.
    //
    // This check's own description is what to implement: a value that
    // *decodes* to a secret. So decode it. Random bytes and hex digests
    // decode to unprintable garbage; an actually base64-wrapped credential
    // decodes to readable text (`dXNlcjpwYXNzd29yZA==` -> `user:password`).
    const pattern =
      /(?:password|secret|token|credential|api.?key)\s*[=:]\s*["']([A-Za-z0-9+/]{20,}={0,2})["']/gi;
    for (const m of body.matchAll(pattern)) {
      const decoded = decodeStrictBase64(m[1]);
      if (!decoded) continue;
      if (decoded.length < 6) continue;
      // Printable ASCII only. One unprintable byte means the input was a
      // digest or a random token that merely happened to use the base64
      // alphabet, not text somebody encoded.
      if (/[^\x20-\x7e]/.test(decoded)) continue;
      return "Credential variable holds a Base64 value that decodes to readable text: Base64 is encoding, not encryption.";
    }
    return null;
  },

  "vibe-unrestricted-file-upload": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const hasUpload =
      /(?:formData|multer|busboy|multipart)[\s\S]{0,200}(?:file|upload)/i.test(
        body,
      );
    if (!hasUpload) return null;
    const hasTypeCheck =
      /(?:mimetype|content.type|file\.type|ALLOWED_TYPES|allowedTypes)/i.test(
        body,
      );
    if (!hasTypeCheck) {
      return "File upload handler detected without visible content-type validation.";
    }
    return null;
  },

  "vibe-template-injection": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:render|compile|renderString)\s*\([^)]*(?:req\.|request\.)(?:body|params|query)/i,
      /nunjucks\.renderString\s*\([^,)]*(?:req\.|input|user)/i,
      /ejs\.render\s*\([^,)]*(?:req\.|user)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Template engine called with potential user-controlled string — server-side template injection risk.";
      }
    }
    return null;
  },

  "vibe-password-in-comment": (_url, _headers, body) => {
    const patterns = [
      /\/\/\s*password\s*[:=]\s*("[^"]+"|'[^']+'|[A-Za-z0-9_!@#$%^&*-]{4,})/gi,
      /\/\*[\s\S]{0,100}password\s*[:=]\s*("[^"]+"|'[^']+'|[A-Za-z0-9_!@#$%^&*-]{4,})[\s\S]{0,100}\*\//gi,
      /<!--[\s\S]{0,100}password\s*[:=]\s*("[^"]+"|'[^']+'|[A-Za-z0-9_!@#$%^&*-]{4,})[\s\S]{0,100}-->/gi,
    ];
    // Every occurrence is checked, not just the first: a benign
    // "// password: minimum 8 characters" rule comment near the top of a
    // file otherwise masked a genuine "// password: hunter2" left further
    // down, because only the first match was ever scored.
    for (const p of patterns) {
      for (const m of body.matchAll(p)) {
        if (isPlausibleCommentedCredentialValue(m[1])) {
          return "Commented-out credential detected in response: remove and rotate any exposed secrets.";
        }
      }
    }
    return null;
  },

  "vibe-open-redirect": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:redirect|location\.href|window\.location)\s*=\s*(?:req\.|searchParams\.get|query\.)/i,
      /(?:res\.redirect|router\.push|next\.redirect)\s*\([^)]*(?:searchParams|params|query|req\.)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Redirect using URL/query parameter without visible validation — potential open redirect.";
      }
    }
    return null;
  },

  "vibe-loose-equality-auth": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:role|permission|admin|isAdmin)\s*==\s*["']/i,
      /["']\s*==\s*(?:role|permission|token|key)\b/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Loose equality (==) in apparent authorization check — use === to avoid type coercion bypass.";
      }
    }
    return null;
  },

  "vibe-no-input-validation": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    // Look for API handlers that spread req.body directly without any schema
    const hasBadPattern =
      /Object\.assign\s*\(\s*\w+\s*,\s*(?:req\.|request\.)body\)/i.test(body) ||
      /\.\.\.\s*(?:req\.|request\.)body\b/.test(body);
    if (!hasBadPattern) return null;
    const hasValidation =
      /(?:zod|joi|yup|ajv|validate|schema|safeParse|parse)/.test(body);
    if (!hasValidation) {
      return "Request body spread/assigned to object without visible schema validation — mass assignment risk.";
    }
    return null;
  },

  "vibe-cors-wildcard": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /cors\s*\(\s*\)/i,
      /Access-Control-Allow-Origin['":\s]+\*/i,
      /origin\s*:\s*["']\*["']/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Permissive CORS configuration (wildcard origin) detected in page scripts.";
      }
    }
    return null;
  },

  "vibe-debug-endpoint": (_url, _headers, body) => {
    const patterns = [
      /"debug"\s*:\s*true/i,
      /\/debug\s*(?:route|endpoint|handler|path)/i,
      /app\.(get|post)\s*\(\s*["']\/debug["']/i,
      /"environment"\s*:\s*"(?:development|test|dev)"/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Debug endpoint or development flag detected in production response.";
      }
    }
    return null;
  },

  "vibe-mass-assignment": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const pattern =
      /await\s+\w+\.\w+\s*\(\s*\w+\s*,\s*\{[^}]*\.\.\.\s*(?:req\.|request\.)body/i;
    if (pattern.test(body)) {
      return "Database update spreading entire request body — mass assignment allows modification of protected fields.";
    }
    return null;
  },

  "vibe-timing-attack-risk": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:token|key|secret|password)\s*===\s*(?:req\.|stored|expected)/i,
      /(?:req\.|provided|input)\.\w*(?:token|key|secret)\s*===\s*/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Direct string equality on security token — use crypto.timingSafeEqual() to prevent timing attacks.";
      }
    }
    return null;
  },

  "vibe-xss-via-innerhtml": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /\.innerHTML\s*=\s*(?!DOMPurify|sanitize)[^;'"]{0,50}(?:data|user|input|param|query|req\.|response)/i,
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "innerHTML or dangerouslySetInnerHTML assigned without DOMPurify sanitization — XSS risk.";
      }
    }
    return null;
  },

  "vibe-insecure-cookie-domain": (_url, _headers, body) => {
    // The Set-Cookie header case is already handled by cookies.ts's
    // cookie-domain-broad check against the authoritative header; this
    // catches the same overly-broad domain scoping set client-side via
    // document.cookie instead.
    if (!hasScript(body)) return null;
    const pattern =
      /document\.cookie\s*=\s*[`"'][^`"']*domain\s*=\s*\.[a-z0-9.-]+\.[a-z]{2,}[^`"']*[`"']/i;
    if (pattern.test(body)) {
      return "Cookie set via document.cookie with a broad leading-dot domain attribute — shares the cookie across all subdomains.";
    }
    return null;
  },

  "vibe-no-rate-limit": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const hasLoginHandler =
      /(?:login|signin|authenticate|password.reset)\s*(?:handler|route|endpoint|function)/i.test(
        body,
      );
    if (!hasLoginHandler) return null;
    const hasRateLimit =
      /(?:ratelimit|rate.limit|limiter|throttle|slowDown)/i.test(body);
    if (!hasRateLimit) {
      return "Login/auth endpoint without visible rate limiting — brute-force attacks are unrestricted.";
    }
    return null;
  },

  "vibe-path-traversal": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    // Skip path.join() calls already followed by a containment check
    // (resolve/normalize + startsWith), the textbook-correct defense this
    // same check's fixSteps recommend.
    const joinPattern =
      /path\.join\s*\([^)]*(?:req\.|request\.)(?:params|query|body)[^)]*\)[\s\S]{0,200}/gi;
    const joins = body.match(joinPattern) || [];
    for (const call of joins) {
      if (!/\.startsWith\(|path\.resolve\(|path\.normalize\(/.test(call)) {
        return "File system operation using request parameters — validate path stays within allowed directory.";
      }
    }
    const fsPattern =
      /fs\.(?:readFile|writeFile|readdir)\s*\([^)]*(?:req\.|request\.)(?:params|query)/i;
    if (fsPattern.test(body)) {
      return "File system operation using request parameters — validate path stays within allowed directory.";
    }
    return null;
  },

  "vibe-weak-password-policy": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    // Match each password-type input individually and exclude any tagged
    // autocomplete="current-password" (the WHATWG-standard value for a
    // LOGIN field verifying an existing password, vs "new-password" for
    // signup/reset creating one -- "strength" has no meaning for a login
    // form, which fired here on VulnRadar's own /login) or
    // autocomplete="off" (used the same way on our own API-key-paste
    // field -- an EXISTING credential being entered, not created, fired
    // on /docs/api). A field with NO autocomplete attribute at all still
    // counts, which is the actually-careless case this check exists for.
    const passwordInputs = tagsWith(body, "input", /type\s*=\s*["']?password/i);
    const newPasswordFields = passwordInputs.filter(
      (tag) =>
        !/autocomplete\s*=\s*["'](?:current-password|off)["']/i.test(tag),
    );
    if (newPasswordFields.length === 0) return null;
    const hasPasswordValidation =
      /(?:minLength|min_length|minlength|password.length|zxcvbn|strength)/i.test(
        body,
      );
    if (!hasPasswordValidation) {
      return "Password field detected without visible length/strength validation.";
    }
    return null;
  },

  "vibe-prototype-pollution": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /Object\.assign\s*\(\s*\{\}\s*,\s*(?:req\.|request\.)(?:body|query)/i,
      /\.__proto__\s*(?:=|\[)|\[["']__proto__["']\]\s*=/,
      /\[["']constructor["']\]\s*\[["']prototype["']\]/,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Prototype pollution risk pattern detected — filter __proto__, constructor, prototype keys from user input.";
      }
    }
    return null;
  },

  "vibe-ai-comment-marker": (_url, _headers, body) => {
    const pattern =
      /\/\/\s*(?:generated by|created by|written by)?\s*(?:ChatGPT|GitHub Copilot|Claude|Cursor|AI-generated|auto.generated)/i;
    if (pattern.test(body)) {
      return "AI code-generation marker detected in response — review generated code for security issues.";
    }
    return null;
  },

  "vibe-console-log-sensitive": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const pattern =
      /console\.(?:log|error|warn)\s*\([^)]*(?:password|token|secret|jwt|auth|apiKey|api_key)/i;
    if (pattern.test(body)) {
      return "Console log statement near sensitive variable name detected — may leak credentials to browser console.";
    }
    return null;
  },

  "vibe-synchronous-crypto": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:hashSync|pbkdf2Sync|randomFillSync|scryptSync)\s*\(/,
      /bcrypt\.hashSync\s*\(/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Synchronous crypto operation detected — blocks the event loop; use async equivalents.";
      }
    }
    return null;
  },

  "vibe-prompt-injection-risk": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:openai|anthropic|generateText|chat\.completions\.create)\s*\([^)]*\$\{\s*(?:req\.|request\.|user|input)/i,
      /messages\s*:\s*\[[^\]]*content\s*:\s*`[^`]*\$\{\s*(?:req\.|request\.|userInput|input)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "User input concatenated directly into an LLM prompt without visible isolation/sanitization — prompt injection risk.";
      }
    }
    return null;
  },

  "vibe-llm-api-called-from-client": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const pattern =
      /fetch\s*\(\s*["']https:\/\/api\.(?:openai|anthropic)\.com/i;
    if (pattern.test(body)) {
      return "Direct fetch() call to the OpenAI/Anthropic API found in page scripts — LLM API keys should never be called from client-side code; proxy through a backend endpoint.";
    }
    return null;
  },

  "vibe-weak-file-extension-check": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const pattern =
      /filename\.(?:includes|indexOf)\s*\(\s*["']\.[a-z0-9]{2,4}["']/i;
    if (pattern.test(body)) {
      return "File upload validated with filename.includes('.ext') instead of checking the actual extension/MIME type — 'evil.jpg.exe' passes this check.";
    }
    return null;
  },

  "vibe-client-controlled-price": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const callPattern =
      /(?:fetch|axios\.post)\s*\(\s*["'`][^"'`]*(?:checkout|payment|order|charge)[^"'`]*["'`][\s\S]{0,300}/gi;
    const calls = body.match(callPattern) || [];
    for (const call of calls) {
      if (
        /(?:amount|total|price)\s*:\s*(?:total|amount|price|cartTotal|grandTotal)\b/.test(
          call,
        )
      ) {
        return "Client-computed total/amount/price sent directly to a checkout/payment endpoint — recompute and validate pricing server-side; a trusted client value can be tampered with.";
      }
    }
    return null;
  },

  "vibe-auth-check-fails-open": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const pattern =
      /try\s*\{[^}]{0,200}(?:verify|authenticate|checkAuth|isLoggedIn)\([^}]{0,200}\}\s*catch\s*\([^)]*\)\s*\{\s*console\.(?:log|error|warn)\([^)]*\)\s*;?\s*\}/i;
    if (pattern.test(body)) {
      return "Authentication check wrapped in try/catch whose catch block only logs the error — a thrown/rejected auth check silently 'succeeds' instead of denying access (fail-open).";
    }
    return null;
  },

  "vibe-dynamic-import-user-input": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const pattern =
      /import\s*\(\s*(?:req\.|request\.)(?:params|query|body)\.\w+/i;
    if (pattern.test(body)) {
      return "Dynamic import() called with a request-derived path — can allow arbitrary module loading if not restricted to an allowlist.";
    }
    return null;
  },
};

// Every pattern above targets code that would realistically only appear in
// a genuinely leaked/shipped script -- but none of them are scoped to
// actual <script> content, so a page that merely *talks about* one of
// these patterns as a documentation/tutorial example self-triggers the
// same detector. This product's own /docs pages render every check's
// "Bad (AI-generated)" code sample (eval(), SQL string concatenation,
// hardcoded credential comparisons, etc.) as literal text in <pre>/<code>
// blocks, which would otherwise light up nearly this entire category on
// our own site. Strip those documentation-rendering regions (but not real
// <script> tags -- several detectors need to see genuine script content)
// before any pattern runs.
export const detectors: Record<string, DetectFn> = Object.fromEntries(
  Object.entries(rawDetectors).map(([id, fn]) => [
    id,
    ((url, headers, body) =>
      fn(url, headers, stripDocBlocks(body))) as DetectFn,
  ]),
);
