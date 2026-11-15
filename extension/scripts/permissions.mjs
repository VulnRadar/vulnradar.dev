// What the extension is allowed to ask the browser for, and the check that
// holds a manifest to it.
//
// extension/manifest/permissions.allowlist.json is the record. A permission
// is something a user is shown at install, or that a store reviews, so a new
// one is a decision and not a side effect of a feature: adding one to a
// manifest fails until the allowlist names it, and the allowlist is a
// CODEOWNERS-reviewed path. Equality, not "no more than": an entry the
// manifests no longer request fails too, so the record cannot keep a
// permission the extension gave up.
//
// Shared by tests/extension/manifest.test.ts (the two manifest templates, and
// the build output when there is one) and scripts/verify-dist.mjs (what CI
// built), so the two cannot disagree about what a manifest may contain.

export const HOST_PLACEHOLDER = "__API_HOST__";

export const INCREASE_HINT =
  "A permission increase needs extension/manifest/permissions.allowlist.json changed in a pull request a CODEOWNER reviews.";

/** The directives of a content security policy, by name. */
export function parseCsp(csp) {
  const out = {};
  for (const part of String(csp ?? "").split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values;
  }
  return out;
}

const sorted = (list) => [...new Set(list)].sort();

function expand(list, apiHost) {
  return list.map((entry) => entry.split(HOST_PLACEHOLDER).join(apiHost));
}

/** The lists a manifest requests, in the shape the allowlist records. */
export function requestedBy(manifest) {
  return {
    permissions: manifest.permissions ?? [],
    host_permissions: manifest.host_permissions ?? [],
    optional_permissions: manifest.optional_permissions ?? [],
    optional_host_permissions: manifest.optional_host_permissions ?? [],
    content_scripts_matches: (manifest.content_scripts ?? []).flatMap(
      (script) => script.matches ?? [],
    ),
  };
}

/**
 * What is wrong with a manifest, as one message per problem. `apiHost` is the
 * origin the placeholder stands for: pass the placeholder itself to check a
 * template, or the origin a build used to check its output.
 */
export function checkAgainstAllowlist(manifest, allowlist, apiHost, label) {
  const problems = [];
  const requested = requestedBy(manifest);

  for (const key of Object.keys(requested)) {
    const want = sorted(expand(allowlist[key] ?? [], apiHost));
    const got = sorted(requested[key]);
    for (const entry of got) {
      if (!want.includes(entry)) {
        problems.push(
          `${label}: ${key} requests "${entry}", which the allowlist does not record. ${INCREASE_HINT}`,
        );
      }
    }
    for (const entry of want) {
      if (!got.includes(entry)) {
        problems.push(
          `${label}: the allowlist records "${entry}" under ${key}, which the manifest no longer requests. Remove it from the allowlist.`,
        );
      }
    }
  }

  const csp = parseCsp(manifest.content_security_policy?.extension_pages);
  const pinned = allowlist.content_security_policy?.extension_pages ?? {};
  for (const name of new Set([...Object.keys(csp), ...Object.keys(pinned)])) {
    const got = JSON.stringify(csp[name] ?? null);
    const want = JSON.stringify(
      pinned[name] ? expand(pinned[name], apiHost) : null,
    );
    if (got !== want) {
      problems.push(
        `${label}: the content security policy's ${name} is ${got} and the allowlist records ${want}. ${INCREASE_HINT}`,
      );
    }
  }
  return problems;
}
