"use client";

import { useState } from "react";
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

  return (
    <div className={cn("space-y-0", className)}>
      <div className="flex gap-1 border-b border-border/40">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors rounded-t-lg",
              activeTab === tab.id
                ? "bg-secondary/30 text-foreground border-b-2 border-primary -mb-[1px]"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTabData && (
        <CodeBlock
          code={activeTabData.code}
          language={activeTabData.language}
        />
      )}
    </div>
  );
}
