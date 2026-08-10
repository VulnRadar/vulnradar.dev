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

import { stripDocBlocks, type EvidenceFn as DetectFn } from "../_helpers";

function hasScript(body: string): boolean {
  return /<script[\s\S]*?>/i.test(body);
}

const rawDetectors: Record<string, DetectFn> = {
  "vibe-generic-error-message": (_url, _headers, body) => {
    const patterns = [
      /["']An error occurred["']/i,
      /["']Something went wrong["']/i,
      /["']Oops[,!]? something went wrong["']/i,
      /["']An unexpected error occurred["']/i,
      /["']We encountered an error["']/i,
    ];
    if (!hasScript(body)) return null;
    for (const p of patterns) {
      if (p.test(body)) {
        return "Generic catch-all error message detected in page scripts — suggests AI-generated exception handling that swallows real errors.";
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
    // Match eval() calls that aren't inside a string or comment context
    // and appear in script blocks
    if (!hasScript(body)) return null;
    const pattern = /\beval\s*\(/;
    if (pattern.test(body)) {
      return "eval() call detected in page scripts — can enable code injection if user input reaches it.";
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
    const pattern =
      /Math\.random\(\).*(?:token|csrf|session|secret|key|nonce|id|code)/i;
    if (pattern.test(body)) {
      return "Math.random() used near security-sensitive term — Math.random() is not cryptographically secure.";
    }
    return null;
  },

  "vibe-placeholder-auth": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /(?:password|passwd|pwd)\s*(?:===|==)\s*["'](?:admin|password|pass|secret|12345|test|demo|root|1234|letmein|qwerty)["']/i,
      /["'](?:admin|password|pass|secret|test|demo|root|letmein)["']\s*(?:===|==)\s*(?:password|passwd|pwd)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Hardcoded credential comparison detected — placeholder authentication logic shipped to production.";
      }
    }
    return null;
  },

  "vibe-jwt-none-alg": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const patterns = [
      /jwt\.verify\([^)]+\)\s*(?:\/\/[^\n]*)?\s*(?!.*algorithms)/,
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
      /\+\s*(?:req\.|request\.)(?:params|body|query)\.\w+\s*\+\s*["'`]/i,
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
    // Check if response JSON contains "id": small-integer patterns
    const bodyPattern = /"(?:id|user_id|userId)"\s*:\s*([1-9]\d{0,3})(?!\d)/;
    const bm = bodyPattern.exec(body);
    if (bm) {
      return `Sequential integer ID (${bm[1]}) in API response — consider UUIDs to prevent enumeration.`;
    }
    return null;
  },

  "vibe-missing-csrf": (_url, _headers, body) => {
    const hasPostForm = /<form[^>]*method\s*=\s*["']?post/i.test(body);
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
    // Base64-encoded strings that look like credentials when decoded
    const pattern =
      /(?:password|secret|token|credential|api.?key)\s*[=:]\s*["'][A-Za-z0-9+/]{20,}={0,2}["']/i;
    if (pattern.test(body)) {
      return "Base64-encoded value assigned to credential variable — Base64 is encoding, not encryption.";
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
      /\/\/\s*password\s*[:=]\s*\S+/i,
      /\/\*[\s\S]{0,100}password\s*[:=]\s*\S+[\s\S]{0,100}\*\//i,
      /<!--[\s\S]{0,100}password\s*[:=]\s*\S+[\s\S]{0,100}-->/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "Commented-out credential detected in response — remove and rotate any exposed secrets.";
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

  "vibe-insecure-cookie-domain": (_url, _headers, _body) => {
    // This is already handled by the Set-Cookie header in cookies.ts
    // Here we check for cookie domain in inline script
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
    const patterns = [
      /path\.join\s*\([^)]*(?:req\.|request\.)(?:params|query|body)/i,
      /fs\.(?:readFile|writeFile|readdir)\s*\([^)]*(?:req\.|request\.)(?:params|query)/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) {
        return "File system operation using request parameters — validate path stays within allowed directory.";
      }
    }
    return null;
  },

  "vibe-weak-password-policy": (_url, _headers, body) => {
    if (!hasScript(body)) return null;
    const hasPasswordField = /type\s*=\s*["']?password/i.test(body);
    if (!hasPasswordField) return null;
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
      /__proto__/,
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
