/**
 * Supply-chain detectors.
 *
 * Checks for exposed dependency files, third-party script risks,
 * and source code artifacts that reveal the application's dependency
 * tree or enable supply-chain attacks.
 */

import { stripDocBlocks, type EvidenceFn as DetectFn } from "../_helpers";

const rawDetectors: Record<string, DetectFn> = {
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
    const reqLines = lines.filter((l) =>
      /^[\w.-]+==[0-9]+\.[0-9]/.test(l.trim()),
    );
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
    if (
      /^source\s+["']https:\/\/rubygems\.org["']/m.test(body) &&
      /^gem\s+/m.test(body)
    ) {
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
          // Only flag known CDN domains lacking SRI — not first-party.
          // maps.googleapis.com (Maps JavaScript API) is excluded: its
          // response is personalized per API key/session by design, so
          // there is no stable hash to pin and Google doesn't support SRI
          // for it.
          const isCdn =
            /(?:cdn\.|cdnjs\.|jsdelivr\.|unpkg\.|cloudflare\.|googleapis\.com|bootstrapcdn\.com)/i.test(
              host,
            ) && !/^maps\.googleapis\.com$/i.test(host);
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
    const httpScript =
      /<script[^>]+src=["'](http:\/\/(?!localhost)[^"']+)["']/i.exec(body);
    if (httpScript) {
      return `HTTP script src on HTTPS page: ${httpScript[1]} — network attackers can inject malicious code.`;
    }
    return null;
  },

  "supply-chain-composer-json-exposed": (_url, _headers, body) => {
    if (
      /"require"\s*:\s*\{/.test(body) &&
      /"require-dev"\s*:\s*\{/.test(body)
    ) {
      return "PHP composer.json exposed — reveals package dependencies and dev requirements.";
    }
    // composer.lock fingerprint
    if (/"content-hash"\s*:/.test(body) && /"packages"\s*:\s*\[/.test(body)) {
      return "PHP composer.lock exposed — reveals exact package versions including transitive dependencies.";
    }
    return null;
  },

  "supply-chain-dockerfile-exposed": (_url, _headers, body) => {
    if (
      /^FROM\s+\w/m.test(body) &&
      /^(?:RUN|COPY|ADD|ENV|EXPOSE|CMD|ENTRYPOINT)\s/m.test(body)
    ) {
      return "Dockerfile exposed — reveals base image, build steps, environment variables, and infrastructure details.";
    }
    if (
      /^version:\s*["']\d+(?:\.\d+)?["']$/m.test(body) &&
      /^\s+image:\s+/m.test(body)
    ) {
      return "docker-compose.yml exposed — reveals service topology and potentially embedded credentials.";
    }
    return null;
  },

  "supply-chain-env-file-exposed": (_url, _headers, body) => {
    // .env file fingerprint: lines of KEY=value with common secret names
    const envLines = body
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l.trim())).length;
    if (envLines >= 3) {
      const hasSecrets =
        /(?:PASSWORD|SECRET|KEY|TOKEN|API|DSN|DATABASE_URL)\s*=/i.test(body);
      if (hasSecrets) {
        return `.env configuration file exposed with ${envLines}+ environment variables including secret keys.`;
      }
    }
    return null;
  },

  "supply-chain-cdn-script-unpinned-version": (_url, _headers, body) => {
    // Only jsdelivr's npm alias and unpkg resolve an unversioned path to
    // "whatever is newest right now"; cdnjs/googleapis/bootstrapcdn URLs
    // always embed the version as a path segment, so they don't apply here.
    const scriptPattern =
      /<script[^>]+src=["'](https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/)[^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    let found = 0;
    let sample = "";
    while ((m = scriptPattern.exec(body)) !== null) {
      const tag = m[0];
      const scriptUrl = m[1];
      if (/integrity\s*=/i.test(tag)) continue;
      const afterHost = scriptUrl.replace(
        /^https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/)/i,
        "",
      );
      const segments = afterHost.split("/");
      const pkgSpec = segments[0].startsWith("@")
        ? `${segments[0]}/${segments[1] ?? ""}`
        : segments[0];
      const nameOnly = pkgSpec.startsWith("@")
        ? pkgSpec.slice(pkgSpec.indexOf("/") + 1)
        : pkgSpec;
      const at = nameOnly.indexOf("@");
      const version = at === -1 ? null : nameOnly.slice(at + 1);
      if (version === null || version === "" || /^latest$/i.test(version)) {
        found++;
        if (!sample) sample = scriptUrl;
      }
    }
    if (found > 0) {
      return `${found} CDN script(s) loaded with no pinned version and no SRI hash (e.g. ${sample}); content can silently change on every page load.`;
    }
    return null;
  },

  "supply-chain-composer-auth-json-exposed": (_url, _headers, body) => {
    const authKeyPattern =
      /"(?:http-basic|github-oauth|gitlab-token|gitlab-oauth|bitbucket-oauth)"\s*:\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = authKeyPattern.exec(body)) !== null) {
      const idx = m.index;
      const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
      if (/<code|<pre|```|example|documentation/.test(before)) continue;
      const window = body.slice(idx, Math.min(body.length, idx + 400));
      // http-basic nests username/password; the OAuth-style keys map a
      // host directly to a token string with no intermediate key name.
      const credMatch =
        window.match(/"(?:password|token|secret)"\s*:\s*"([^"]{6,})"/i) ||
        window.match(
          /"(?:github-oauth|gitlab-token|gitlab-oauth|bitbucket-oauth)"\s*:\s*\{\s*"[^"]+"\s*:\s*"([^"]{10,})"/,
        );
      if (!credMatch) continue;
      const value = credMatch[1].toLowerCase();
      if (
        value.includes("example") ||
        value.includes("xxxx") ||
        value.includes("0000") ||
        value.includes("placeholder") ||
        value.includes("test_") ||
        value.includes("dummy") ||
        value.includes("your_")
      )
        continue;
      return "PHP Composer auth.json exposed with a live registry credential (http-basic password or OAuth token).";
    }
    return null;
  },

  "supply-chain-cargo-lock-exposed": (_url, _headers, body) => {
    // "source = registry+https://github.com/rust-lang/crates.io-index" is
    // a literal string Cargo writes verbatim; nothing else produces it.
    if (
      /^\[\[package\]\]$/m.test(body) &&
      /source\s*=\s*"registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"/.test(
        body,
      )
    ) {
      return "Rust Cargo.lock exposed, revealing exact crate versions including transitive dependencies.";
    }
    return null;
  },

  "supply-chain-go-sum-exposed": (_url, _headers, body) => {
    // go.sum lines are "<module path> <version>[/go.mod] h1:<base64 hash>=";
    // require 2+ to rule out a coincidental single-line match.
    const goSumLines = body
      .split("\n")
      .filter((l) =>
        /^[\w.-]+(?:\/[\w.-]+)+ v\d+\.\d+\.\d+\S* h1:[A-Za-z0-9+/]{20,}=+$/.test(
          l.trim(),
        ),
      );
    if (goSumLines.length >= 2) {
      return `Go go.sum file exposed with ${goSumLines.length}+ module checksum entries, revealing the full dependency tree.`;
    }
    return null;
  },

  "supply-chain-malicious-install-script": (_url, _headers, body) => {
    const scriptKeyPattern =
      /"(?:preinstall|postinstall|install)"\s*:\s*"([^"]{0,300})"/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptKeyPattern.exec(body)) !== null) {
      const idx = m.index;
      const before = body.slice(Math.max(0, idx - 600), idx);
      if (!/"scripts"\s*:\s*\{/.test(before)) continue;
      const scriptValue = m[1];
      if (
        !/\b(?:curl|wget)\b[\s\S]{0,80}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|node)\b/i.test(
          scriptValue,
        )
      )
        continue;
      if (/<code|<pre|```|example|documentation/i.test(before)) continue;
      return `package.json install hook pipes a remote download directly into a shell: "${scriptValue.slice(0, 120)}".`;
    }
    return null;
  },

  // Actually async: queries OSV.dev live for every detected client-side
  // library, so it needs a real network round-trip a synchronous
  // (url, headers, body) detector can't make. Runs from
  // lib/scanner/osv-check.ts (invoked via lib/scanner/async-checks.ts); this
  // placeholder only exists so the registry's coverage test can map the
  // JSON id to a known name, the same pattern
  // lib/scanner/checks/active-probes.ts uses for its own async checks.
  "osv-vulnerable-library": () => null,
};

// A raw config/lockfile/dotenv response has no HTML tags, so stripDocBlocks
// is a no-op for the real detection case these checks exist for. It matters
// for the false-positive case: a tutorial or blog post rendering example
// lockfile/.env/Dockerfile content inside a <pre>/<code> block as
// documentation, which would otherwise satisfy these same fingerprint
// patterns as literal page text.
export const detectors: Record<string, DetectFn> = Object.fromEntries(
  Object.entries(rawDetectors).map(([id, fn]) => [
    id,
    ((url, headers, body) =>
      fn(url, headers, stripDocBlocks(body))) as DetectFn,
  ]),
);
