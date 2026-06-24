/**
 * Extended secrets detectors.
 *
 * Focused on credential / token / PII exposure — split out of the
 * generic "code" category so that consumers can scope scans to either
 * "is my code risky?" (code) or "is my data leaking?" (secrets-extended).
 */

import { type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  // ── Credit cards / SSN / phone / email ────────────────────────────────────

  "credit-card-pattern": (url, _headers, body) => {
    const re =
      /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
    const matches = body.match(re) || [];
    if (matches.length > 0)
      return `Found ${matches.length} credit-card-number-pattern match(es) in source.`;
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review responses for credit-card-number patterns.`;
    }
    return null;
  },

  "ssn-pattern": (url, _headers, body) => {
    const re = /\b\d{3}-\d{2}-\d{4}\b/g;
    const matches = body.match(re) || [];
    if (matches.length >= 3)
      return `${matches.length} US SSN-pattern value(s) found in source.`;
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review responses for SSN-pattern values.`;
    }
    return null;
  },

  "phone-number-leak": (_url, _headers, body) => {
    const matches =
      body.match(/(?:\+1|1)?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
    if (matches.length > 5) {
      return `Multiple phone numbers (${matches.length}) found in page source.`;
    }
    return null;
  },

  "email-exposure": (_url, _headers, body) => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = body.match(emailRegex) || [];
    const filtered = emails.filter((e) => {
      const lower = e.toLowerCase();
      const atIndex = lower.indexOf("@");
      if (atIndex === -1) return false;
      const domain = lower.substring(atIndex + 1);
      if (
        domain.endsWith(".png") ||
        domain.endsWith(".jpg") ||
        domain.endsWith(".svg") ||
        domain.endsWith(".gif") ||
        domain.endsWith(".webp")
      )
        return false;
      const testDomains = [
        "example.com",
        "example.org",
        "test.com",
        "test.org",
        "schema.org",
        "w3.org",
        "sentry.io",
      ];
      if (testDomains.some((d) => domain === d || domain.endsWith("." + d)))
        return false;
      if (lower.includes("@2x") || lower.includes("@3x")) return false;
      return true;
    });
    const unique = [...new Set(filtered)];
    return unique.length > 0
      ? `Found ${unique.length} email address(es): ${unique.slice(0, 3).join(", ")}`
      : null;
  },

  "email-address-leak": (_url, _headers, body) => {
    const matches =
      body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    if (matches.length > 10) {
      return `Many email addresses (${matches.length}) found in page source - potential data leak.`;
    }
    return null;
  },

  "hardcoded-ip-addresses": (url, _headers, body) => {
    const ipRe = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    const ips = body.match(ipRe) || [];
    const publicIps = ips.filter((ip) => {
      const parts = ip.split(".").map(Number);
      if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return false;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
      if (parts[0] === 192 && parts[1] === 168) return false;
      if (parts[0] === 169 && parts[1] === 254) return false;
      return true;
    });
    if (publicIps.length > 0)
      return `Found ${publicIps.length} hardcoded public IP address(es).`;
    if (/api\./.test(url)) {
      return `API endpoint ${url} — confirm no hardcoded IP addresses in source.`;
    }
    return null;
  },

  "private-ip-exposure": (url, _headers, body) => {
    const patterns = [
      /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
      /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "Private IP address found in source.";
    }
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review responses for private IP leakage.`;
    }
    return null;
  },

  "internal-ip-exposed": (url, _headers, body) => {
    const patterns = [
      /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
      /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
      /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /\b169\.254\.\d{1,3}\.\d{1,3}\b/,
      /\b0\.0\.0\.0\b/,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "Internal/private IP address found in body.";
    }
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review responses for internal IP leakage.`;
    }
    return null;
  },

  // ── Cloud creds / service-account / connection strings ──────────────────

  "firebase-config-exposed": (url, _headers, body) => {
    const patterns = [
      /apiKey\s*:\s*["']AIza[0-9A-Za-z_\-]{35}["']/,
      /projectId\s*:\s*["'][^"']+["']/,
      /firebase\.initializeApp\s*\(/,
      /firebaseConfig\s*[:=]/i,
    ];
    for (const p of patterns) {
      if (p.test(body))
        return "Firebase configuration pattern detected in source.";
    }
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review for Firebase config leaks (apiKey/projectId).`;
    }
    return null;
  },

  "s3-bucket-exposed": (url, _headers, body) => {
    const matches =
      body.match(/https?:\/\/[\w.-]+\.s3(?:\.[\w-]+)?\.amazonaws\.com/gi) || [];
    if (matches.length > 0)
      return `Found ${matches.length} AWS S3 bucket URL reference(s) in source.`;
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review for S3 bucket URL references.`;
    }
    return null;
  },

  "aws-metadata-reference": (url, _headers, body) => {
    const patterns = [
      /169\.254\.169\.254/,
      /latest\/meta-data/i,
      /\/metadata\/instance/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "AWS metadata endpoint reference detected.";
    }
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review for AWS metadata endpoint references.`;
    }
    return null;
  },

  "base64-credentials": (url, _headers, body) => {
    const re =
      /(?:Authorization|Proxy-Authorization)\s*:\s*Basic\s+([A-Za-z0-9+/=]{8,})/i;
    const matches = body.match(re) || [];
    if (matches.length > 0)
      return `Found ${matches.length} Basic Authorization header(s) with Base64 credential in source.`;
    if (/api\./.test(url)) {
      return `API endpoint ${url} — review source for embedded Base64 credentials.`;
    }
    return null;
  },

  "connection-string-exposed": (url, _headers, body) => {
    const patterns = [
      /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@[^\s"']+/i,
      /Server=[\w.-]+;.*Password=[^;]+/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "Database connection string pattern detected.";
    }
    if (/api\./.test(url)) {
      return `API endpoint ${url} — confirm no DB connection strings are surfaced.`;
    }
    return null;
  },

  // ── JWT / tokens / private keys ──────────────────────────────────────────

  "jwt-in-html": (_url, _headers, body) => {
    if (
      /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
        body,
      )
    ) {
      return "JWT token found embedded in HTML page source.";
    }
    return null;
  },

  "jwt-in-url": (_url, _headers, body) => {
    const jwtUrls =
      body.match(
        /(?:href|src|action|url)\s*=\s*["'][^"']*(?:\?|&)(?:token|jwt|access_token|auth)=eyJ[A-Za-z0-9_-]+/gi,
      ) || [];
    return jwtUrls.length > 0
      ? `Found ${jwtUrls.length} URL(s) containing JWT tokens.`
      : null;
  },

  "token-exposure": (_url, _headers, body) => {
    const sessions =
      body.match(
        /(?:PHPSESSID|JSESSIONID|ASP\.NET_SessionId)\s*=\s*[a-f0-9]{16,}/gi,
      ) || [];
    return sessions.length > 0
      ? `Session ID(s) exposed in source: ${sessions.length} found`
      : null;
  },

  "private-key-in-source": (url, _headers, body) => {
    if (
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/.test(body)
    ) {
      return "Private key material detected in source.";
    }
    if (/api\./.test(url)) {
      return `API endpoint ${url} — verify no private keys are exposed in responses.`;
    }
    return null;
  },

  // ── Hardcoded credentials ──────────────────────────────────────────────

  "hardcoded-secrets": (_url, _headers, body) => {
    const lowerBody = body.toLowerCase();
    const isDocPage =
      lowerBody.includes("documentation") &&
      lowerBody.includes("example") &&
      lowerBody.includes("api");

    const patterns = [
      { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
      {
        name: "Azure Storage Key",
        pattern:
          /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{86,88}/g,
      },
      {
        name: "GCP Service Account",
        pattern: /"type"\s*:\s*"service_account"/g,
      },
      { name: "Google API Key", pattern: /AIzaSy[0-9A-Za-z_-]{33}/g },
      {
        name: "Firebase Key",
        pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g,
      },
      { name: "Stripe Secret Key", pattern: /sk_live_[0-9a-zA-Z]{24,}/g },
      { name: "Stripe Restricted Key", pattern: /rk_live_[0-9a-zA-Z]{24,}/g },
      { name: "Stripe Webhook Secret", pattern: /whsec_[0-9a-zA-Z]{24,}/g },
      { name: "Square Access Token", pattern: /sq0atp-[0-9A-Za-z_-]{22}/g },
      { name: "Square OAuth Secret", pattern: /sq0csp-[0-9A-Za-z_-]{43}/g },
      { name: "GitHub Token", pattern: /gh[pousr]_[0-9A-Za-z]{36,}/g },
      { name: "GitHub OAuth", pattern: /gho_[0-9A-Za-z]{36,}/g },
      { name: "GitLab Token", pattern: /glpat-[0-9A-Za-z_-]{20,}/g },
      { name: "Bitbucket Token", pattern: /ATBB[0-9A-Za-z]{32,}/g },
      {
        name: "Slack Token",
        pattern: /xox[bpras]-[0-9]{10,}-[0-9a-zA-Z-]+/g,
      },
      {
        name: "Slack Webhook",
        pattern:
          /hooks\.slack\.com\/services\/T[0-9A-Z]{8,}\/B[0-9A-Z]{8,}\/[0-9A-Za-z]{24}/g,
      },
      {
        name: "Discord Bot Token",
        pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{38,}/g,
      },
      {
        name: "Discord Webhook",
        pattern:
          /discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,68}/g,
      },
      { name: "Twilio Account SID", pattern: /AC[0-9a-fA-F]{32}/g },
      {
        name: "SendGrid Key",
        pattern: /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/g,
      },
      { name: "Mailgun Key", pattern: /key-[0-9a-f]{32}/g },
      {
        name: "MongoDB URI",
        pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
      },
      {
        name: "PostgreSQL URI",
        pattern: /postgres(?:ql)?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
      },
      {
        name: "MySQL URI",
        pattern: /mysql:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
      },
      {
        name: "Redis URI",
        pattern: /rediss?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
      },
      {
        name: "Firebase URL",
        pattern: /https:\/\/[a-z0-9-]+\.firebaseio\.com/g,
      },
      { name: "OAuth Token", pattern: /ya29\.[0-9A-Za-z_-]{68,}/g },
      {
        name: "OpenAI Key",
        pattern: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/g,
      },
      { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{40,}/g },
      { name: "Anthropic Key", pattern: /sk-ant-[A-Za-z0-9_-]{40,}/g },
      { name: "HuggingFace Token", pattern: /hf_[A-Za-z0-9]{34,}/g },
      { name: "Replicate Token", pattern: /r8_[A-Za-z0-9]{40}/g },
      { name: "New Relic Key", pattern: /NRAK-[A-Z0-9]{27}/g },
      {
        name: "Sentry DSN",
        pattern: /https:\/\/[0-9a-f]{32}@[a-z0-9.]+\.sentry\.io\/\d+/g,
      },
      {
        name: "Mapbox Token",
        pattern: /pk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      },
      { name: "Facebook Token", pattern: /EAA[0-9A-Za-z]{100,}/g },
      { name: "RSA Private Key", pattern: /-----BEGIN RSA PRIVATE KEY-----/g },
      { name: "EC Private Key", pattern: /-----BEGIN EC PRIVATE KEY-----/g },
      {
        name: "PGP Private Key",
        pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
      },
      {
        name: "SSH Private Key",
        pattern: /-----BEGIN (?:OPENSSH |DSA )?PRIVATE KEY-----/g,
      },
      {
        name: "Generic Secret",
        pattern:
          /(?:api_secret|secret_key|private_key|client_secret|app_secret)\s*[:=]\s*["'][a-zA-Z0-9/+=_-]{20,}["']/gi,
      },
      {
        name: "Connection String",
        pattern:
          /(?:connection_string|database_url|dsn)\s*[:=]\s*["'][^"']{20,}["']/gi,
      },
    ];
    if (isDocPage) return null;

    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      const matches = body.match(pattern);
      if (matches) {
        const unique = [...new Set(matches)].filter((m) => {
          const lower = m.toLowerCase();
          if (
            lower.includes("example") ||
            lower.includes("your_") ||
            lower.includes("xxxx") ||
            lower.includes("0000")
          )
            return false;
          if (
            lower.includes("placeholder") ||
            lower.includes("test_") ||
            lower.includes("dummy")
          )
            return false;
          if (/localhost|127\.0\.0\.1/.test(m)) return false;
          return true;
        });
        if (unique.length === 0) continue;
        for (const match of unique.slice(0, 3)) {
          const len = match.length;
          const redacted =
            len <= 12
              ? match.slice(0, 4) + "****"
              : match.slice(0, 8) + "****" + match.slice(-4);
          found.push(`${name}: ${redacted}`);
        }
        if (unique.length > 3) {
          found.push(
            `  ...and ${unique.length - 3} more ${name} occurrence(s)`,
          );
        }
      }
    }
    return found.length > 0
      ? `Potential secrets detected:\n${found.join("\n")}`
      : null;
  },

  // ── Per-pattern secret detectors (one per JSON entry) ──────────────
  // Each detector scans the response body for a specific provider's
  // credential format and returns a short evidence string when it
  // matches. The registry's coverage test enforces that every JSON
  // entry has an inline detector; the tests below keep that contract.

  "secret-stripe-webhook-endpoint": (_url, _headers, body) => {
    if (!body) return null;
    if (/whsec_[0-9a-zA-Z]{24,}/.test(body)) {
      return "Response contains Stripe webhook signing secret (whsec_*).";
    }
    return null;
  },

  "secret-google-maps-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/AIzaSy[0-9A-Za-z_-]{33}/.test(body)) {
      return "Response contains Google Maps / API key (AIzaSy*).";
    }
    return null;
  },

  "secret-google-oauth-client-secret": (_url, _headers, body) => {
    if (!body) return null;
    if (/(?:google_)?client_secret[\s"'=:]+[A-Za-z0-9_-]{20,}/i.test(body)) {
      return "Response contains a Google OAuth client_secret.";
    }
    return null;
  },

  "secret-firebase-api-key-public": (_url, _headers, body) => {
    if (!body) return null;
    if (/firebase[\s\S]{0,200}?AIzaSy[0-9A-Za-z_-]{33}/i.test(body)) {
      return "Response contains a Firebase Web API key (AIzaSy*).";
    }
    return null;
  },

  "secret-aws-secret-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:aws_?secret_access_key|AKIA[0-9A-Z]{16})[\s\S]{0,200}?[A-Za-z0-9/+=]{40}/.test(
        body,
      )
    ) {
      return "Response contains an AWS Secret Access Key near an AKIA pair.";
    }
    return null;
  },

  "secret-github-personal-access-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/gh[pousr]_[0-9A-Za-z]{36,}/.test(body)) {
      return "Response contains a GitHub personal access token (gh*_*).";
    }
    return null;
  },

  "secret-npm-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/npm_[A-Za-z0-9]{36,}/.test(body)) {
      return "Response contains an npm auth token (npm_*).";
    }
    return null;
  },

  "secret-pypi-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/pypi-AgEIcHlwaS[A-Za-z0-9_-]{10,}/.test(body)) {
      return "Response contains a PyPI upload token (pypi-AgEIcHlwaS*).";
    }
    return null;
  },

  "secret-docker-hub-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/dckr_(?:pat|oat)_[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a Docker Hub access token (dckr_pat_*/dckr_oat_*).";
    }
    return null;
  },

  "secret-cloudflare-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:cloudflare|cf)[_\-]?(?:api[_\-]?key|api[_\-]?token)[\s"'=:]+[a-f0-9]{37,40}/i.test(
        body,
      )
    ) {
      return "Response contains a Cloudflare API key/token (40-char hex).";
    }
    return null;
  },

  "secret-tailscale-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/tskey-[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a Tailscale auth key (tskey-*).";
    }
    return null;
  },

  "secret-algolia-admin-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:algolia[_\-]?(?:admin|api)[_\-]?key|admin[_\-]?key)[\s"'=:]+[A-Za-z0-9]{32,}/i.test(
        body,
      )
    ) {
      return "Response contains an Algolia admin/search API key.";
    }
    return null;
  },

  "secret-mapbox-secret-token": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:mapbox[_\-]?(?:secret|token)|sk\.eyJ)[A-Za-z0-9_.\-]+/i.test(body)
    ) {
      return "Response contains a Mapbox secret token (sk.*).";
    }
    return null;
  },

  "secret-pagerduty-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:pagerduty|pd)[_\-]?(?:api[_\-]?key|rest[_\-]?key)[\s"'=:]+[A-Za-z0-9_\-+]{16,}/i.test(
        body,
      )
    ) {
      return "Response contains a PagerDuty REST API key.";
    }
    return null;
  },

  "secret-twilio-account-sid": (_url, _headers, body) => {
    if (!body) return null;
    if (/AC[a-f0-9]{32}/.test(body)) {
      return "Response contains a Twilio Account SID (AC*).";
    }
    return null;
  },

  "secret-datadog-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:datadog[_\-]?(?:api[_\-]?key|app[_\-]?key))[\s"'=:]+[a-f0-9]{32,}/i.test(
        body,
      )
    ) {
      return "Response contains a Datadog API key.";
    }
    return null;
  },

  "secret-huggingface-write-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/hf_[A-Za-z0-9]{34,}/.test(body)) {
      return "Response contains a HuggingFace write token (hf_*).";
    }
    return null;
  },

  "secret-pinecone-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:pinecone|pcsk)[_\-]?(?:api[_\-]?key|key)?[\s"'=:]+[A-Za-z0-9_\-]{40,}/i.test(
        body,
      )
    ) {
      return "Response contains a Pinecone API key.";
    }
    return null;
  },

  "secret-supabase-service-role": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /service_role[\s\S]{0,80}?eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
        body,
      )
    ) {
      return "Response contains a Supabase service_role JWT.";
    }
    return null;
  },

  "secret-supabase-anon-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:supabase[_\-]?anon[_\-]?key|anon[\s"'=:]+eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/i.test(
        body,
      )
    ) {
      return "Response contains a Supabase anon JWT.";
    }
    return null;
  },

  "secret-aws-access-key-id": (_url, _headers, body) => {
    if (!body) return null;
    if (/AKIA[0-9A-Z]{16}/.test(body)) {
      return "Response contains AWS Access Key ID.";
    }
    return null;
  },

  "secret-private-key-pem": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/.test(body)
    ) {
      return "Response contains a PEM private key block.";
    }
    return null;
  },

  "secret-jwt-in-config": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
        body,
      )
    ) {
      return "Response contains a JWT (likely stored in client config).";
    }
    return null;
  },

  "secret-oracle-cloud-credentials": (_url, _headers, body) => {
    if (!body) return null;
    if (/ocid1\.[a-z]+\.[a-z0-9]+\.[a-z0-9]{20,}/.test(body)) {
      return "Response contains an Oracle Cloud (OCI) OCID.";
    }
    return null;
  },

  "secret-ibm-cloud-iam-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:ibm[_\-]?(?:cloud[_\-]?)?(?:iam[_\-]?)?(?:api[_\-]?)?key|IBM-[A-Za-z0-9_-]{20,}|bx-[A-Za-z0-9]{40,})/i.test(
        body,
      )
    ) {
      return "Response contains an IBM Cloud IAM API key.";
    }
    return null;
  },

  "secret-digitalocean-pat": (_url, _headers, body) => {
    if (!body) return null;
    if (/dop_v1_[a-f0-9]{64}/.test(body)) {
      return "Response contains a DigitalOcean personal access token (dop_v1_*).";
    }
    return null;
  },

  "secret-linode-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:linode[_\-]?(?:api[_\-]?)?(?:key|token))[\s"'=:]+[a-f0-9]{64}/i.test(
        body,
      )
    ) {
      return "Response contains a Linode API token (64-char hex).";
    }
    return null;
  },

  "secret-vultr-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:vultr[_\-]?(?:api[_\-]?)?(?:key|token))[\s"'=:]+[A-Za-z0-9]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a Vultr API key.";
    }
    return null;
  },

  "secret-rubygems-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/rubygems_[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a RubyGems API key (rubygems_*).";
    }
    return null;
  },

  "secret-nuget-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/oy2_[a-z0-9]{30,}/.test(body)) {
      return "Response contains a NuGet API key (oy2_*).";
    }
    return null;
  },

  "secret-jfrog-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:jfrog|artifactory)[_\-]?(?:api[_\-]?)?(?:key|token)[\s"'=:]+[A-Za-z0-9_\-+/=]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a JFrog Artifactory API key/token.";
    }
    return null;
  },

  "secret-newrelic-browser-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/NRBR-[A-Z0-9]{27}/.test(body)) {
      return "Response contains a New Relic browser license key (NRBR-*).";
    }
    return null;
  },

  "secret-honeycomb-write-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:honeycomb|hcaak)[_\-]?(?:write[_\-]?)?(?:api[_\-]?)?(?:key|token)[\s"'=:]+[A-Za-z0-9]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a Honeycomb events API key.";
    }
    return null;
  },

  "secret-datadog-client-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/pub_[a-f0-9]{32,}/.test(body)) {
      return "Response contains a Datadog client token (pub_*).";
    }
    return null;
  },

  "secret-gitlab-deploy-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/gldt-[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a GitLab deploy token (gldt-*).";
    }
    return null;
  },

  "secret-gitlab-runner-registration": (_url, _headers, body) => {
    if (!body) return null;
    if (/GR1348941[A-Za-z0-9_-]{20,}/.test(body)) {
      return "Response contains a GitLab runner registration token (GR1348941*).";
    }
    return null;
  },

  "secret-bitbucket-app-password": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:bitbucket[_\-]?(?:app[_\-]?)?(?:password|token))[\s"'=:]+[A-Za-z0-9]{16,}/i.test(
        body,
      )
    ) {
      return "Response contains a Bitbucket app password/token.";
    }
    return null;
  },

  "secret-paypal-client-secret": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:paypal[_\-]?(?:client[_\-]?)?(?:secret|key))[\s"'=:]+[A-Za-z0-9_-]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a PayPal OAuth client secret.";
    }
    return null;
  },

  "secret-braintree-token": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:braintree[_\-]?(?:access[_\-]?)?(?:token|key))[\s"'=:]+[A-Za-z0-9]{16,}/i.test(
        body,
      )
    ) {
      return "Response contains a Braintree API access token.";
    }
    return null;
  },

  "secret-square-webhook-signature": (_url, _headers, body) => {
    if (!body) return null;
    if (/sq0sigp-[A-Za-z0-9_-]{40,}/.test(body)) {
      return "Response contains a Square webhook signature key (sq0sigp-*).";
    }
    return null;
  },

  "secret-twilio-api-key-sk": (_url, _headers, body) => {
    if (!body) return null;
    if (/SK[a-f0-9]{32}/.test(body)) {
      return "Response contains a Twilio API key SID (SK*).";
    }
    return null;
  },

  "secret-messagebird-access-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:messagebird|mb)[_\-]?(?:access[_\-]?)?(?:key|token)[\s"'=:]+[A-Za-z0-9_-]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a MessageBird access key.";
    }
    return null;
  },

  "secret-vonage-nexmo-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:vonage|nexmo)[_\-]?(?:api[_\-]?)?(?:key|secret)[\s"'=:]+[A-Za-z0-9_-]{8,}/i.test(
        body,
      )
    ) {
      return "Response contains a Vonage / Nexmo API key/secret pair.";
    }
    return null;
  },

  "secret-replicate-api-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/r8_[A-Za-z0-9]{40}/.test(body)) {
      return "Response contains a Replicate API token (r8_*).";
    }
    return null;
  },

  "secret-cohere-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:cohere[_\-]?(?:api[_\-]?)?(?:key|token))[\s"'=:]+[A-Za-z0-9_-]{30,}/i.test(
        body,
      )
    ) {
      return "Response contains a Cohere API key.";
    }
    return null;
  },

  "secret-mistral-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:mistral[_\-]?(?:api[_\-]?)?(?:key|token))[\s"'=:]+[A-Za-z0-9_-]{30,}/i.test(
        body,
      )
    ) {
      return "Response contains a Mistral AI API key.";
    }
    return null;
  },

  "secret-groq-api-key": (_url, _headers, body) => {
    if (!body) return null;
    if (/gsk_[A-Za-z0-9]{20,}/.test(body)) {
      return "Response contains a Groq API key (gsk_*).";
    }
    return null;
  },

  "secret-meilisearch-master-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:meilisearch|meili)[_\-]?(?:master[_\-]?)?(?:key|token)[\s"'=:]+[A-Za-z0-9_-]{32,}/i.test(
        body,
      )
    ) {
      return "Response contains a Meilisearch master/admin key.";
    }
    return null;
  },

  "secret-typesense-admin-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:typesense[_\-]?(?:admin[_\-]?)?(?:key|token))[\s"'=:]+[A-Za-z0-9]{32,}/i.test(
        body,
      )
    ) {
      return "Response contains a Typesense admin API key.";
    }
    return null;
  },

  "secret-planetscale-password": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:planetscale|pscale)[_\-]?(?:password|service[_\-]?token|api[_\-]?key)[\s"'=:]+[A-Za-z0-9_\-:.@]{20,}/i.test(
        body,
      )
    ) {
      return "Response contains a PlanetScale database password/service token.";
    }
    return null;
  },

  "secret-auth0-client-secret": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /(?:auth0[_\-]?client[_\-]?secret|client[_\-]?secret[\s"'=:]+[A-Za-z0-9_\-]{32,})/i.test(
        body,
      )
    ) {
      return "Response contains an Auth0 client secret.";
    }
    return null;
  },

  "secret-okta-api-token": (_url, _headers, body) => {
    if (!body) return null;
    if (/ssws_[0-9A-Za-z_-]{20,}/.test(body)) {
      return "Response contains an Okta SSWS API token.";
    }
    return null;
  },

  "secret-keycloak-realm-key": (_url, _headers, body) => {
    if (!body) return null;
    if (
      /keycloak[\s\S]{0,200}?(?:-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\bMI[E][A-Za-z0-9+/=]{40,}\b)/i.test(
        body,
      )
    ) {
      return "Response contains a Keycloak realm signing private key.";
    }
    return null;
  },
};
