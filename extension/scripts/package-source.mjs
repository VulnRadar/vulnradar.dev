// archiver 8 is ESM-native and exports named classes only: there is no
// default export, so `import archiver from "archiver"` throws at module load
// and `npm run build` -- the command the README documents -- died before it
// packaged anything. CI never caught it because the extension job runs
// build:chrome and build:firefox, the two scripts that skip packaging
// entirely, so the only untested step was the one that produces the artifact
// actually uploaded to the Chrome Web Store and AMO.
//
// ZipArchive carries the same directory/file/pipe/finalize/pointer surface
// the callable factory did, so the call sites below are unchanged apart from
// the construction.
import { ZipArchive } from "archiver";
import { createWriteStream, unlinkSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
// store-assets/ is the Chrome Web Store / AMO listing screenshots: half a
// megabyte of PNGs the extension never references and that AMO's source
// review has no use for. LICENSE and THIRD-PARTY.md are NOT excluded - the
// source archive is one of the places a reviewer looks for them.
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist-chrome",
  "dist-firefox",
  "dist-build",
  "dist-tsc",
  "out",
  "store-assets",
]);

const PKG = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const outPath = path.join(
  root,
  `vulnradar-extension-v${PKG.version}-source.zip`,
);

// Same stale-zip cleanup package.mjs already does for the chrome/firefox
// zips -- otherwise every past build's source zip piles up in the
// extension root too.
const sourceZipRe = /^vulnradar-extension-v(.+)-source\.zip$/;
for (const name of await readdir(root)) {
  const m = name.match(sourceZipRe);
  if (m && m[1] !== PKG.version) {
    unlinkSync(path.join(root, name));
    console.log(`[package-source] removed stale ${name}`);
  }
}
const output = createWriteStream(outPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on("close", () => {
  console.log(`[package-source] wrote ${outPath} (${archive.pointer()} bytes)`);
});
archive.on("error", (err) => {
  throw err;
});
archive.pipe(output);

const entries = await readdir(root, { withFileTypes: true });
for (const entry of entries) {
  if (EXCLUDE_DIRS.has(entry.name)) continue;
  if (entry.name.endsWith(".zip")) continue;
  if (entry.name.endsWith(".tsbuildinfo")) continue;
  const full = path.join(root, entry.name);
  if (entry.isDirectory()) {
    archive.directory(full, entry.name);
  } else {
    archive.file(full, { name: entry.name });
  }
}

await archive.finalize();
