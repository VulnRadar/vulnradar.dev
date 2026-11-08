"use client";

import { usePathname } from "next/navigation";
import { DOCS_LAST_MODIFIED } from "@/lib/docs/last-modified.generated";
import { APP_REPO, APP_URL } from "@/lib/config/client-constants";
import { formatDate } from "@/lib/ui/format-date";
import { useDocsContext } from "./docs-context";
import { docsPageContext } from "./docs-nav";

const footerLink =
  "-my-1.5 block rounded-sm py-3 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:py-1.5";

export function docsEditUrl(source: string): string {
  return `https://github.com/${APP_REPO}/edit/main/${source}`;
}

/** A new issue that already says which page and section it is about. */
export function docsReportUrl(pathname: string, section: string): string {
  const url = `${APP_URL}${pathname}${section ? `#${section}` : ""}`;
  const params = new URLSearchParams({
    title: `Docs: problem on ${pathname}`,
    body: `Page: ${url}\n\nWhat is wrong:\n`,
  });
  return `https://github.com/${APP_REPO}/issues/new?${params.toString()}`;
}

/** Last updated, edit and report, under every registered page. */
export function DocsPageFooter() {
  const pathname = usePathname();
  const { activeSection } = useDocsContext();
  const { current } = docsPageContext(pathname);
  if (!current) return null;

  const lastModified = DOCS_LAST_MODIFIED[current.source];

  return (
    <div className="mt-16 flex flex-col border-t border-border/50 pt-8 text-[13px] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      {lastModified && (
        <p className="py-3 sm:py-0">Last updated {formatDate(lastModified)}</p>
      )}
      <a
        href={docsEditUrl(current.source)}
        target="_blank"
        rel="noopener noreferrer"
        className={footerLink}
      >
        Edit this page on GitHub
      </a>
      <a
        href={docsReportUrl(pathname, activeSection)}
        target="_blank"
        rel="noopener noreferrer"
        className={footerLink}
      >
        Report a problem with this page
      </a>
    </div>
  );
}
