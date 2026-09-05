/**
 * Which paths in a release survive an update, and which do not.
 *
 * Its own module, with no imports, because these lists are read by the update
 * job AND by the guard that checks the repository root against them. Left in
 * apply.ts they could not be read without pulling in the database pool
 * through the release client, so the guard could not exist.
 */
/**
 * PROTECTED: never copied over and never pruned. User data and expensive
 * build/dependency output that MUST survive an update untouched. .env and
 * .env.* are always protected by copy-with-excludes' own DOTENV rule, so they
 * don't need listing here.
 *   - names (any depth): the dependency tree and git metadata.
 *   - root prefixes: build output (.next), the DB backup directory, the
 *     legacy on-disk avatar dir + any other runtime data, and caches.
 */
export const PROTECTED_NAMES = ["node_modules", ".git"];

export const PROTECTED_PREFIXES = [
  ".next",
  "data",
  "backups",
  ".npm",
  ".cache",
  "logs",
  "uploads",
];

/**
 * STRIP: paths that ship in the release tarball and that a running install
 * has no reason to hold. Excluded from the copy AND pruned from the
 * destination, so an install that predates an entry loses it on the next
 * update.
 *
 * Root-level prefixes only, so a legitimately-needed path deeper in the tree
 * that happens to share a name is never at risk: "tests" removes ./tests and
 * never lib/scanner/tests.
 *
 * The bar is "nothing npm run build, npm start, or an operator command reads
 * it", which is why several things that look strippable are not. README.md
 * and SECURITY.md stay because the self-hosting docs send operators to them
 * by name at the install root. .env.example stays because it is the template
 * those docs tell you to copy. .gitignore stays because deleting it from an
 * install that was git cloned turns .env into an untracked file someone can
 * commit. docker-compose.yml stays because it is a documented way to run the
 * database, and scripts/ stays because npm run build compiles the knowledge
 * files with it and half the operator tooling lives there.
 */
export const STRIP_PREFIXES = [
  // Test suites and the config that runs them.
  "tests",
  "vitest.config.ts",
  // Separate products that ship from this repository and are not this app.
  // The CLI is published to npm as `vulnradar`, so `npx vulnradar` keeps
  // working with the bundled copy gone.
  "extension",
  "cli",
  // Repository plumbing: CI workflows, agent config, audit records.
  ".github",
  ".claude",
  "audits",
  // Developer tooling. `next build` skips ESLint entirely (see next.config's
  // eslint.ignoreDuringBuilds) and nothing at runtime reads any of these.
  "eslint.config.mjs",
  ".prettierignore",
  "components.json",
  // Inputs for building the container image. An install updated by this flow
  // builds no image, and an install that came FROM one never runs this code.
  "Dockerfile",
  ".dockerignore",
  // Repository documents the app never reads. SECURITY-POSTURE.md describes
  // how vulnradar.dev itself is deployed, which is not a fact about anyone
  // else's install.
  "LICENSE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY-POSTURE.md",
];
