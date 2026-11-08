import { DOCS_NAV } from "./docs-nav";
import type { DocsAudience, NavItem, NavSection } from "./docs-types";

/**
 * One searchable destination. A page has no `heading`; a table-of-contents
 * entry does, and its href carries the hash. `text` is only present in the
 * richer index the knowledge compiler can emit, which has the same shape.
 */
export interface DocsSearchRecord {
  href: string;
  page: string;
  section: string;
  audience: DocsAudience;
  heading?: string;
  summary?: string;
  text?: string;
}

function recordsForItem(
  item: NavItem,
  section: NavSection,
): DocsSearchRecord[] {
  const base = {
    page: item.label,
    section: section.title,
    audience: section.audience,
  };
  return [
    { ...base, href: item.href, summary: item.summary },
    ...item.toc.map((entry) => ({
      ...base,
      href: `${item.href}#${entry.id}`,
      heading: entry.label,
    })),
    ...(item.children ?? []).flatMap((child) => recordsForItem(child, section)),
  ];
}

/** Built from the registry in the browser: no build step and no service. */
export function buildDocsSearchRecords(
  nav: NavSection[] = DOCS_NAV,
): DocsSearchRecord[] {
  return nav.flatMap((section) =>
    section.items.flatMap((item) => recordsForItem(item, section)),
  );
}

/** The display name of a record: "Webhooks > Security", or just "Webhooks". */
export function docsRecordLabel(record: DocsSearchRecord): string {
  return record.heading ? `${record.page} > ${record.heading}` : record.page;
}

function isSearchRecord(value: unknown): value is DocsSearchRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.href === "string" &&
    record.href.startsWith("/docs") &&
    typeof record.page === "string" &&
    typeof record.section === "string" &&
    typeof record.audience === "string"
  );
}

/** Keeps only well-formed rows of a fetched index; null when nothing is left. */
export function parseDocsSearchIndex(
  value: unknown,
): DocsSearchRecord[] | null {
  if (!Array.isArray(value)) return null;
  const records = value.filter(isSearchRecord);
  return records.length > 0 ? records : null;
}

export interface DocsSearchGroup {
  page: string;
  href: string;
  audience: DocsAudience;
  records: DocsSearchRecord[];
}

function scoreRecord(record: DocsSearchRecord, tokens: string[]): number {
  const title = (record.heading ?? record.page).toLowerCase();
  const page = record.page.toLowerCase();
  const summary = (record.summary ?? "").toLowerCase();
  const section = record.section.toLowerCase();
  const text = (record.text ?? "").toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (title === token) score += 100;
    else if (title.startsWith(token)) score += 60;
    else if (title.includes(token)) score += 40;
    else if (page.includes(token)) score += 20;
    else if (summary.includes(token)) score += 10;
    else if (section.includes(token)) score += 5;
    else if (text.includes(token)) score += 1;
    else return 0;
  }
  return record.heading ? score : score + 1;
}

/**
 * Every token has to match somewhere. Results are grouped by page, and the
 * pages for the reader's own audience come first, because a self-hoster and an
 * API developer searching "webhooks" want different things first.
 */
export function searchDocs(
  records: DocsSearchRecord[],
  query: string,
  currentAudience?: DocsAudience,
  limit = 40,
): DocsSearchGroup[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored = records
    .map((record) => ({ record, score: scoreRecord(record, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const groups = new Map<string, DocsSearchGroup & { best: number }>();
  for (const { record, score } of scored) {
    const href = record.href.split("#")[0];
    const group = groups.get(href);
    if (group) {
      group.records.push(record);
    } else {
      groups.set(href, {
        page: record.page,
        href,
        audience: record.audience,
        records: [record],
        best: score,
      });
    }
  }

  const ownAudience = (group: DocsSearchGroup) =>
    group.audience === currentAudience ? 0 : 1;
  return [...groups.values()]
    .sort((a, b) => ownAudience(a) - ownAudience(b) || b.best - a.best)
    .map(({ best: _best, ...group }) => group);
}
