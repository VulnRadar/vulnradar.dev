// One-off dedup script. Run with: node scripts/dedup-checks-data.mjs
// Scans every per-category metadata file under lib/scanner/checks-data/.
// For each duplicate check ID, keeps the first occurrence (in
// alphabetical filename order) and drops the rest. Writes back in place.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "..", "lib", "scanner", "checks-data");

const seen = new Set();
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

let totalRemoved = 0;
for (const file of files) {
  const path = resolve(dir, file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const before = data.length;
  const deduped = data.filter((def) => {
    if (seen.has(def.id)) return false;
    seen.add(def.id);
    return true;
  });
  const removed = before - deduped.length;
  if (removed > 0) {
    writeFileSync(path, JSON.stringify(deduped, null, 2));
    console.log(`  ${file}: removed ${removed} duplicate(s)`);
    totalRemoved += removed;
  } else {
    console.log(`  ${file}: clean`);
  }
}
console.log(`\nTotal duplicates removed: ${totalRemoved}`);
console.log(`Total unique checks: ${seen.size}`);
