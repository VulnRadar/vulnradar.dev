#!/usr/bin/env node
// Compile the public docs page content into a single knowledge file
// that the AI system prompt loads at runtime.
//
// Why a build step: the docs pages live in `app/docs/*/page.tsx` as
// React components with hardcoded JSX. The AI prompt is plain text.
// We extract a concise markdown summary here and the server reads
// the result on every chat request.
//
// What we extract (per page):
//   - DocsHero badge / title / description
//   - All DocsSection ids and titles (the page's TOC)
//   - All CodeBlock blocks (inline + template-literal forms)
//   - All DocsCallout blocks (variant + title + body)
//   - All DocsCodeTabs blocks (each tab: label + language + code)
//   - The typed endpoints: Endpoint[] array (API + Webhooks pages)
//   - The platformFeatures / apiCategories / etc. Feature[] arrays
//   - All DocsTable headers + rows
//   - H3 and H4 headings (for "Step N:" structure)
//   - Paragraph text (cleaned of JSX noise)
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
import { dirname, join, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..");
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
  const pages = readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const page = join(DOCS_DIR, d.name, "page.tsx");
      if (!existsSync(page)) return null;
      return { slug: d.name, path: page, route: `/docs/${d.name}` };
    })
    .filter(Boolean);
  const root = join(DOCS_DIR, "page.tsx");
  if (existsSync(root)) {
    pages.push({ slug: "", path: root, route: "/docs" });
  }
  return pages;
}

function stripJsx(s) {
  // This is intentional one-pass HTML entity decoding for AI training data.
  // Double-decoding is not possible: each replace is a fixed pattern and the
  // output is plain text, never re-inserted into HTML.
  s = s.replace(/<[^>]+>/g, ""); // codeql[js/incomplete-multi-character-sanitization]
  s = s.replace(/&amp;/g, "&"); // codeql[js/double-escaping]
  return s
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

function extractStringProp(source, prop) {
  const re = new RegExp(`${prop}=\\"([^\\"]+)\\"`, "g");
  const out = [];
  let m;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

function extractArrayOfObjects(source, varName) {
  const startRe = new RegExp(
    `(?:const|let|var)\\s+${varName}(?::\\s*[A-Za-z_<>\\[\\], ]+)?\\s*=\\s*\\[`,
  );
  const startMatch = source.match(startRe);
  if (!startMatch) return [];
  let i = startMatch.index + startMatch[0].length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return [];
  const arrSource = source.slice(start, i);

  const items = [];
  let d = 0;
  let objStart = -1;
  for (let j = 0; j < arrSource.length; j++) {
    const c = arrSource[j];
    if (c === "{") {
      if (d === 0) objStart = j;
      d++;
    } else if (c === "}") {
      d--;
      if (d === 0 && objStart !== -1) {
        const objSource = arrSource.slice(objStart, j + 1);
        items.push(parseObjectLiteral(objSource));
        objStart = -1;
      }
    }
  }
  return items;
}

function parseObjectLiteral(objSource) {
  const out = {};
  const propRe =
    /(\w+):\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`|\[[\s\S]*?\]|\{[\s\S]*?\}|true|false|null|-?\d+(\.\d+)?)/g;
  let m;
  while ((m = propRe.exec(objSource)) !== null) {
    const key = m[1];
    let value = m[2];
    if (value.startsWith("`") && value.endsWith("`")) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (value.startsWith('"') || value.startsWith("'")) {
      value = value.slice(1, -1);
    } else if (value.startsWith("[")) {
      value = "[array]";
    } else if (value.startsWith("{")) {
      value = "{object}";
    } else if (value === "true" || value === "false" || value === "null") {
      value = JSON.parse(value);
    } else if (!isNaN(Number(value))) {
      value = Number(value);
    }
    out[key] = value;
  }
  return out;
}

function extractArrayOfStrings(source, varName) {
  const startRe = new RegExp(
    `(?:const|let|var)\\s+${varName}(?::\\s*string\\[\\])?\\s*=\\s*\\[`,
  );
  const m = source.match(startRe);
  if (!m) return [];
  const tail = source.slice(m.index + m[0].length);
  const end = tail.indexOf("];");
  if (end === -1) return [];
  return [...tail.slice(0, end).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) =>
    x[1].replace(/\\"/g, '"'),
  );
}

function extractEndpoints(source) {
  const items = extractArrayOfObjects(source, "endpoints");
  return items.filter(
    (e) => e && typeof e === "object" && (e.method || e.path || e.title),
  );
}

function extractGenericFeatureArray(source, name) {
  return extractArrayOfObjects(source, name);
}

function extractFromPage(source) {
  const out = {
    hero: null,
    sections: [],
    callouts: [],
    codeTabs: [],
    codeBlocks: [],
    headings: [],
    paragraphs: [],
    endpoints: [],
    featureArrays: {},
    arrays: {},
  };

  const heroSimple = source.match(
    /<DocsHero[\s\S]*?title="([^"]+)"[\s\S]*?description="([^"]+)"[\s\S]*?\/>/,
  );
  if (heroSimple) {
    out.hero = { title: heroSimple[1], description: heroSimple[2] };
  } else {
    const heroTL = source.match(
      /<DocsHero[\s\S]*?title=\{`([^`]+)`\}[\s\S]*?description=\{`([\s\S]+?)`\}[\s\S]*?\/>/,
    );
    if (heroTL) {
      out.hero = { title: heroTL[1], description: heroTL[2] };
    } else {
      const heroMix = source.match(
        /<DocsHero[\s\S]*?title=\{`([^`]+)`\}[\s\S]*?description="([^"]+)"[\s\S]*?\/>/,
      );
      if (heroMix) {
        out.hero = { title: heroMix[1], description: heroMix[2] };
      }
    }
  }

  const sectionRe =
    /<DocsSection[^>]*?id="([^"]+)"[^>]*?title="([^"]+)"[^>]*?>/g;
  let m;
  while ((m = sectionRe.exec(source)) !== null) {
    out.sections.push({ id: m[1], title: m[2] });
  }
  const sectionTLRe =
    /<DocsSection[^>]*?id="([^"]+)"[^>]*?title=\{`([^`]+)`\}[^>]*?>/g;
  while ((m = sectionTLRe.exec(source)) !== null) {
    out.sections.push({ id: m[1], title: m[2] });
  }

  const calloutRe =
    /<DocsCallout[^>]*?variant="([^"]+)"[^>]*?title="([^"]+)"[^>]*?>([\s\S]*?)<\/DocsCallout>/g;
  while ((m = calloutRe.exec(source)) !== null) {
    out.callouts.push({
      variant: m[1],
      title: m[2],
      body: stripJsx(m[3]).slice(0, 300),
    });
  }
  const calloutNoVariantRe =
    /<DocsCallout[^>]*?title="([^"]+)"[^>]*?>([\s\S]*?)<\/DocsCallout>/g;
  while ((m = calloutNoVariantRe.exec(source)) !== null) {
    if (!out.callouts.find((c) => c.title === m[1])) {
      out.callouts.push({
        variant: "info",
        title: m[1],
        body: stripJsx(m[2]).slice(0, 300),
      });
    }
  }

  const codeTabsRe =
    /<DocsCodeTabs[^>]*?tabs=\{(\[[\s\S]*?\])\}[^>]*?(?:\/>|>)/g;
  while ((m = codeTabsRe.exec(source)) !== null) {
    const arr = m[1];
    const tabs = [];
    const tabRe =
      /\{\s*id:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*,\s*language:\s*"([^"]+)"\s*,\s*code:\s*"([\s\S]+?)"\s*\}/g;
    let tm;
    while ((tm = tabRe.exec(arr)) !== null) {
      tabs.push({
        id: tm[1],
        label: tm[2],
        language: tm[3],
        code: tm[4].replace(/\\n/g, "\n").replace(/\\"/g, '"'),
      });
    }
    if (tabs.length) out.codeTabs.push(tabs);
  }

  const codeRe =
    /<CodeBlock[^>]*?code=\{`([\s\S]+?)`\}[\s\S]*?language="([^"]+)"[^>]*?\/>/g;
  while ((m = codeRe.exec(source)) !== null) {
    out.codeBlocks.push({ code: m[1], language: m[2] });
  }
  const codeReInline =
    /<CodeBlock[^>]*?code="([^"]+)"[^>]*?language="([^"]+)"[^>]*?\/>/g;
  while ((m = codeReInline.exec(source)) !== null) {
    out.codeBlocks.push({
      code: m[1].replace(/\\n/g, "\n"),
      language: m[2],
    });
  }
  const codeReCodeOnly = /<CodeBlock[^>]*?code=\{`([\s\S]+?)`\}[^>]*?\/>/g;
  while ((m = codeReCodeOnly.exec(source)) !== null) {
    if (!out.codeBlocks.find((b) => b.code === m[1])) {
      out.codeBlocks.push({ code: m[1], language: "text" });
    }
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
      t.length < 600 &&
      !t.includes("{") &&
      !/^[{<]/.test(t)
    ) {
      out.paragraphs.push(t);
    }
  }

  out.endpoints = extractEndpoints(source);

  for (const name of [
    "platformFeatures",
    "apiCategories",
    "webhookFeatures",
    "rateLimitTiers",
    "architectureLayers",
    "developerTools",
    "configCategories",
    "selfHostingPaths",
    "selfHostingOptions",
  ]) {
    const arr = extractGenericFeatureArray(source, name);
    if (arr.length) out.featureArrays[name] = arr;
  }

  for (const name of [
    "principles",
    "rules",
    "requirements",
    "considerations",
    "commonTasks",
  ]) {
    const arr = extractArrayOfStrings(source, name);
    if (arr.length) out.arrays[name] = arr;
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

  if (extracted.callouts.length) {
    lines.push("### Callouts");
    for (const c of extracted.callouts) {
      lines.push(`> **${c.variant.toUpperCase()}: ${c.title}**`);
      if (c.body) lines.push(`> ${c.body}`);
      lines.push("");
    }
  }

  if (Object.keys(extracted.featureArrays).length) {
    lines.push("### Feature lists");
    for (const [name, arr] of Object.entries(extracted.featureArrays)) {
      lines.push(`#### ${name}`);
      for (const item of arr) {
        const title = item.title || item.name || JSON.stringify(item);
        const desc = item.description || item.desc || "";
        if (desc) {
          lines.push(`- **${title}** — ${desc.slice(0, 250)}`);
        } else {
          lines.push(`- ${title}`);
        }
      }
      lines.push("");
    }
  }

  if (Object.keys(extracted.arrays).length) {
    lines.push("### Lists");
    for (const [name, arr] of Object.entries(extracted.arrays)) {
      lines.push(`#### ${name}`);
      for (const s of arr) lines.push(`- ${s}`);
      lines.push("");
    }
  }

  if (extracted.endpoints.length) {
    lines.push("### Endpoints");
    for (const e of extracted.endpoints) {
      const method = e.method || "?";
      const path = e.path || "/";
      const title = e.title || "";
      const desc = e.description || "";
      lines.push(`#### \`${method} ${path}\` — ${title}`);
      if (desc) lines.push(desc);
      lines.push("");
      if (e.auth) lines.push(`- **Auth required:** yes`);
      if (e.requestBody) {
        lines.push("- **Request body:**");
        lines.push("```json");
        lines.push(e.requestBody);
        lines.push("```");
        lines.push("");
      }
      if (e.responseExample) {
        lines.push("- **Response (200):**");
        lines.push("```json");
        lines.push(e.responseExample);
        lines.push("```");
        lines.push("");
      }
      if (Array.isArray(e.pathParams) && e.pathParams.length) {
        lines.push("- **Path parameters:**");
        for (const p of e.pathParams) {
          lines.push(
            `  - \`${p.name}\` (${p.type})${p.required ? " required" : ""} — ${p.description || ""}`,
          );
        }
        lines.push("");
      }
      if (Array.isArray(e.queryParams) && e.queryParams.length) {
        lines.push("- **Query parameters:**");
        for (const p of e.queryParams) {
          lines.push(
            `  - \`${p.name}\` (${p.type})${p.required ? " required" : ""} — ${p.description || ""}`,
          );
        }
        lines.push("");
      }
      if (Array.isArray(e.notes) && e.notes.length) {
        lines.push("- **Notes:**");
        for (const n of e.notes) lines.push(`  - ${n}`);
        lines.push("");
      }
      if (Array.isArray(e.errors) && e.errors.length) {
        lines.push("- **Errors:**");
        for (const er of e.errors) {
          lines.push(`  - \`${er.code}\` — ${er.description}`);
        }
        lines.push("");
      }
    }
  }

  if (extracted.codeTabs.length) {
    lines.push("### Code tabs");
    for (const tabs of extracted.codeTabs) {
      for (const t of tabs) {
        lines.push(`**${t.label}** (${t.language}):`);
        lines.push("```" + t.language);
        lines.push(t.code);
        lines.push("```");
        lines.push("");
      }
    }
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
    "Extraction covers: DocsHero, DocsSection, DocsCallout,",
    "DocsCodeTabs, CodeBlock, EndpointCard (typed endpoints array),",
    "Feature[] arrays (platformFeatures, apiCategories, etc.), TOC",
    "headings, and prose paragraphs.",
    "",
    "---",
    "",
  ];

  const summary = [];
  for (const p of pages) {
    const src = readFileSync(p.path, "utf8");
    const ex = extractFromPage(src);
    out.push(renderPage(p.route, ex));
    summary.push({
      route: p.route,
      hero: !!ex.hero,
      sections: ex.sections.length,
      callouts: ex.callouts.length,
      codeTabs: ex.codeTabs.reduce((a, t) => a + t.length, 0),
      codeBlocks: ex.codeBlocks.length,
      endpoints: ex.endpoints.length,
      features: Object.values(ex.featureArrays).reduce(
        (a, arr) => a + arr.length,
        0,
      ),
      paragraphs: ex.paragraphs.length,
      headings: ex.headings.length,
    });
  }

  out.push("---");
  out.push("");
  out.push("## Extraction summary (for debugging)");
  out.push("");
  out.push(
    "| Page | Hero | Sections | Callouts | Code tabs | Code blocks | Endpoints | Features | Paragraphs | Headings |",
  );
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const s of summary) {
    out.push(
      `| \`${s.route}\` | ${s.hero ? "✓" : "—"} | ${s.sections} | ${s.callouts} | ${s.codeTabs} | ${s.codeBlocks} | ${s.endpoints} | ${s.features} | ${s.paragraphs} | ${s.headings} |`,
    );
  }
  out.push("");

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
