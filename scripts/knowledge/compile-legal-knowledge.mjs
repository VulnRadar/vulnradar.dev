#!/usr/bin/env node
// Compile the legal pages (Terms, Privacy, Acceptable Use, Disclaimer,
// DMCA, Accessibility) into a single knowledge file the AI system prompt
// loads on demand via the /legal slash command.
//
// Why a build step: the legal pages live in `app/legal/*/page.tsx` as
// React components (LegalSection/LegalList JSX), not plain text. This
// extracts each section's actual prose so the assistant can answer "how
// long do you keep my data" or "can staff see my account" accurately,
// straight from the same text a human reader sees, instead of guessing
// or working from a stale summary.
//
// What we extract (per page):
//   - The "last updated" date rendered by LegalPageHeader (component prop,
//     read from lib/config/config-values.ts's CONFIG_TERMS_UPDATED_AT, the
//     single source every legal page's date renders from)
//   - Every LegalSection: id, title, and its full prose content
//   - Every LegalList item within a section
//
// Run: `node scripts/knowledge/compile-legal-knowledge.mjs`
// Auto-run: hooked as prebuild + predev in package.json.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..", "..");
const LEGAL_DIR = join(ROOT, "app", "legal");
const OUTPUT = join(ROOT, "lib", "ai", "legal-knowledge.md");

const PAGES = [
  { slug: "terms", label: "Terms of Service", route: "/legal/terms" },
  { slug: "privacy", label: "Privacy Policy", route: "/legal/privacy" },
  {
    slug: "acceptable-use",
    label: "Acceptable Use Policy",
    route: "/legal/acceptable-use",
  },
  { slug: "disclaimer", label: "Disclaimer", route: "/legal/disclaimer" },
  { slug: "dmca", label: "DMCA Policy", route: "/legal/dmca" },
  {
    slug: "accessibility",
    label: "Accessibility Statement",
    route: "/legal/accessibility",
  },
];

// Bare {Identifier} JSX expressions used in the legal pages' own prose
// (not component props) that resolve to a fixed string worth inlining so
// the compiled text reads naturally instead of showing "{APP_NAME}"
// literally. Email/date variables (legalEmail, supportEmail, createdAt,
// termsUpdatedAt) are admin-configurable/runtime values, not static, so
// they're replaced with a readable placeholder instead of a specific
// value that could be wrong for a given deployment.
const STATIC_SUBSTITUTIONS = {
  APP_NAME: "VulnRadar",
  APP_URL: "the VulnRadar website",
  TOTAL_CHECKS_LABEL: "the current check count (see /checks)",
  legalEmail: "the support email address listed on this page",
  supportEmail: "the support email address listed on this page",
  securityEmail: "the security contact email listed on this page",
  createdAt: "the effective date shown on this page",
  termsUpdatedAt: "the last-updated date shown on this page",
};

function substituteBareExpressions(s) {
  return s.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (full, name) =>
    name in STATIC_SUBSTITUTIONS ? STATIC_SUBSTITUTIONS[name] : full,
  );
}

function stripJsx(s) {
  s = substituteBareExpressions(s);
  // Loop until stable -- same reasoning as compile-docs-knowledge.mjs's
  // stripJsx: a single pass can reassemble a tag from a malformed nested
  // sequence.
  let prev;
  do {
    prev = s;
    // [^>]* not [^>]+: a bare fragment tag ("<>", "</>") has zero
    // characters between "<" and ">", so a "one-or-more" class would
    // never match it and leave the literal "<>"/"</>" in the output.
    s = s.replace(/<[^>]*>/g, "");
  } while (s !== prev);
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/\{\s*\/\*[^*]*\*\/\s*\}/g, " ")
    .replace(/\{" "\}/g, " ")
    .replace(/\{`/g, "")
    .replace(/`\}/g, "")
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Split a `<LegalList items={[ ... ]} />` array's inner source into its
 * top-level items. Each item is either a plain quoted string or a JSX
 * fragment (`<>...<strong>...</strong>...</>`) -- a naive comma-split
 * breaks on JSX fragments containing commas in their own attributes/text,
 * so this tracks bracket/quote depth and only splits on a comma at depth
 * 0. Simpler than the docs compiler's object-literal parser since list
 * items here are never objects, just strings or JSX.
 */
function splitTopLevelArrayItems(arrSource) {
  const items = [];
  let depth = 0;
  let current = "";
  let inString = null; // the quote character currently open, or null
  for (let i = 0; i < arrSource.length; i++) {
    const ch = arrSource[i];
    const next = arrSource[i + 1];

    if (inString) {
      current += ch;
      if (ch === "\\") {
        // Consume the escaped character too so an escaped quote doesn't
        // close the string early.
        i++;
        current += arrSource[i] ?? "";
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === "<") {
      if (next === "/") {
        // Closing tag or fragment ("</>", "</strong>"): one net decrement
        // for the whole "</" opener. Consume the "/" here too so the
        // "/>"-self-close check below never re-examines it -- "</>" is
        // exactly "<" + "/" + ">", and without this the trailing "/>"
        // substring would double-decrement the same close.
        depth -= 1;
        current += ch + next;
        i++;
        continue;
      }
      // Bare "<" (fragment or element open) opens one level. A
      // self-closing tag "<Foo ... />" nets to zero: this branch adds the
      // +1, the "/>" check below subtracts it back on the same tag.
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === "/" && next === ">") {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "{" || ch === "(") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === "}" || ch === ")") {
      depth -= 1;
      current += ch;
      continue;
    }

    if (ch === "," && depth <= 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) items.push(trimmed);
  return items;
}

function unquoteIfPlainString(item) {
  const m =
    item.match(/^"((?:[^"\\]|\\.)*)"$/) || item.match(/^'((?:[^'\\]|\\.)*)'$/);
  return m ? m[1].replace(/\\(.)/g, "$1") : null;
}

/**
 * Extract every <LegalList items={[ ... ]} /> within a section body and
 * render its items as markdown bullets, replacing the tag with the
 * rendered list in place (so surrounding <p> prose keeps its position
 * relative to the list).
 */
function inlineLegalLists(body) {
  const listRe = /<LegalList\s+items=\{\[([\s\S]*?)\]\}\s*\/>/g;
  return body.replace(listRe, (_full, arrSource) => {
    const items = splitTopLevelArrayItems(arrSource);
    const bullets = items.map((item) => {
      const plain = unquoteIfPlainString(item);
      const text = plain !== null ? plain : stripJsx(item);
      return `- ${text}`;
    });
    return "\n" + bullets.join("\n") + "\n";
  });
}

/**
 * Extract every <LegalSection id="X" title="Y">...body...</LegalSection>
 * block. Legal sections never nest inside each other, so a non-greedy
 * match up to the next closing tag is safe (unlike the docs compiler's
 * DocsSection, which only needed id/title for a TOC, this needs the body).
 */
function extractSections(source) {
  const sectionRe =
    /<LegalSection\s+id="([^"]+)"\s+title="([^"]+)"\s*>([\s\S]*?)<\/LegalSection>/g;
  const sections = [];
  let m;
  while ((m = sectionRe.exec(source)) !== null) {
    const [, id, title, rawBody] = m;
    const withLists = inlineLegalLists(rawBody);
    sections.push({ id, title, text: stripJsx(withLists) });
  }
  return sections;
}

function renderPage(page, lastUpdated, sections) {
  const lines = [];
  lines.push(`## ${page.label}`);
  lines.push(`Route: ${page.route}`);
  if (lastUpdated) lines.push(`Last updated: ${lastUpdated}`);
  lines.push("");
  for (const s of sections) {
    lines.push(`### ${s.title}`);
    lines.push(s.text);
    lines.push("");
  }
  return lines.join("\n");
}

function readTermsUpdatedAt() {
  // CONFIG_TERMS_UPDATED_AT is a plain string literal in config-values.ts
  // (see that file), the single value every legal page's LegalPageHeader
  // renders as its "last updated" date -- read it directly rather than
  // importing the module (this script runs standalone via node, outside
  // Next's module resolution).
  const configPath = join(ROOT, "lib", "config", "config-values.ts");
  if (!existsSync(configPath)) return null;
  const src = readFileSync(configPath, "utf8");
  const m = src.match(/CONFIG_TERMS_UPDATED_AT\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function build() {
  const lastUpdated = readTermsUpdatedAt();
  const rendered = [];
  let totalSections = 0;

  for (const page of PAGES) {
    const pagePath = join(LEGAL_DIR, page.slug, "page.tsx");
    // PAGES is a fixed list, so a missing entry means a legal page was renamed
    // or deleted. This used to warn and continue, which silently shrank the
    // compiled knowledge: the build stayed green, the CI drift gate stayed
    // green (it regenerates from the same tree and gets the same short file),
    // and the assistant answered about retention or liability from nothing.
    if (!existsSync(pagePath)) {
      console.error(
        `[compile-legal-knowledge] missing ${pagePath}. Every entry in PAGES must exist; fix the path or remove the entry.`,
      );
      process.exit(1);
    }
    const src = readFileSync(pagePath, "utf8");
    const sections = extractSections(src);
    // Same reasoning one level down: a page that parses to zero sections means
    // the LegalSection shape changed, not that the policy became empty.
    if (sections.length === 0) {
      console.error(
        `[compile-legal-knowledge] extracted 0 sections from ${page.route}. The LegalSection regex no longer matches this page's component shape.`,
      );
      process.exit(1);
    }
    totalSections += sections.length;
    rendered.push(renderPage(page, lastUpdated, sections));
  }

  const now = new Date();
  const out = [
    "# VulnRadar Legal Pages: AI Knowledge",
    "",
    `_Auto-compiled from \`app/legal/*/page.tsx\` on ${now.toISOString().slice(0, 10)}._`,
    "",
    "This file is consumed by the AI system prompt at runtime (via the",
    "/legal slash command) so the assistant can answer questions about",
    "data retention, account access, acceptable use, and liability using",
    "the actual current policy text, not a guess. Edit the source pages;",
    "this file regenerates on `npm run build` and `npm run dev`.",
    "",
    "IMPORTANT for the assistant: this is informational context, not legal",
    "advice. Quote or summarize what these pages say; never speculate",
    "beyond what's written here, and tell the user to read the actual page",
    "or contact support for anything this file doesn't cover.",
    "",
    "---",
    "",
    ...rendered,
  ];

  // Checked before the write, not after: the old order wrote the broken file
  // to disk first and only then exited 1, leaving a truncated knowledge file
  // behind for anything that read it without rebuilding.
  if (totalSections === 0) {
    console.error(
      "[compile-legal-knowledge] extracted 0 sections across all pages -- the LegalSection regex likely doesn't match the current component shape. Check app/legal/*/page.tsx and components/legal/*.",
    );
    process.exit(1);
  }

  writeFileSync(OUTPUT, out.join("\n"), "utf8");
  console.log(
    `[compile-legal-knowledge] wrote ${relative(ROOT, OUTPUT)} (${PAGES.length} pages, ${totalSections} sections)`,
  );
}

build();
