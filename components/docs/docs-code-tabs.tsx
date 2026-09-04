"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/ui/utils";
import { CodeBlock } from "./docs-code-block";

interface CodeTab {
  id: string;
  label: string;
  language: string;
  code: string;
}

interface DocsCodeTabsProps {
  tabs: CodeTab[];
  defaultTab?: string;
  className?: string;
}

export function DocsCodeTabs({
  tabs,
  defaultTab,
  className,
}: DocsCodeTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);
  const activeTabData = tabs.find((t) => t.id === activeTab);
  const baseId = useId().replace(/:/g, "");
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;
  const listRef = useRef<HTMLDivElement>(null);

  // The tab role used to be declared with none of what it promises: no
  // aria-controls, no tabpanel, and no arrow keys, so a screen reader
  // announced "tab, 1 of 3" for a control that governed nothing a keyboard
  // user could reach. The panel below is a real tabpanel now, and the strip
  // is a single tab stop with the arrows moving between tabs, which is the
  // documented tab pattern rather than a lookalike.
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
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
    setActiveTab(tabs[next].id);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  return (
    <div className={cn("space-y-0", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Code examples"
        // Scrolls rather than overflows: every tab is shrink-0 whitespace-nowrap
        // and four language labels are wider than a 343px phone. Same
        // -mx/px pair as components/history/history-view-tabs.tsx so the
        // scrolled strip still starts flush with the panel edge.
        className="-mx-4 flex gap-1 scroll-x-only scrollbar-hide border-b border-border/50 px-4 sm:mx-0 sm:px-0"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-controls={panelId(tab.id)}
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              // The underline treatment, geometry matched to
              // components/history/history-view-tabs.tsx so the product has
              // one underline tab rather than two. This used to stack three
              // signals for one state: an underline AND a background fill AND
              // a top corner radius.
              // py-2.5 rather than py-2: at text-sm this is the difference
              // between a 34px and a 40px target on a phone.
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTabData && (
        <div
          role="tabpanel"
          id={panelId(activeTabData.id)}
          aria-labelledby={tabId(activeTabData.id)}
          tabIndex={0}
        >
          <CodeBlock
            code={activeTabData.code}
            language={activeTabData.language}
          />
        </div>
      )}
    </div>
  );
}
