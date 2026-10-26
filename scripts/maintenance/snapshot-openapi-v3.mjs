// Writes lib/api/openapi-v3.snapshot.json: the OpenAPI document the v3 API
// publishes today, frozen.
//
//   node scripts/maintenance/snapshot-openapi-v3.mjs [--dry-run] [--force]
//
// After the 4.0.0 route move, /api/v3/openapi.json keeps answering for
// Postman, Insomnia, Bruno, SDK generators and bookmarks, and it has to keep
// describing what v3 actually does, inaccuracies included; the corrections
// live in the v4 document. So the builder's output is committed once and
// served from the file. Run it on the last commit before the first route
// move, while lib/api/openapi-spec.ts still describes v3, and never again.
//
// Refuses to overwrite an existing snapshot. --dry-run builds the document and
// prints a summary without writing, which is how to check the script still
// works on a later tree.
//
// The builder is TypeScript behind "@/" aliases. Node's own CommonJS loader is
// taught two things: how to resolve "@/", and how to compile a .ts file with
// the repo's typescript package. That is enough for a graph of plain modules
// and is not a general loader.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const outFile = join(root, "lib", "api", "openapi-v3.snapshot.json");
const relOut = relative(root, outFile).split(sep).join("/");

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

if (!dryRun && existsSync(outFile) && !force) {
  console.error(
    `${relOut} already exists and is never regenerated.\n` +
      "It freezes the v3 document as it was before the 4.0.0 move. Pass --force " +
      "only to restore it on a checkout from before the first move.",
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, ...rest) {
  const mapped = request.startsWith("@/")
    ? join(root, request.slice(2))
    : request;
  return resolveFilename.call(this, mapped, ...rest);
};

require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(outputText, filename);
};

const { buildOpenApiSpec } = require(
  join(root, "lib", "api", "openapi-spec.ts"),
);
const { CONFIG_APP_URL } = require(
  join(root, "lib", "config", "config-values.ts"),
);
const document = buildOpenApiSpec(CONFIG_APP_URL);

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];
const paths = Object.keys(document.paths).length;
const operations = Object.values(document.paths).reduce(
  (count, item) =>
    count + Object.keys(item).filter((key) => METHODS.includes(key)).length,
  0,
);

if (dryRun) {
  console.log(
    `Would write ${relOut}: ${paths} paths, ${operations} operations`,
  );
} else {
  writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Wrote ${relOut}: ${paths} paths, ${operations} operations`);
}
