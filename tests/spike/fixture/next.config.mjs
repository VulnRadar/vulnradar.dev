import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The harness links node_modules in from outside this scratch copy (the
// repository's own on a local run, a shared install in CI). Turbopack, the
// default bundler since Next 16, resolves nothing outside the project root
// unless the link's target is declared as an additional root. The image
// target installs inside the container, so there is no link there and
// nothing is declared.
function linkedNodeModules() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const link = path.join(here, "node_modules");
  try {
    if (!lstatSync(link).isSymbolicLink()) return null;
    const target = realpathSync(link);
    const rel = path.relative(here, target);
    return rel.startsWith("..") || path.isAbsolute(rel) ? target : null;
  } catch {
    return null;
  }
}
const linked = linkedNodeModules();

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The real next.config.mjs carries these two rewrites. A config rewrite list
  // that is not empty changes how Next orders its routing phases, so the
  // fixture keeps the same shape instead of a config with none.
  async rewrites() {
    return [
      {
        source: "/.well-known/security.txt",
        destination: "/api/security-txt",
      },
      { source: "/security.txt", destination: "/api/security-txt" },
    ];
  },
  ...(linked && {
    experimental: {
      turbopackAdditionalRoots: { deps: { path: linked } },
    },
  }),
};

export default nextConfig;
