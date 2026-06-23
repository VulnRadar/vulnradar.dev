/**
 * Extended secrets detectors.
 *
 * Focused on credential / token / PII exposure — split out of the
 * generic "code" category so that consumers can scope scans to either
 * "is my code risky?" (code) or "is my data leaking?" (secrets-extended).
 */

import { escapeRegExp, type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  // ── Credit cards / SSN / phone / email ────────────────────────────────────

  "credit-card-pattern": (_url, _headers, body) => {
    if (
      /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/.test(
        body,
      )
    ) {
      return "Potential credit card number pattern found in page source.";
    }
    return null;
  },

  "ssn-pattern": (_url, _headers, body) => {
    const idx = body.search(/\b\d{3}-\d{2}-\d{4}\b/);
    if (idx !== -1 && !/<script/i.test(body.substring(0, idx))) {
      return "Potential SSN pattern found in page content.";
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

  "hardcoded-ip-addresses": (_url, _headers, body) => {
    const ipPattern =
      /(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)/g;
    const ips = body.match(ipPattern) || [];
    const filtered = ips.filter(
      (ip) =>
        ip !== "0.0.0.0" &&
        ip !== "127.0.0.1" &&
        ip !== "255.255.255.255" &&
        !ip.startsWith("0."),
    );
    const unique = [...new Set(filtered)];
    return unique.length >= 2
      ? `Found ${unique.length} IP address(es): ${unique.slice(0, 3).join(", ")}`
      : null;
  },

  "private-ip-exposure": (_url, _headers, body) => {
    const privateIPs =
      body.match(
        /(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})/g,
      ) || [];
    const filtered = [...new Set(privateIPs)].filter((ip) => {
      const escapedIp = escapeRegExp(ip);
      const schemaPattern = new RegExp(
        `"@context"\\s*:\\s*"https?://schema\\.org"[\\s\\S]*?"${escapedIp}"|"${escapedIp}".{0,100}"@context"\\s*:\\s*"https?://schema\\.org"`,
        "i",
      );
      return !schemaPattern.test(body);
    });
    return filtered.length > 0
      ? `Private IP addresses found: ${filtered.slice(0, 5).join(", ")}`
      : null;
  },

  "internal-ip-exposed": (_url, _headers, _body) => null,

  // ── Cloud creds / service-account / connection strings ──────────────────

  "firebase-config-exposed": (_url, _headers, body) => {
    if (
      /firebaseConfig\s*=\s*\{/.test(body) &&
      /apiKey/.test(body) &&
      /authDomain/.test(body)
    ) {
      return "Firebase configuration object with API key found in page source.";
    }
    return null;
  },

  "s3-bucket-exposed": (_url, _headers, body) => {
    if (
      /[a-z0-9.-]+\.s3[.-](?:us|eu|ap|sa|ca|me|af)-[a-z]+-\d\.amazonaws\.com/i.test(
        body,
      ) ||
      /s3:\/\/[a-z0-9.-]+/i.test(body)
    ) {
      return "AWS S3 bucket reference found in page source.";
    }
    return null;
  },

  "aws-metadata-reference": (_url, _headers, body) => {
    if (body.includes("169.254.169.254")) {
      return "AWS metadata endpoint IP (169.254.169.254) found in page source.";
    }
    return null;
  },

  "base64-credentials": (_url, _headers, body) => {
    const matches = body.match(/[Bb]asic\s+[A-Za-z0-9+/]{20,}={0,2}/g);
    if (!matches) return null;
    return `Basic authentication credentials (Base64) found in page source: ${matches.length} occurrence(s).`;
  },

  "connection-string-exposed": (_url, _headers, body) => {
    if (
      /(?:mongodb|mysql|postgres|redis):\/\/[^"'\s<]+@[^"'\s<]+/i.test(body)
    ) {
      return "Database connection string with credentials found in page source.";
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

  "private-key-in-source": (_url, _headers, body) => {
    if (/-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/.test(body)) {
      return "Private key material found in page source!";
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
};
