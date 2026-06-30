#!/usr/bin/env node
// Compile the public docs page content into a single knowledge file
// that the AI system prompt loads at runtime.
//
// Why a build step: the docs pages live in `app/docs/*/page.tsx` as
// React components with hardcoded JSX. The AI prompt is plain text.
// We extract a concise markdown summary here and the server reads
// the result on every chat request.
//
// Workflow:
//   1. Scan app/docs/*/page.tsx
//   2. Extract page title, hero, sections, code blocks, h3 headings,
//      and paragraph text
//   3. Write a compiled markdown file to lib/ai/docs-knowledge.md
//   4. If anything looks stale (file older than the newest docs page
//      by more than 30 days), log a warning so the dev can re-curate
//
// Run: `node scripts/compile-docs-knowledge.mjs`
// Auto-run: hooked as prebuild + predev in package.json.

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(ROOT, "app", "docs");
const OUTPUT = join(ROOT, "lib", "ai", "docs-knowledge.md");

const PAGE_LABELS = {
  "/docs": "Overview",
  "/docs/api": "API Reference",
  "/docs/architecture": "Architecture",
  "/docs/config": "Configuration",
  "/docs/developers": "Developers",
  "/docs/rate-limits": "Rate Limits",
  "/docs/self-hosting": "Self-Hosting",
  "/docs/setup": "Setup",
  "/docs/webhooks": "Webhooks",
};

const PAGE_ORDER = [
  "/docs",
  "/docs/setup",
  "/docs/self-hosting",
  "/docs/config",
  "/docs/api",
  "/docs/webhooks",
  "/docs/rate-limits",
  "/docs/architecture",
  "/docs/developers",
];

function listDocPages() {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const page = join(DOCS_DIR, d.name, "page.tsx");
      if (!existsSync(page)) return null;
      return { slug: d.name, path: page, route: `/docs/${d.name}` };
    })
    .filter(Boolean)
    .concat(
      existsSync(join(DOCS_DIR, "page.tsx"))
        ? [{ slug: "", path: join(DOCS_DIR, "page.tsx"), route: "/docs" }]
        : [],
    );
}

function stripJsx(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\{\s*\/\*[^*]*\*\/\s*\}/g, " ")
    .replace(/\{`/g, "")
    .replace(/`\}/g, "")
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/`/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\\\\/g, "\\")
    .replace(/^\s*[})]+\s*$/gm, "")
    .replace(/^\s*[({]+\s*$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFromPage(source) {
  const out = {
    hero: null,
    sections: [],
    codeBlocks: [],
    headings: [],
    paragraphs: [],
  };

  const heroMatch = source.match(
    /<DocsHero[\s\S]*?title=\{?`?["'`]([^"'`\n]+)["'`]?`?\}?[\s\S]*?description=\{?`?["'`]([\s\S]+?)["'`]\}?[\s\S]*?\/>/,
  );
  if (heroMatch) {
    out.hero = {
      title: stripJsx(heroMatch[1]),
      description: stripJsx(heroMatch[2]).slice(0, 400),
    };
  } else {
    const simpleHero = source.match(
      /<DocsHero[\s\S]*?title="([^"]+)"[\s\S]*?description="([^"]+)"[\s\S]*?\/>/,
    );
    if (simpleHero) {
      out.hero = { title: simpleHero[1], description: simpleHero[2] };
    }
  }

  const sectionRe =
    /<DocsSection[^>]*?id="([^"]+)"[^>]*?title="([^"]+)"[^>]*?>/g;
  let m;
  while ((m = sectionRe.exec(source)) !== null) {
    out.sections.push({ id: m[1], title: m[2] });
  }

  const codeRe =
    /<CodeBlock[^>]*?code=\{`([\s\S]+?)`\}[\s\S]*?language="([^"]+)"[^>]*?\/>/g;
  while ((m = codeRe.exec(source)) !== null) {
    out.codeBlocks.push({ code: m[1], language: m[2] });
  }
  const codeReInline =
    /<CodeBlock[^>]*?code="([^"]+)"[^>]*?language="([^"]+)"[^>]*?\/>/g;
  while ((m = codeReInline.exec(source)) !== null) {
    out.codeBlocks.push({ code: m[1].replace(/\\n/g, "\n"), language: m[2] });
  }

  const h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>/g;
  while ((m = h3Re.exec(source)) !== null) {
    const t = stripJsx(m[1]);
    if (t) out.headings.push(t);
  }
  const h4Re = /<h4[^>]*>([\s\S]*?)<\/h4>/g;
  while ((m = h4Re.exec(source)) !== null) {
    const t = stripJsx(m[1]);
    if (t) out.headings.push(t);
  }

  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
  while ((m = pRe.exec(source)) !== null) {
    const t = stripJsx(m[1])
      .replace(/\{[^}]*\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      t &&
      t.length > 30 &&
      t.length < 400 &&
      !t.includes("{") &&
      !/^[{<]/.test(t)
    )
      out.paragraphs.push(t);
  }

  return out;
}

function renderPage(route, extracted) {
  const label = PAGE_LABELS[route] || route.replace("/docs/", "");
  const lines = [];
  lines.push(`## ${label}`);
  lines.push(`Route: ${route}`);
  lines.push("");
  if (extracted.hero) {
    lines.push(`# ${extracted.hero.title}`);
    lines.push(extracted.hero.description);
    lines.push("");
  }
  if (extracted.sections.length) {
    lines.push("### Sections");
    for (const s of extracted.sections) {
      lines.push(`- **${s.title}** (\`#${s.id}\`)`);
    }
    lines.push("");
  }
  if (extracted.headings.length) {
    lines.push("### Headings");
    for (const h of extracted.headings.slice(0, 25)) lines.push(`- ${h}`);
    lines.push("");
  }
  if (extracted.paragraphs.length) {
    lines.push("### Notes");
    for (const p of extracted.paragraphs.slice(0, 10)) lines.push(`- ${p}`);
    lines.push("");
  }
  if (extracted.codeBlocks.length) {
    lines.push("### Code examples");
    for (const c of extracted.codeBlocks.slice(0, 8)) {
      const cleaned = c.code
        .replace(/\$\{[^}]+\}/g, "<value>")
        .replace(/\\n/g, "\n");
      lines.push("```" + c.language);
      lines.push(cleaned);
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

function build() {
  const pages = listDocPages();
  if (pages.length === 0) {
    console.error("[compile-docs-knowledge] No docs pages found at", DOCS_DIR);
    process.exit(1);
  }
  pages.sort(
    (a, b) => PAGE_ORDER.indexOf(a.route) - PAGE_ORDER.indexOf(b.route),
  );

  const now = new Date();
  const out = [
    "# VulnRadar Public Docs — AI Knowledge",
    "",
    `_Auto-compiled from \`app/docs/*/page.tsx\` on ${now.toISOString().slice(0, 10)}._`,
    "",
    "This file is consumed by the AI system prompt at runtime so the",
    "assistant can answer questions about every public docs page. Edit",
    "the source pages; this file regenerates on `npm run build` and",
    "`npm run dev`.",
    "",
    "---",
    "",
  ];

  for (const p of pages) {
    const src = readFileSync(p.path, "utf8");
    const ex = extractFromPage(src);
    out.push(renderPage(p.route, ex));
  }

  writeFileSync(OUTPUT, out.join("\n"), "utf8");
  console.log(
    `[compile-docs-knowledge] wrote ${relative(ROOT, OUTPUT)} (${pages.length} pages)`,
  );

  if (existsSync(OUTPUT)) {
    const newestPage = pages
      .map((p) => statSync(p.path).mtimeMs)
      .reduce((a, b) => Math.max(a, b), 0);
    const knowledgeMtime = statSync(OUTPUT).mtimeMs;
    const daysStale = (newestPage - knowledgeMtime) / 86400000;
    if (daysStale > 30) {
      console.warn(
        `[compile-docs-knowledge] WARNING: docs were edited ${Math.round(daysStale)} days after this knowledge file. Re-running the build will refresh it.`,
      );
    }
  }
}

build();
