"use client";

import { useState } from "react";
import { cn } from "@/lib/ui/utils";
import { CodeBlock } from "@/components/docs";

export type CodeExampleLanguage = "curl" | "javascript" | "python";

export type CodeExamples = Record<
  CodeExampleLanguage,
  { scan: string; history: string; detail: string }
>;

/**
 * AUDIT-012 fe-03: the language switcher was the only interactive thing on
 * /docs/api, and it kept the whole 1,900-line reference (every endpoint card,
 * every example payload) as a client component. It lives here now so the page
 * itself is a server component; the snippets arrive as plain strings.
 */
export function CodeExampleTabs({ examples }: { examples: CodeExamples }) {
  const [active, setActive] = useState<CodeExampleLanguage>("curl");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Example language"
        className="mb-6 flex gap-1 border-b border-border"
      >
        {(["curl", "javascript", "python"] as const).map((lang) => (
          <button
            key={lang}
            type="button"
            role="tab"
            id={`code-tab-${lang}`}
            aria-selected={active === lang}
            aria-controls="code-tabpanel"
            onClick={() => setActive(lang)}
            className={cn(
              "relative -mb-px border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-sm",
              active === lang
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {lang}
          </button>
        ))}
      </div>

      <div
        id="code-tabpanel"
        role="tabpanel"
        aria-labelledby={`code-tab-${active}`}
        className="space-y-8"
      >
        <div>
          <h4 className="font-semibold mb-3 text-sm">Create a scan</h4>
          <CodeBlock
            code={examples[active].scan}
            language={active === "curl" ? "bash" : active}
          />
        </div>
        <div>
          <h4 className="font-semibold mb-3 text-sm">List scan history</h4>
          <CodeBlock
            code={examples[active].history}
            language={active === "curl" ? "bash" : active}
          />
        </div>
        <div>
          <h4 className="font-semibold mb-3 text-sm">Get scan details</h4>
          <CodeBlock
            code={examples[active].detail}
            language={active === "curl" ? "bash" : active}
          />
        </div>
      </div>
    </div>
  );
}
