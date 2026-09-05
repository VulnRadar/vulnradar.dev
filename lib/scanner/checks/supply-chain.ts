/**
 * Supply-chain detectors.
 *
 * Checks for exposed dependency files, third-party script risks,
 * and source code artifacts that reveal the application's dependency
 * tree or enable supply-chain attacks.
 */

import {
  withDocBlocksStripped,
  type EvidenceFn as DetectFn,
} from "../_helpers";
import { tagsWith, tagElements } from "./_tag-scan";

// ── Shared helpers for the manifest / CDN detectors below ─────────────────
//
// Every manifest detector anchors on a literal marker with indexOf before it
// runs any regex. A served lockfile is small and matches immediately; the
// expensive case this protects against is the other 99.9% of scans, where the
// body is a 1 MiB HTML page and the marker is simply absent.

/** The src/href URL of an opening tag, or null. */
function tagUrl(tag: string): string | null {
  return /\b(?:src|href)\s*=\s*["']([^"']{1,600})["']/i.exec(tag)?.[1] ?? null;
}

/** The hostname of an absolute URL, or null for a relative one. */
function absoluteHost(url: string): string | null {
  if (!/^(?:https?:)?\/\//i.test(url)) return null;
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url).hostname;
  } catch {
    return null;
  }
}

/** The text inside every `<script type="importmap">` element. */
function importMapBodies(body: string): string[] {
  if (body.indexOf("importmap") === -1) return [];
  const out: string[] = [];
  for (const element of tagElements(body, "script")) {
    const open = element.slice(0, element.indexOf(">") + 1);
    if (!/type\s*=\s*["']importmap["']/i.test(open)) continue;
    out.push(element.slice(open.length));
  }
  return out;
}

/**
 * True when a CDN package path carries no explicit version.
 * `lodash@4.17.21/lodash.js` is pinned; `lodash/lodash.js` and
 * `lodash@latest/lodash.js` are not.
 */
function cdnPathIsUnpinned(afterHost: string): boolean {
  const segments = afterHost.replace(/^\/+/, "").split("/");
  if (segments.length === 0) return false;
  const pkgSpec = segments[0].startsWith("@")
    ? `${segments[0]}/${segments[1] ?? ""}`
    : segments[0];
  const nameOnly = pkgSpec.startsWith("@")
    ? pkgSpec.slice(pkgSpec.indexOf("/") + 1)
    : pkgSpec;
  const at = nameOnly.indexOf("@");
  if (at === -1) return true;
  const version = nameOnly.slice(at + 1);
  return version === "" || /^latest$/i.test(version);
}

const rawDetectors: Record<string, DetectFn> = {
  "supply-chain-lockfile-exposed": (_url, _headers, body) => {
    // npm/yarn/pnpm lock file fingerprints
    if (/"lockfileVersion"\s*:\s*\d/.test(body)) {
      return "npm package-lock.json exposed: reveals exact dependency tree with versions.";
    }
    if (/^# yarn lockfile/m.test(body) || /^__metadata:$/m.test(body)) {
      return "yarn.lock exposed: reveals complete dependency tree with exact versions.";
    }
    if (/^lockfileVersion:\s*\d/m.test(body)) {
      return "pnpm-lock.yaml exposed: reveals dependency tree.";
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
      return "Python Pipfile exposed: reveals package dependencies.";
    }
    return null;
  },

  "supply-chain-gemfile-exposed": (_url, _headers, body) => {
    if (/^GEM\s*$/m.test(body) && /BUNDLED WITH/i.test(body)) {
      return "Ruby Gemfile.lock exposed: reveals gem versions including transitive dependencies.";
    }
    if (
      /^source\s+["']https:\/\/rubygems\.org["']/m.test(body) &&
      /^gem\s+/m.test(body)
    ) {
      return "Ruby Gemfile exposed: reveals gem dependencies.";
    }
    return null;
  },

  "supply-chain-sri-external-script": (_url, _headers, body) => {
    const srcRe =
      /src=["'](https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^"']+)["']/i;
    let found = 0;
    for (const tag of tagsWith(body, "script", srcRe)) {
      const url = srcRe.exec(tag)?.[1] ?? "";
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
      return `${found} CDN script(s) loaded without SRI integrity hash: a CDN compromise would silently inject malicious code.`;
    }
    return null;
  },

  "supply-chain-http-script-on-https": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const httpSrcRe = /src=["'](http:\/\/(?!localhost)[^"']+)["']/i;
    const httpScript = tagsWith(body, "script", httpSrcRe)[0];
    if (httpScript) {
      const src = httpSrcRe.exec(httpScript)?.[1] ?? "";
      return `HTTP script src on HTTPS page: ${src}. Network attackers can inject malicious code.`;
    }
    return null;
  },

  "supply-chain-composer-json-exposed": (_url, _headers, body) => {
    if (
      /"require"\s*:\s*\{/.test(body) &&
      /"require-dev"\s*:\s*\{/.test(body)
    ) {
      return "PHP composer.json exposed: reveals package dependencies and dev requirements.";
    }
    // composer.lock fingerprint
    if (/"content-hash"\s*:/.test(body) && /"packages"\s*:\s*\[/.test(body)) {
      return "PHP composer.lock exposed: reveals exact package versions including transitive dependencies.";
    }
    return null;
  },

  "supply-chain-dockerfile-exposed": (_url, _headers, body) => {
    if (
      /^FROM\s+\w/m.test(body) &&
      /^(?:RUN|COPY|ADD|ENV|EXPOSE|CMD|ENTRYPOINT)\s/m.test(body)
    ) {
      return "Dockerfile exposed: reveals base image, build steps, environment variables, and infrastructure details.";
    }
    if (
      /^version:\s*["']\d+(?:\.\d+)?["']$/m.test(body) &&
      /^\s+image:\s+/m.test(body)
    ) {
      return "docker-compose.yml exposed: reveals service topology and potentially embedded credentials.";
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
    const cdnSrcRe =
      /src=["'](https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/)[^"']+)["']/i;
    let found = 0;
    let sample = "";
    for (const tag of tagsWith(body, "script", cdnSrcRe)) {
      const scriptUrl = cdnSrcRe.exec(tag)?.[1] ?? "";
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

  // ── Dependency manifests and lockfiles, one ecosystem per detector ──────

  "supply-chain-poetry-lock-exposed": (_url, _headers, body) => {
    if (body.indexOf("[[package]]") === -1) return null;
    if (!/^\[\[package\]\]$/m.test(body)) return null;
    // Cargo.lock uses the same [[package]] table, so require a marker only
    // Poetry writes: its generation banner, or the [metadata] lock-version
    // key Cargo does not have.
    const isPoetry =
      /generated by Poetry/i.test(body) ||
      (/^\[metadata\]$/m.test(body) && /^lock-version\s*=/m.test(body));
    if (!isPoetry) return null;
    const count = (body.match(/^\[\[package\]\]$/gm) || []).length;
    return `Python poetry.lock exposed with ${count} pinned package entries, revealing the full resolved dependency tree including transitive packages.`;
  },

  "supply-chain-pipfile-lock-exposed": (_url, _headers, body) => {
    if (body.indexOf("pipfile-spec") === -1) return null;
    if (!/"pipfile-spec"\s*:\s*\d/.test(body)) return null;
    if (body.indexOf('"_meta"') === -1) return null;
    return "Python Pipfile.lock exposed, revealing every resolved package version and its hash, including development dependencies.";
  },

  "supply-chain-gradle-lockfile-exposed": (_url, _headers, body) => {
    const banner = /Gradle generated file for dependency locking/i.test(body);
    const entries = body
      .split("\n")
      .filter((l) => /^[\w.-]+:[\w.-]+:[\w.+-]+=[\w,]+$/.test(l.trim())).length;
    if (!banner && entries < 3) return null;
    return `Gradle dependency lockfile exposed with ${entries} locked coordinate entries, revealing every resolved JVM dependency and the configurations it is used in.`;
  },

  "supply-chain-maven-pom-exposed": (_url, _headers, body) => {
    if (body.indexOf("modelVersion") === -1) return null;
    if (!/<modelVersion>\s*4\.0\.0\s*<\/modelVersion>/i.test(body)) return null;
    if (!/<artifactId>/i.test(body)) return null;
    const deps = (body.match(/<dependency>/gi) || []).length;
    return `Maven pom.xml exposed${deps > 0 ? ` with ${deps} declared dependencies` : ""}, revealing the JVM dependency tree, build plugins, and any repository URLs the build resolves against.`;
  },

  "supply-chain-nuget-manifest-exposed": (_url, _headers, body) => {
    if (/<package\s+id="[^"]{1,120}"\s+version="[^"]{1,60}"/i.test(body)) {
      return "NuGet packages.config exposed, revealing every referenced .NET package and its exact version.";
    }
    if (
      body.indexOf("contentHash") > -1 &&
      /"resolved"\s*:\s*"[\d.]/.test(body)
    ) {
      return "NuGet packages.lock.json exposed, revealing the fully resolved .NET dependency graph including transitive packages and their content hashes.";
    }
    return null;
  },

  "supply-chain-mix-lock-exposed": (_url, _headers, body) => {
    if (body.indexOf(":hex,") === -1) return null;
    const entries = (
      body.match(/"[\w-]{1,60}"\s*:\s*\{:hex,\s*:[\w-]{1,60},/g) || []
    ).length;
    if (entries < 2) return null;
    return `Elixir mix.lock exposed with ${entries} Hex package entries, revealing the full resolved dependency tree.`;
  },

  "supply-chain-pubspec-lock-exposed": (_url, _headers, body) => {
    if (body.indexOf("dependency:") === -1) return null;
    if (!/^\s{0,8}dependency:\s+"?direct (?:main|dev)"?/m.test(body))
      return null;
    if (!/^packages:/m.test(body)) return null;
    return "Dart/Flutter pubspec.lock exposed, revealing every resolved package, its source, and the exact version the build pins.";
  },

  "supply-chain-swift-package-resolved-exposed": (_url, _headers, body) => {
    if (body.indexOf('"pins"') === -1) return null;
    const hasPins =
      /"pins"\s*:\s*\[/.test(body) &&
      (/"revision"\s*:\s*"[0-9a-f]{7,40}"/i.test(body) ||
        /"repositoryURL"\s*:\s*"/.test(body) ||
        /"location"\s*:\s*"https?:\/\//.test(body));
    if (!hasPins) return null;
    return "Swift Package.resolved exposed, revealing every package dependency, its source repository, and the exact commit the build is pinned to.";
  },

  "supply-chain-podfile-lock-exposed": (_url, _headers, body) => {
    if (body.indexOf("SPEC CHECKSUMS") === -1) return null;
    if (!/^PODS:$/m.test(body) || !/^SPEC CHECKSUMS:$/m.test(body)) return null;
    return "CocoaPods Podfile.lock exposed, revealing every iOS/macOS pod dependency, its resolved version, and the checksum of each spec.";
  },

  "supply-chain-terraform-lock-exposed": (_url, _headers, body) => {
    if (body.indexOf("registry.terraform.io/") === -1) return null;
    if (
      !/provider\s+"registry\.terraform\.io\/[\w-]{1,60}\/[\w-]{1,60}"/.test(
        body,
      )
    ) {
      return null;
    }
    if (!/hashes\s*=\s*\[/.test(body)) return null;
    const providers = (
      body.match(/provider\s+"registry\.terraform\.io\//g) || []
    ).length;
    return `Terraform .terraform.lock.hcl exposed with ${providers} pinned provider(s), revealing which cloud and SaaS providers this infrastructure is built on and the exact provider versions in use.`;
  },

  "supply-chain-cargo-toml-exposed": (_url, _headers, body) => {
    if (body.indexOf("[dependencies]") === -1) return null;
    if (!/^\[package\]$/m.test(body)) return null;
    if (!/^\s*edition\s*=\s*"20\d\d"/m.test(body)) return null;
    if (!/^\[dependencies\]$/m.test(body)) return null;
    return "Rust Cargo.toml exposed, revealing the crate's direct dependencies, its feature flags, and any git or path dependencies the build pulls in.";
  },

  "supply-chain-go-mod-exposed": (_url, _headers, body) => {
    if (body.indexOf("module ") === -1) return null;
    if (!/^module\s+[\w.\-~/]{3,200}$/m.test(body)) return null;
    if (!/^go\s+1\.\d{1,2}(?:\.\d{1,2})?$/m.test(body)) return null;
    return "Go go.mod exposed, revealing the module path (often an internal repository URL), the Go toolchain version, and every direct dependency with its version.";
  },

  "supply-chain-setup-py-exposed": (_url, _headers, body) => {
    if (body.indexOf("install_requires") === -1) return null;
    if (!/install_requires\s*=\s*\[/.test(body)) return null;
    if (!/\bsetup\s*\(/.test(body)) return null;
    return "Python setup.py source exposed, revealing declared runtime dependencies, extras, and any custom build or install commands the package runs.";
  },

  "supply-chain-pyproject-toml-exposed": (_url, _headers, body) => {
    const marker =
      /^\[tool\.poetry\]$/m.test(body) ||
      /^\[build-system\]$/m.test(body) ||
      (/^\[project\]$/m.test(body) && /^requires-python\s*=/m.test(body));
    if (!marker) return null;
    return "Python pyproject.toml exposed, revealing the project's declared dependencies, optional dependency groups, and build backend.";
  },

  "supply-chain-git-dependency-unpinned": (_url, _headers, body) => {
    if (body.indexOf('"dependencies"') === -1) return null;
    if (!/"dependencies"\s*:\s*\{/.test(body)) return null;
    const gitDeps =
      /"([\w@/.-]{1,80})"\s*:\s*"((?:git\+(?:https?|ssh):\/\/|git:\/\/|github:)[^"]{1,240})"/g;
    let m: RegExpExecArray | null;
    while ((m = gitDeps.exec(body)) !== null) {
      const spec = m[2];
      // A 40-character hex fragment is an immutable commit pin; a branch or
      // tag name, or no fragment at all, is not.
      if (/#[0-9a-f]{40}$/i.test(spec)) continue;
      if (/#semver:/i.test(spec)) continue;
      return `Dependency "${m[1]}" resolves from a git source with no commit pin: "${spec.slice(0, 160)}".`;
    }
    return null;
  },

  // ── Module loading from CDNs ───────────────────────────────────────────

  "supply-chain-importmap-unpinned-cdn": (_url, _headers, body) => {
    for (const map of importMapBodies(body)) {
      const urls =
        map.match(
          /https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/|esm\.sh\/|cdn\.skypack\.dev\/|esm\.run\/)[^"']{0,240}/gi,
        ) || [];
      for (const target of urls) {
        const afterHost = target.replace(
          /^https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/|esm\.sh\/|cdn\.skypack\.dev\/|esm\.run\/)/i,
          "",
        );
        if (cdnPathIsUnpinned(afterHost)) {
          return `Import map resolves a bare specifier to an unversioned CDN URL: ${target.slice(0, 200)}`;
        }
      }
    }
    return null;
  },

  "supply-chain-importmap-insecure-source": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    for (const map of importMapBodies(body)) {
      const insecure =
        /"(http:\/\/(?!localhost|127\.0\.0\.1)[^"]{1,240})"/i.exec(map);
      if (insecure) {
        return `Import map on an HTTPS page resolves a module to a cleartext URL: ${insecure[1].slice(0, 200)}`;
      }
    }
    return null;
  },

  "supply-chain-esm-cdn-unpinned-import": (_url, _headers, body) => {
    if (
      body.indexOf("esm.sh/") === -1 &&
      body.indexOf("skypack.dev/") === -1 &&
      body.indexOf("esm.run/") === -1
    ) {
      return null;
    }
    const importRe =
      /\bfrom\s*["'](https?:\/\/(?:esm\.sh|cdn\.skypack\.dev|esm\.run)\/[^"']{1,240})["']/gi;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(body)) !== null) {
      const afterHost = m[1].replace(
        /^https?:\/\/(?:esm\.sh|cdn\.skypack\.dev|esm\.run)\//i,
        "",
      );
      if (cdnPathIsUnpinned(afterHost)) {
        return `ES module imported from an unversioned CDN specifier: ${m[1].slice(0, 200)}`;
      }
    }
    return null;
  },

  "supply-chain-jsdelivr-gh-branch-reference": (_url, _headers, body) => {
    if (body.indexOf("cdn.jsdelivr.net/gh/") === -1) return null;
    const re =
      /https?:\/\/cdn\.jsdelivr\.net\/gh\/([\w.-]{1,60})\/([\w.-]{1,80})(@[\w.-]{1,60})?\//gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const ref = m[3] ? m[3].slice(1) : "";
      if (ref && !/^(?:master|main|latest|HEAD)$/i.test(ref)) continue;
      return `Script served from jsDelivr's GitHub passthrough at a moving reference: cdn.jsdelivr.net/gh/${m[1]}/${m[2]}${m[3] ?? ""}. Whatever that branch points at right now is what executes on this page.`;
    }
    return null;
  },

  "supply-chain-rawgit-cdn-reference": (_url, _headers, body) => {
    if (body.indexOf("rawgit.com") === -1) return null;
    const ref = /https?:\/\/(?:cdn\.)?rawgit\.com\/[^"'\s]{0,200}/i.exec(body);
    if (!ref) return null;
    return `Page references RawGit (${ref[0].slice(0, 160)}), a CDN that was shut down in October 2019.`;
  },

  "supply-chain-github-raw-script-source": (_url, _headers, body) => {
    if (
      body.indexOf("raw.githubusercontent.com") === -1 &&
      body.indexOf("gist.githubusercontent.com") === -1
    ) {
      return null;
    }
    const srcRe =
      /src=["']https?:\/\/(?:raw|gist)\.githubusercontent\.com\/[^"']{1,300}["']/i;
    const tag = tagsWith(body, "script", srcRe)[0];
    if (!tag) return null;
    const src = tagUrl(tag) ?? "";
    return `Executable script loaded straight from GitHub raw content: ${src.slice(0, 200)}`;
  },

  "supply-chain-node-modules-path-served": (_url, _headers, body) => {
    if (body.indexOf("/node_modules/") === -1) return null;
    for (const tag of [
      ...tagsWith(body, "script", /\/node_modules\//i),
      ...tagsWith(body, "link", /\/node_modules\//i),
    ]) {
      const target = tagUrl(tag);
      if (!target || !target.includes("/node_modules/")) continue;
      return `Page loads an asset directly out of node_modules: ${target.slice(0, 200)}`;
    }
    return null;
  },

  "supply-chain-bower-components-reference": (_url, _headers, body) => {
    if (body.indexOf("bower_components") === -1) return null;
    for (const tag of [
      ...tagsWith(body, "script", /bower_components/i),
      ...tagsWith(body, "link", /bower_components/i),
    ]) {
      const target = tagUrl(tag);
      if (!target || !target.includes("bower_components")) continue;
      return `Page loads an asset from a Bower install directory: ${target.slice(0, 200)}`;
    }
    return null;
  },

  // ── Subresource Integrity quality ──────────────────────────────────────

  "supply-chain-sri-weak-hash-algorithm": (_url, _headers, body) => {
    if (body.indexOf("integrity") === -1) return null;
    for (const tag of [
      ...tagsWith(body, "script", /integrity\s*=/i),
      ...tagsWith(body, "link", /integrity\s*=/i),
    ]) {
      const value = /integrity\s*=\s*["']([^"']{1,400})["']/i.exec(tag)?.[1];
      if (!value) continue;
      const algorithms = value
        .trim()
        .split(/\s+/)
        .map((token) => token.split("-")[0].toLowerCase());
      if (algorithms.length === 0) continue;
      // A single token that browsers do not recognise is ignored outright,
      // which silently disables SRI for that element.
      const recognised = ["sha256", "sha384", "sha512"];
      if (algorithms.some((a) => recognised.includes(a))) continue;
      return `Subresource Integrity attribute uses "${algorithms.join(", ")}", which no browser accepts as an SRI hash algorithm: ${(tagUrl(tag) ?? tag).slice(0, 160)}`;
    }
    return null;
  },

  "supply-chain-sri-missing-crossorigin": (url, _headers, body) => {
    if (body.indexOf("integrity") === -1) return null;
    let pageHost: string | null = null;
    try {
      pageHost = new URL(url).hostname;
    } catch {
      pageHost = null;
    }
    for (const tag of [
      ...tagsWith(body, "script", /integrity\s*=/i),
      ...tagsWith(body, "link", /integrity\s*=/i),
    ]) {
      if (/\bcrossorigin\b/i.test(tag)) continue;
      const target = tagUrl(tag);
      if (!target) continue;
      const host = absoluteHost(target);
      if (!host || (pageHost && host === pageHost)) continue;
      return `Cross-origin subresource carries an integrity attribute but no crossorigin attribute, so the browser discards the response before it can be checked: ${target.slice(0, 200)}`;
    }
    return null;
  },

  // ── Build and release artifacts ────────────────────────────────────────

  "supply-chain-ci-workflow-exposed": (_url, _headers, body) => {
    if (body.indexOf("runs-on:") === -1) return null;
    if (!/^jobs:\s*$/m.test(body)) return null;
    if (!/^\s{2,}runs-on:\s*\S/m.test(body)) return null;
    const steps = (body.match(/^\s*-\s+uses:\s*\S/gm) || []).length;
    return `A CI workflow definition is served from this URL (a jobs block with ${steps} action step(s)), exposing the build pipeline: runner labels, triggers, referenced actions, and the names of every secret the pipeline reads.`;
  },

  "supply-chain-github-action-unpinned-tag": (_url, _headers, body) => {
    if (body.indexOf("uses:") === -1) return null;
    if (!/^jobs:\s*$/m.test(body)) return null;
    const usesRe =
      /^\s*-?\s*uses:\s*["']?([\w.-]{1,60}\/[\w.-]{1,80}(?:\/[\w.-]{1,80})?)@([\w.-]{1,60})/gm;
    let m: RegExpExecArray | null;
    while ((m = usesRe.exec(body)) !== null) {
      if (/^[0-9a-f]{40}$/i.test(m[2])) continue;
      // Actions published by GitHub itself are the one case where a tag is
      // conventionally accepted, so they are not what this reports.
      if (/^actions\//i.test(m[1])) continue;
      return `CI workflow references a third-party action by mutable tag rather than commit SHA: uses: ${m[1]}@${m[2]}`;
    }
    return null;
  },

  "supply-chain-sbom-document-exposed": (_url, _headers, body) => {
    if (/"bomFormat"\s*:\s*"CycloneDX"/i.test(body)) {
      const spec = /"specVersion"\s*:\s*"([\d.]{1,10})"/.exec(body)?.[1];
      return `A CycloneDX software bill of materials${spec ? ` (spec ${spec})` : ""} is served from this URL, listing every component and version the build shipped.`;
    }
    if (
      /^SPDXVersion:\s*SPDX-/m.test(body) ||
      /"spdxVersion"\s*:\s*"SPDX-/.test(body)
    ) {
      return "An SPDX software bill of materials is served from this URL, listing every component and version the build shipped.";
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
export const detectors: Record<string, DetectFn> =
  withDocBlocksStripped(rawDetectors);
