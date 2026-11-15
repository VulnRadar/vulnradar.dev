#!/usr/bin/env node
// Checks what the extension build actually produced, in both targets, after
// `npm run build`. CI runs it before the zips go up as an artifact.
//
//   node scripts/verify-dist.mjs
//
// 1. Each built manifest asks for exactly what manifest/permissions.allowlist.json
//    records, with the API host the build used filled in.
// 2. Chrome runs a service worker and Firefox a background script, which is
//    the one difference between the targets that a store rejects when wrong.
// 3. Every icon the manifest names is in the output.
// 4. The extension pages' CSP allows no eval, no inline script and no remote
//    script origin.
// 5. No built file holds a VulnRadar API key. The extension asks for the key
//    at run time and keeps it in the browser's storage; one in the bundle is
//    a key published to every user and to both stores.
// 6. Each store zip is under the size budget in the allowlist.
//
// Exits 1 with every problem listed, not the first. No dependencies.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeApiHost } from "./manifest.mjs";
import { checkAgainstAllowlist, parseCsp } from "./permissions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const allowlist = JSON.parse(
  readFileSync(join(ROOT, "manifest", "permissions.allowlist.json"), "utf8"),
);
const apiHost = normalizeApiHost(process.env.VULNRADAR_API_HOST);

const problems = [];
const sizes = [];

/** Every file under `dir`, as paths relative to it. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else
      out.push(
        full
          .slice(base.length + 1)
          .split("\\")
          .join("/"),
      );
  }
  return out;
}

function iconPaths(manifest) {
  return [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ];
}

for (const target of ["chrome", "firefox"]) {
  const label = `dist-${target}`;
  const dist = join(ROOT, label);
  const manifestFile = join(dist, "manifest.json");
  if (!existsSync(manifestFile)) {
    problems.push(
      `${label}/manifest.json does not exist. Run the build first.`,
    );
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));

  problems.push(...checkAgainstAllowlist(manifest, allowlist, apiHost, label));

  if (manifest.manifest_version !== 3) {
    problems.push(
      `${label}: manifest_version is ${manifest.manifest_version}, not 3.`,
    );
  }
  if (target === "chrome") {
    if (manifest.background?.service_worker !== "background.js") {
      problems.push(
        `${label}: Chrome needs background.service_worker "background.js".`,
      );
    }
    if (manifest.background?.scripts) {
      problems.push(
        `${label}: Chrome rejects background.scripts next to a service worker.`,
      );
    }
  } else {
    const scripts = manifest.background?.scripts;
    if (!Array.isArray(scripts) || scripts.join() !== "background.js") {
      problems.push(
        `${label}: Firefox needs background.scripts ["background.js"].`,
      );
    }
    if (manifest.background?.service_worker) {
      problems.push(
        `${label}: Firefox does not run background.service_worker.`,
      );
    }
  }

  for (const icon of iconPaths(manifest)) {
    if (!existsSync(join(dist, icon))) {
      problems.push(
        `${label}: the manifest names the icon ${icon}, which is not in the build.`,
      );
    }
  }

  const csp = manifest.content_security_policy?.extension_pages ?? "";
  if (/unsafe-eval/.test(csp))
    problems.push(`${label}: the CSP allows unsafe-eval.`);
  const directives = parseCsp(csp);
  for (const source of directives["script-src"] ?? []) {
    if (source === "'unsafe-inline'") {
      problems.push(`${label}: the CSP's script-src allows unsafe-inline.`);
    }
    if (/^(https?:|wss?:|[*])|:[/][/]/.test(source)) {
      problems.push(
        `${label}: the CSP's script-src names the remote origin ${source}.`,
      );
    }
  }

  const key = /vr_live_[a-f0-9]{64}/;
  for (const file of walk(dist)) {
    const text = readFileSync(join(dist, file)).toString("latin1");
    if (key.test(text)) {
      problems.push(
        `${label}/${file} holds what looks like a VulnRadar API key.`,
      );
    }
  }

  const zip = join(ROOT, `vulnradar-${target}-v${pkg.version}.zip`);
  if (!existsSync(zip)) {
    problems.push(`vulnradar-${target}-v${pkg.version}.zip does not exist.`);
  } else {
    const bytes = statSync(zip).size;
    sizes.push([target, bytes]);
    if (bytes > allowlist.zipBudgetBytes) {
      problems.push(
        `vulnradar-${target}-v${pkg.version}.zip is ${bytes} bytes, over the ${allowlist.zipBudgetBytes} the allowlist budgets (${allowlist.zipBudgetReason})`,
      );
    }
  }
}

if (process.env.GITHUB_STEP_SUMMARY && sizes.length > 0) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "### Extension store packages",
      "",
      "| Target | Zip bytes | Budget |",
      "|---|---|---|",
      ...sizes.map(([t, b]) => `| ${t} | ${b} | ${allowlist.zipBudgetBytes} |`),
      "",
    ].join("\n"),
  );
}

if (problems.length > 0) {
  for (const p of problems) console.log(`::error::${p}`);
  process.exit(1);
}
console.log(
  `Both built manifests match the allowlist (API host ${apiHost}); ${sizes
    .map(([t, b]) => `${t} zip ${b} bytes`)
    .join(", ")}.`,
);
