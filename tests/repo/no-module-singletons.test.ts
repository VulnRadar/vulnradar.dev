import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../_helpers/api-routes";

/**
 * Process-wide state under lib/ lives on globalThis, through
 * lib/runtime/global-singleton.ts, not in a module-level variable.
 *
 * Next bundles a server module once per runtime layer, so a top-level
 * `new Set()` is several sets in one process. That is how a cancelled scan
 * kept running (the cancel route flagged one copy of the set and the job read
 * another) and how one process held three Postgres pools.
 *
 * What counts as state: a top-level `let` or `var`, or a `const` holding an
 * empty Map, Set, WeakMap, WeakSet, array or object, which only exists to be
 * filled at runtime. A container built from static data at load time is not
 * flagged: two copies of it hold the same thing. Neither are "use client"
 * modules, which run in the browser where the duplication does not happen.
 *
 * BASELINE lists what predates this rule, keyed by file and symbol so an edit
 * elsewhere in a file cannot trip it. It only comes down: an entry whose state
 * moved to globalSingleton (or that is genuinely per-copy, like a memo of the
 * last input) can be deleted, and a new symbol fails here.
 */

/** Parsing the tree takes seconds, and longer on a loaded CI runner. */
const TREE_WALK_TIMEOUT_MS = 60_000;

const HELPER = "lib/runtime/global-singleton.ts";
const MUTABLE_CONSTRUCTORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

const posix = (path: string) => path.split(sep).join("/");

function walkSource(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkSource(full));
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) {
      if (!entry.name.endsWith(".d.ts")) files.push(full);
    }
  }
  return files;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** An empty container that only exists to be written to later. */
function isEmptyContainer(initializer: ts.Expression | undefined): boolean {
  if (!initializer) return false;
  const value = unwrap(initializer);
  if (
    ts.isNewExpression(value) &&
    ts.isIdentifier(value.expression) &&
    MUTABLE_CONSTRUCTORS.has(value.expression.text)
  ) {
    return !value.arguments || value.arguments.length === 0;
  }
  if (ts.isArrayLiteralExpression(value)) return value.elements.length === 0;
  if (ts.isObjectLiteralExpression(value)) {
    return value.properties.length === 0;
  }
  return false;
}

/** `readonly T[]`, ReadonlyMap, Readonly<...>: declared as never written. */
function isReadonlyType(type: ts.TypeNode | undefined): boolean {
  if (!type) return false;
  if (
    ts.isTypeOperatorNode(type) &&
    type.operator === ts.SyntaxKind.ReadonlyKeyword
  ) {
    return true;
  }
  return (
    ts.isTypeReferenceNode(type) &&
    type.typeName.getText().startsWith("Readonly")
  );
}

function isClientModule(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  );
}

/** Top-level mutable state in one module, by symbol name. */
function moduleStateIn(text: string): string[] {
  const source = ts.createSourceFile(
    "x.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (isClientModule(source)) return [];
  const symbols: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)
    ) {
      continue;
    }
    const isConst =
      (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const mutable = isConst
        ? isEmptyContainer(declaration.initializer) &&
          !isReadonlyType(declaration.type)
        : true;
      if (mutable) symbols.push(declaration.name.text);
    }
  }
  return symbols;
}

/**
 * What predates the rule, by file and symbol. Several are the job stores and
 * caches the plan moves onto globalSingleton in other changes (the
 * concurrent-scan slots, the access-rule cache, the scan-phase result stores,
 * the backup and updater job stores, the worker timers); several are
 * per-copy on purpose (a memo of the last input a pure function saw, a
 * registry built from static data). Only ever comes down.
 */
const BASELINE: ReadonlySet<string> = new Set([
  "lib/ai/knowledge-files.ts::cache",
  "lib/ai/knowledge-retrieval.ts::cached",
  "lib/ai/reasoning.ts::reasoningRefusals",
  "lib/ai/verify-findings.ts::unreadableKeyReported",
  "lib/api/api-keys.ts::lastKeyUsageWrite",
  "lib/api/api-keys.ts::legacyKeyRowsPresent",
  "lib/api/api-keys.ts::reportedUndecryptableKeys",
  "lib/auth/auth.ts::lastCleanupTime",
  "lib/auth/me.ts::quotaCache",
  "lib/auth/password-hash.ts::scryptInFlight",
  "lib/auth/password-hash.ts::scryptWaiting",
  "lib/auth/staff-oidc.ts::discoveryCache",
  "lib/auth/staff-oidc.ts::jwksClients",
  "lib/backup/job-store.ts::activeJobId",
  "lib/backup/job-store.ts::jobs",
  "lib/backup/scheduled-backup-worker.ts::activeBackupTimer",
  "lib/backup/scheduled-backup-worker.ts::activeBootCheck",
  "lib/billing/stripe-webhook-setup.ts::webhookSetupPromise",
  "lib/billing/stripe.ts::stripeInstance",
  "lib/billing/token-reservation.ts::runSlots",
  "lib/browserbase/concurrency-queue.ts::inFlight",
  "lib/browserbase/concurrency-queue.ts::waiters",
  "lib/browserbase/network-capture.ts::captures",
  "lib/config/env.ts::cached",
  "lib/config/registry.ts::schemaCache",
  "lib/database/boot/workers.ts::scheduledScansTimer",
  "lib/database/cleanup.ts::activeCleanupTimer",
  "lib/database/error-log-capture.ts::flushTimer",
  "lib/database/error-log-capture.ts::installed",
  "lib/database/error-log-capture.ts::lastMessage",
  "lib/database/error-log-capture.ts::lastMessageAt",
  "lib/database/error-log-capture.ts::suppressed",
  "lib/database/error-log-capture.ts::windowCount",
  "lib/database/error-log-capture.ts::windowStart",
  "lib/docs/last-modified.generated.ts::DOCS_LAST_MODIFIED",
  "lib/docs/moved-anchors.ts::MOVED_ANCHORS",
  "lib/docs/redirects.ts::DOCS_REDIRECTS",
  "lib/domains/reverify-worker.ts::activeReverifyTimer",
  "lib/i18n/format.ts::dateFormats",
  "lib/i18n/format.ts::instances",
  "lib/i18n/format.ts::numberFormats",
  "lib/i18n/format.ts::pluralRules",
  "lib/i18n/format.ts::relativeFormats",
  "lib/i18n/messages.ts::cache",
  "lib/notifications/posture-digest.ts::activeDigestTimer",
  "lib/rate-limiting/concurrent-scans.ts::inlineSlots",
  "lib/scanner/_helpers.ts::lastJudge",
  "lib/scanner/_helpers.ts::lastProseInput",
  "lib/scanner/_helpers.ts::lastProseOutput",
  "lib/scanner/_helpers.ts::lastStripInput",
  "lib/scanner/_helpers.ts::lastStripOutput",
  "lib/scanner/access-rules.ts::ruleCache",
  "lib/scanner/adaptive-confidence.ts::cache",
  "lib/scanner/async-check-catalog.ts::byCheckId",
  "lib/scanner/async-checks.ts::NO_FINDINGS",
  "lib/scanner/async-checks.ts::dohInFlight",
  "lib/scanner/checks/page-checks/disclosure.ts::lastBody",
  "lib/scanner/checks/page-checks/disclosure.ts::lastStripped",
  "lib/scanner/checks/page-checks/index.ts::seen",
  "lib/scanner/checks/secrets-extended.ts::lastSecretsInput",
  "lib/scanner/checks/secrets-extended.ts::lastSecretsSearchText",
  "lib/scanner/checks/secrets-extended.ts::maskCacheInput",
  "lib/scanner/checks/secrets-extended.ts::maskCacheOutput",
  "lib/scanner/cve-enrichment.ts::epssMemo",
  "lib/scanner/cve-enrichment.ts::memoryKevCache",
  "lib/scanner/discovery-progress.ts::cleanupTimers",
  "lib/scanner/discovery-progress.ts::progress",
  "lib/scanner/dns-records.ts::recordsStore",
  "lib/scanner/inventory/engine.ts::compiled",
  "lib/scanner/page-fetch.ts::inFlight",
  "lib/scanner/port-scan.ts::portScanStore",
  "lib/scanner/registry.ts::bundleByCategory",
  "lib/scanner/registry.ts::checksByCategoryCache",
  "lib/scanner/registry.ts::defById",
  "lib/scanner/registry.ts::detectorMap",
  "lib/scanner/reputation-lookup.ts::quad9Cache",
  "lib/scanner/reputation-lookup.ts::summaryStore",
  "lib/scanner/reputation-lookup.ts::urlhausCache",
  "lib/scanner/scheduled-scans-worker.ts::activeScheduleTimer",
  "lib/scanner/software-inventory.ts::correlationCache",
  "lib/scanner/software-inventory.ts::fingerprintStore",
  "lib/scanner/ssl-grade.ts::gradeStore",
  "lib/scanner/stale-scan-sweep.ts::activeStaleSweepTimer",
  "lib/scanner/subdomain-auto.ts::subdomainsStore",
  "lib/scanner/tls-handshake.ts::inFlight",
  "lib/seo/check-see-also.ts::GROUP_MEMBERS",
  "lib/seo/checks-content.ts::BY_CATEGORY",
  "lib/updater/job-store.ts::activeJobId",
  "lib/updater/job-store.ts::jobs",
  "lib/updater/release-summary.ts::cached",
]);

let cachedScan: { files: number; found: string[] } | undefined;

function scanLib(): { files: number; found: string[] } {
  if (cachedScan) return cachedScan;
  const files = walkSource(join(REPO_ROOT, "lib"));
  const found: string[] = [];
  for (const file of files) {
    const path = posix(relative(REPO_ROOT, file));
    if (path === HELPER) continue;
    for (const symbol of moduleStateIn(readFileSync(file, "utf8"))) {
      found.push(`${path}::${symbol}`);
    }
  }
  cachedScan = { files: files.length, found };
  return cachedScan;
}

describe("no module-level singletons under lib/", () => {
  it("flags each kind of top-level mutable state", () => {
    const text = `
      let counter = 0;
      var legacy;
      export let exported: string | null = null;
      const seen = new Set<string>();
      const byId = new Map<number, string>();
      const weak = new WeakMap<object, number>();
      const queue: string[] = [];
      const store: Record<string, number> = {};
      const typed = new Map() as Map<string, number>;
    `;
    expect(moduleStateIn(text)).toEqual([
      "counter",
      "legacy",
      "exported",
      "seen",
      "byId",
      "weak",
      "queue",
      "store",
      "typed",
    ]);
  });

  it("leaves constants, static tables and the helper's own pattern alone", () => {
    const text = `
      const LIMIT = 10;
      const NAMES = new Set(["a", "b"]);
      const TABLE = new Map([["a", 1]]);
      const LIST = ["x", "y"];
      const CONFIG = { a: 1 };
      const NONE: readonly string[] = [];
      const EMPTY: ReadonlyMap<string, number> = new Map();
      const cancelled = globalSingleton("vulnradar.x.cancelled", () => new Set<number>());
      declare let injected: string;
      function inner() {
        let local = 0;
        const scratch = new Map();
        return [local, scratch];
      }
      // let commented = 0;
    `;
    expect(moduleStateIn(text)).toEqual([]);
  });

  it("skips client modules, which run in the browser", () => {
    expect(moduleStateIn(`"use client";\nlet listeners = new Set();`)).toEqual(
      [],
    );
    expect(moduleStateIn(`let listeners = new Set();\n"use client";`)).toEqual([
      "listeners",
    ]);
  });

  it(
    "finds no new top-level mutable state outside globalSingleton",
    () => {
      const added = scanLib().found.filter((key) => !BASELINE.has(key));
      expect(
        added,
        "Keep process-wide state on globalThis with globalSingleton from lib/runtime/global-singleton.ts",
      ).toEqual([]);
    },
    TREE_WALK_TIMEOUT_MS,
  );

  it(
    "is still looking at the real tree",
    () => {
      const { files, found } = scanLib();
      // A walk that went blind would pass the check above trivially.
      expect(files).toBeGreaterThan(300);
      expect(found.length).toBeGreaterThan(0);
    },
    TREE_WALK_TIMEOUT_MS,
  );

  it(
    "keeps the scan cancel flags and the promoted-rule cache on globalThis",
    () => {
      const { found } = scanLib();
      const moved = found.filter(
        (key) =>
          key.startsWith("lib/scanner/scan-jobs.ts::") ||
          key.startsWith("lib/tags/auto-tags.ts::"),
      );
      expect(moved).toEqual([]);
    },
    TREE_WALK_TIMEOUT_MS,
  );
});
