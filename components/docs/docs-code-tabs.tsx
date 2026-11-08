"use client";

import { useId } from "react";
import { cn } from "@/lib/ui/utils";
import { CodeBlock } from "./docs-code-block";
import {
  DocsTabStrip,
  panelDomId,
  tabDomId,
  useTabGroup,
} from "./docs-tab-strip";

interface CodeTab {
  id: string;
  label: string;
  language: string;
  code: string;
}

interface DocsCodeTabsProps {
  tabs: CodeTab[];
  defaultTab?: string;
  /** Tab sets sharing a group switch together and remember the choice. */
  group?: string;
  className?: string;
}

/**
 * The three languages always read the same, whatever a call site typed, so a
 * reader who picks Python on one page finds "Python" on the next.
 */
const FIXED_LANGUAGE_LABELS: Record<string, string> = {
  curl: "curl",
  javascript: "JavaScript",
  python: "Python",
};

/**
 * Every panel is rendered and the inactive ones are `hidden`, so all three
 * languages are in the server's HTML for search and for a reader without
 * JavaScript. The tabpanel is what this used to be missing: role="tab" with
 * nothing to control.
 */
export function DocsCodeTabs({
  tabs,
  defaultTab,
  group,
  className,
}: DocsCodeTabsProps) {
  const ids = tabs.map((tab) => tab.id);
  const [active, setActive] = useTabGroup(
    group,
    ids,
    defaultTab || tabs[0]?.id,
  );
  const baseId = useId().replace(/:/g, "");

  return (
    <div className={cn("space-y-0", className)}>
      <DocsTabStrip
        tabs={tabs.map((tab) => ({
          id: tab.id,
          label: FIXED_LANGUAGE_LABELS[tab.id] ?? tab.label,
        }))}
        active={active}
        onSelect={setActive}
        baseId={baseId}
        label="Code examples"
        // Same -mx/px pair as components/history/history-view-tabs.tsx, so the
        // scrolled strip still starts flush with the panel edge.
        className="-mx-4 px-4 sm:mx-0 sm:px-0"
      />
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelDomId(baseId, tab.id)}
          aria-labelledby={tabDomId(baseId, tab.id)}
          tabIndex={0}
          hidden={active !== tab.id}
        >
          <CodeBlock code={tab.code} language={tab.language} />
        </div>
      ))}
    </div>
  );
}
