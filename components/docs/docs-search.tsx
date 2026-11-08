"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";
import { useDocsContext } from "./docs-context";
import { docsPageContext } from "./docs-nav";
import {
  buildDocsSearchRecords,
  parseDocsSearchIndex,
  searchDocs,
  type DocsSearchRecord,
} from "./docs-search-records";

/** Emitted by the knowledge compiler when it runs; absent until then. */
const STATIC_INDEX_URL = "/docs-search-index.json";

let staticIndex: Promise<DocsSearchRecord[] | null> | undefined;

function loadStaticIndex() {
  staticIndex ??= fetch(STATIC_INDEX_URL)
    .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
    .then(parseDocsSearchIndex)
    .catch(() => null);
  return staticIndex;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

const noSubscribe = () => () => {};
const clientShortcut = () =>
  /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd K" : "Ctrl K";
const serverShortcut = () => "Ctrl K";

/** The visible way in: top of the sidebar, the mobile bar, the docs home. */
export function DocsSearchButton({
  compact,
  className,
}: {
  /** Just "Search": the mobile bar has no room for the shortcut. */
  compact?: boolean;
  className?: string;
}) {
  const { openSearch } = useDocsContext();
  const shortcut = useSyncExternalStore(
    noSubscribe,
    clientShortcut,
    serverShortcut,
  );

  return (
    <button
      type="button"
      onClick={openSearch}
      className={cn(
        "flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        !compact &&
          "h-9 w-full rounded-md border border-border/60 bg-muted/30 px-2.5 hover:bg-muted",
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="text-sm">{compact ? "Search" : "Search the docs"}</span>
      {!compact && (
        <kbd className="ml-auto rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[11px]">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

/** Lives inside the dialog's content, so closing it clears the query. */
function DocsSearchPanel({
  inputRef,
  onClose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { section } = docsPageContext(pathname);
  const inputId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [richIndex, setRichIndex] = useState<DocsSearchRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadStaticIndex().then((records) => {
      if (!cancelled && records) setRichIndex(records);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const records = useMemo(
    () => richIndex ?? buildDocsSearchRecords(),
    [richIndex],
  );
  const groups = useMemo(
    () => searchDocs(records, query, section?.audience),
    [records, query, section?.audience],
  );
  const flat = groups.flatMap((group) => group.records);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function go(record: DocsSearchRecord) {
    onClose();
    router.push(record.href);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (flat[cursor]) go(flat[cursor]);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (flat.length === 0) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    setCursor((cursor + step + flat.length) % flat.length);
  }

  const optionId = (index: number) => `${inputId}-option-${index}`;

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 pl-4 pr-14">
        <Search
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          aria-label="Search the docs"
          aria-expanded={flat.length > 0}
          aria-controls={`${inputId}-results`}
          aria-activedescendant={flat.length > 0 ? optionId(cursor) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Search the docs"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onInputKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-hidden placeholder:text-muted-foreground"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:max-h-[60vh]">
        {query.trim() !== "" && flat.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing in the docs matches that.
          </p>
        )}
        <div
          ref={listRef}
          id={`${inputId}-results`}
          role="listbox"
          aria-label="Results"
          className="space-y-3"
        >
          {groups.map((group) => (
            <div key={group.href} role="group" aria-label={group.page}>
              <div
                aria-hidden="true"
                className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {group.page}
              </div>
              {group.records.map((record) => {
                const position = flat.indexOf(record);
                return (
                  // The input owns the keyboard (a combobox with
                  // aria-activedescendant); a click is the pointer path to the
                  // same action as Enter.
                  // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                  <div
                    key={record.href}
                    id={optionId(position)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={position === cursor}
                    onClick={() => go(record)}
                    onMouseMove={() => setCursor(position)}
                    className={cn(
                      "flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5",
                      position === cursor && "bg-muted",
                    )}
                  >
                    <span className="text-sm text-foreground">
                      {record.heading ?? record.page}
                    </span>
                    {record.summary && (
                      <span className="text-xs text-muted-foreground">
                        {record.summary}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

interface DocsSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Search over the page registry and every table-of-contents entry, in the
 * browser. Ctrl K here opens this rather than the site-wide palette: the
 * listener is on the window in the capture phase and stops the event, so the
 * palette's own document listener never sees the press on a docs page.
 */
export function DocsSearch({ open, onOpenChange }: DocsSearchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isPalette =
        (event.key === "k" || event.key === "K") &&
        (event.metaKey || event.ctrlKey);
      const isSlash =
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target);
      if (!isPalette && !isSlash) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onOpenChange(isPalette ? !open : true);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="shell"
        size="lg"
        // A full-screen sheet on a phone. `fixed` escapes the positioner's
        // 16px padding, which a phone cannot spare around a results list.
        className="max-sm:fixed max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search the docs</DialogTitle>
        <DialogDescription className="sr-only">
          Type to search every docs page and section. Use the up and down arrows
          to move and Enter to open.
        </DialogDescription>
        <DocsSearchPanel
          inputRef={inputRef}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
