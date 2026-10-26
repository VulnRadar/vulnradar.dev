// Writes tests/fixtures/api-routes-pre-4.0.json: every route file under
// app/api, the URL template it serves and the HTTP methods it exports.
//
//   node scripts/maintenance/snapshot-api-routes.mjs [--dry-run] [--force]
//
// The fixture is the record of what the API looked like before the 4.0.0 route
// move. tests/repo/api-routes-resolve.test.ts asserts that every one of these
// URLs still answers afterwards, so it describes the tree as it was and must
// never be regenerated from the tree as it is. The script therefore refuses to
// overwrite an existing fixture; --force exists for the one case that is
// legitimate, a corrupted file restored on a checkout from before the first
// move.
//
// Methods are read from the TypeScript AST, so `export async function GET`,
// `export const GET = ...` and `export { handler as GET }` all count and a
// comment mentioning "POST" does not.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const apiRoot = join(root, "app", "api");
const outFile = join(root, "tests", "fixtures", "api-routes-pre-4.0.json");

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function toPosix(p) {
  return p.split(sep).join("/");
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/^route\.(?:ts|tsx|js|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** app/api/v3/history/[id]/report/route.ts -> /api/v3/history/:id/report */
function templateFor(file) {
  const segments = toPosix(relative(join(root, "app"), dirname(file)))
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const catchAll = /^\[\[?\.\.\.(\w+)\]?\]$/.exec(segment);
      if (catchAll) return `*${catchAll[1]}`;
      const dynamic = /^\[(\w+)\]$/.exec(segment);
      if (dynamic) return `:${dynamic[1]}`;
      return segment;
    });
  return `/${segments.join("/")}`;
}

function exportedMethods(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      }
      continue;
    }
    const exported = ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return METHODS.filter((method) => names.has(method));
}

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
if (!dryRun && existsSync(outFile) && !force) {
  console.error(
    `${toPosix(relative(root, outFile))} already exists and is never regenerated.\n` +
      "It records the API as it was before the 4.0.0 move. Pass --force only to " +
      "restore it on a checkout from before the first move.",
  );
  process.exit(1);
}

const rows = walk(apiRoot)
  .map((file) => ({
    file: toPosix(relative(root, file)),
    template: templateFor(file),
    methods: exportedMethods(file),
  }))
  .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

const empty = rows.filter((row) => row.methods.length === 0);
if (empty.length > 0) {
  console.error(
    `No HTTP method export found in: ${empty.map((row) => row.file).join(", ")}`,
  );
  process.exit(1);
}

const target = toPosix(relative(root, outFile));
if (dryRun) {
  console.log(`Would write ${rows.length} routes to ${target}`);
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`Wrote ${rows.length} routes to ${target}`);
}
