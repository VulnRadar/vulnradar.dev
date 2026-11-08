"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/ui/utils";

export interface DocsTabDef {
  id: string;
  label: string;
}

export const tabDomId = (baseId: string, id: string) => `${baseId}-tab-${id}`;
export const panelDomId = (baseId: string, id: string) =>
  `${baseId}-panel-${id}`;

const STORAGE_PREFIX = "vr-docs-tab:";
const remembered = new Map<string, string | null>();
const listeners = new Set<() => void>();

function readGroup(group: string): string | null {
  const cached = remembered.get(group);
  if (cached !== undefined) return cached;
  let value: string | null = null;
  try {
    value = localStorage.getItem(STORAGE_PREFIX + group);
  } catch {
    // Storage blocked or unavailable: the group just starts on its default.
  }
  remembered.set(group, value);
  return value;
}

function writeGroup(group: string, id: string) {
  remembered.set(group, id);
  try {
    localStorage.setItem(STORAGE_PREFIX + group, id);
  } catch {
    // Same as above: the choice still applies for this page view.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const noGroup = () => null;

/**
 * Which tab is showing. With a `group`, picking Python once switches every
 * group of that name on the page and is remembered for the next one, and a
 * group whose tabs do not include the remembered choice keeps its own.
 *
 * The server snapshot is null, so the server's HTML always shows the default
 * and a remembered choice applies right after hydration without a mismatch.
 */
export function useTabGroup(
  group: string | undefined,
  ids: string[],
  fallback: string,
): [string, (id: string) => void] {
  const [local, setLocal] = useState(fallback);
  const chosen = useSyncExternalStore(
    subscribe,
    group ? () => readGroup(group) : noGroup,
    noGroup,
  );
  const active = chosen !== null && ids.includes(chosen) ? chosen : local;

  const select = (id: string) => {
    setLocal(id);
    if (group) writeGroup(group, id);
  };
  return [active, select];
}

interface DocsTabStripProps {
  tabs: DocsTabDef[];
  active: string;
  onSelect: (id: string) => void;
  baseId: string;
  label: string;
  className?: string;
}

/**
 * The tab strip every docs tab set shares. It is a single tab stop with the
 * arrows moving between tabs, which is the documented tab pattern; the
 * tabpanels belong to the caller, under panelDomId.
 */
export function DocsTabStrip({
  tabs,
  active,
  onSelect,
  baseId,
  label,
  className,
}: DocsTabStripProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // A strip wider than a phone scrolls, and the remembered tab can be the one
  // off-screen. scrollLeft rather than scrollIntoView, which would also move
  // the page.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && tab) {
      list.scrollLeft =
        tab.offsetLeft -
        list.offsetLeft -
        (list.clientWidth - tab.offsetWidth) / 2;
    }
  }, [active]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = keys[e.key];
    if (target === undefined) return;
    e.preventDefault();
    const next = (target + tabs.length) % tabs.length;
    onSelect(tabs[next].id);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      // Scrolls rather than overflows: every tab is shrink-0 whitespace-nowrap
      // and four labels are wider than a 343px phone.
      className={cn(
        "flex gap-1 scroll-x-only scrollbar-hide border-b border-border/50",
        className,
      )}
    >
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabDomId(baseId, tab.id)}
          aria-controls={panelDomId(baseId, tab.id)}
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onKeyDown={(e) => onKeyDown(e, i)}
          onClick={() => onSelect(tab.id)}
          className={cn(
            // The underline treatment, geometry matched to
            // components/history/history-view-tabs.tsx so the product has one
            // underline tab rather than two.
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            active === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
