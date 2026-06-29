import { readFileSync, writeFileSync } from "node:fs";

const FILE = "lib/scanner/checks/code.ts";
const src = readFileSync(FILE, "utf8");

// Note: in the source code, the pattern is `/api\\./.test` (escaped backslash-dot)
// so the regex needs `\\\\` (4 backslashes) to match.
const re = new RegExp(
  String.raw`\n[ \t]*if \(\/<html\|<script\/i\.test\(body\) \|\| \/api\\.\/i?\.test\(_url\)\) \{\n[ \t]*return "API\/HTML context - audit [^"]+";\n[ \t]*\}`,
  "g",
);

const matches = src.match(re);
const count = matches ? matches.length : 0;
console.log(`Found ${count} stub-evidence branches to remove`);
if (matches && matches.length > 0) {
  console.log("Sample match:", JSON.stringify(matches[0]).slice(0, 300));
}

const updated = src.replace(re, "");
writeFileSync(FILE, updated);

console.log(
  `Old size: ${src.length}, new size: ${updated.length}, removed: ${src.length - updated.length} bytes`,
);
