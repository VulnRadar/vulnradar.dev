// One-off diagnostic: find duplicate check IDs across the per-category
// metadata files. Run with: node scripts/find-duplicate-ids.mjs
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "..", "lib", "scanner", "checks-data");

const idToCategories = new Map();
for (const file of readdirSync(dir)) {
  if (!file.endsWith(".json")) continue;
  const data = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
  const cat = file.replace(".json", "");
  for (const def of data) {
    if (!idToCategories.has(def.id)) idToCategories.set(def.id, []);
    idToCategories.get(def.id).push(cat);
  }
}

const dupes = [...idToCategories.entries()]
  .filter(([, cats]) => cats.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

console.log(`${dupes.length} duplicate check IDs:`);
for (const [id, cats] of dupes) {
  console.log(`  ${id}: ${cats.join(", ")}`);
}
