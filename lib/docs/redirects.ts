/**
 * Docs routes that have moved. Each row is a 308 once next.config's redirects()
 * reads this table, and the repo test treats a source here as a live link.
 *
 * A move lands in one commit: the new page, its row here, and a MOVED_ANCHORS
 * entry for any section that went to a different page (a hash never reaches
 * the server, so a redirect cannot forward it).
 */
export interface DocsRedirect {
  source: string;
  destination: string;
  permanent: true;
}

export const DOCS_REDIRECTS: DocsRedirect[] = [];
