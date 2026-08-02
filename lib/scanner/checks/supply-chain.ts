/**
 * Supply-chain detectors.
 *
 * Checks for exposed dependency files, third-party script risks,
 * and source code artifacts that reveal the application's dependency
 * tree or enable supply-chain attacks.
 */

import { type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "supply-chain-lockfile-exposed": (_url, _headers, body) => {
    // npm/yarn/pnpm lock file fingerprints
    if (/"lockfileVersion"\s*:\s*\d/.test(body)) {
      return "npm package-lock.json exposed — reveals exact dependency tree with versions.";
    }
    if (/^# yarn lockfile/m.test(body) || /^__metadata:$/m.test(body)) {
      return "yarn.lock exposed — reveals complete dependency tree with exact versions.";
    }
    if (/^lockfileVersion:\s*\d/m.test(body)) {
      return "pnpm-lock.yaml exposed — reveals dependency tree.";
    }
    return null;
  },

  "supply-chain-requirements-exposed": (_url, _headers, body) => {
    // Python requirements.txt: lines of "package==version" or "package>=version"
    const lines = body.split("\n").slice(0, 20);
    const reqLines = lines.filter((l) => /^[\w.-]+==[0-9]+\.[0-9]/.test(l.trim()));
    if (reqLines.length >= 3) {
      return `Python requirements file exposed with ${reqLines.length}+ pinned dependencies.`;
    }
    // Pipfile
    if (/^\[packages\]/m.test(body) && /^\[dev-packages\]/m.test(body)) {
      return "Python Pipfile exposed — reveals package dependencies.";
    }
    return null;
  },

  "supply-chain-gemfile-exposed": (_url, _headers, body) => {
    if (/^GEM\s*$/m.test(body) && /BUNDLED WITH/i.test(body)) {
      return "Ruby Gemfile.lock exposed — reveals gem versions including transitive dependencies.";
    }
    if (/^source\s+["']https:\/\/rubygems\.org["']/m.test(body) && /^gem\s+/m.test(body)) {
      return "Ruby Gemfile exposed — reveals gem dependencies.";
    }
    return null;
  },

  "supply-chain-sri-external-script": (_url, _headers, body) => {
    const externalScriptPattern =
      /<script[^>]+src=["'](https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    let found = 0;
    while ((m = externalScriptPattern.exec(body)) !== null) {
      const tag = m[0];
      const url = m[1];
      if (!/integrity\s*=/i.test(tag)) {
        try {
          const host = new URL(url).hostname;
          // Only flag known CDN domains lacking SRI — not first-party
          const isCdn = /(?:cdn\.|cdnjs\.|jsdelivr\.|unpkg\.|cloudflare\.|googleapis\.com|bootstrapcdn\.com)/i.test(host);
          if (isCdn) found++;
        } catch {
          // invalid URL
        }
      }
    }
    if (found > 0) {
      return `${found} CDN script(s) loaded without SRI integrity hash — CDN compromise would silently inject malicious code.`;
    }
    return null;
  },

  "supply-chain-http-script-on-https": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const httpScript = /<script[^>]+src=["'](http:\/\/(?!localhost)[^"']+)["']/i.exec(body);
    if (httpScript) {
      return `HTTP script src on HTTPS page: ${httpScript[1]} — network attackers can inject malicious code.`;
    }
    return null;
  },

  "supply-chain-composer-json-exposed": (_url, _headers, body) => {
    if (/"require"\s*:\s*\{/.test(body) && /"require-dev"\s*:\s*\{/.test(body)) {
      return "PHP composer.json exposed — reveals package dependencies and dev requirements.";
    }
    // composer.lock fingerprint
    if (/"content-hash"\s*:/.test(body) && /"packages"\s*:\s*\[/.test(body)) {
      return "PHP composer.lock exposed — reveals exact package versions including transitive dependencies.";
    }
    return null;
  },

  "supply-chain-dockerfile-exposed": (_url, _headers, body) => {
    if (/^FROM\s+\w/m.test(body) && /^(?:RUN|COPY|ADD|ENV|EXPOSE|CMD|ENTRYPOINT)\s/m.test(body)) {
      return "Dockerfile exposed — reveals base image, build steps, environment variables, and infrastructure details.";
    }
    if (/^version:\s*["']\d+["']$/m.test(body) && /^\s+image:\s+/m.test(body)) {
      return "docker-compose.yml exposed — reveals service topology and potentially embedded credentials.";
    }
    return null;
  },

  "supply-chain-env-file-exposed": (_url, _headers, body) => {
    // .env file fingerprint: lines of KEY=value with common secret names
    const envLines = body
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l.trim()))
      .length;
    if (envLines >= 3) {
      const hasSecrets =
        /(?:PASSWORD|SECRET|KEY|TOKEN|API|DSN|DATABASE_URL)\s*=/i.test(body);
      if (hasSecrets) {
        return `.env configuration file exposed with ${envLines}+ environment variables including secret keys.`;
      }
    }
    return null;
  },
};
