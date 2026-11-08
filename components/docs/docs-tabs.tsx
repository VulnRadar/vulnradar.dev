"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/ui/utils";
import {
  DocsTabStrip,
  panelDomId,
  tabDomId,
  useTabGroup,
} from "./docs-tab-strip";

export interface DocsTab {
  id: string;
  label: string;
  content: ReactNode;
}

interface DocsTabsProps {
  tabs: DocsTab[];
  defaultTab?: string;
  /** Tab sets sharing a group switch together and remember the choice. */
  group?: string;
  /** Names the set for screen readers. */
  label?: string;
  className?: string;
}

/**
 * Tabs for prose ("In the app" / "With the API", "Image" / "Source"). Every
 * panel is rendered and the inactive ones are `hidden`, so all of it is in the
 * server's HTML for search and for a reader without JavaScript.
 */
export function DocsTabs({
  tabs,
  defaultTab,
  group,
  label = "Ways to do this",
  className,
}: DocsTabsProps) {
  const [active, setActive] = useTabGroup(
    group,
    tabs.map((tab) => tab.id),
    defaultTab || tabs[0]?.id,
  );
  const baseId = useId().replace(/:/g, "");

  return (
    <div className={className}>
      <DocsTabStrip
        tabs={tabs}
        active={active}
        onSelect={setActive}
        baseId={baseId}
        label={label}
      />
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelDomId(baseId, tab.id)}
          aria-labelledby={tabDomId(baseId, tab.id)}
          hidden={active !== tab.id}
          className={cn("pt-4", active === tab.id && "space-y-4")}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
