"use client";

import React from "react";
import { useState } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  Code2,
  FileWarning,
  Lightbulb,
  Copy,
  Check,
  ShieldAlert,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/scanner/severity-badge";
import type { Vulnerability } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";

interface IssueDetailProps {
  issue: Vulnerability;
  onBack: () => void;
}

const CATEGORY_CONFIG: Record<string, { bg: string; text: string }> = {
  headers: { bg: "bg-blue-500/10", text: "text-blue-500" },
  ssl: { bg: "bg-purple-500/10", text: "text-purple-500" },
  content: { bg: "bg-amber-500/10", text: "text-amber-500" },
  cookies: { bg: "bg-orange-500/10", text: "text-orange-500" },
  configuration: { bg: "bg-cyan-500/10", text: "text-cyan-500" },
  "information-disclosure": { bg: "bg-rose-500/10", text: "text-rose-500" },
};

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative rounded-xl border border-border overflow-hidden bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-card/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/20" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/20" />
            <span className="w-3 h-3 rounded-full bg-green-500/20" />
          </div>
          <span className="text-xs font-mono text-muted-foreground ml-2">
            {language}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-emerald-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
        <code className="font-mono text-[13px] text-foreground/90">{code}</code>
      </pre>
    </div>
  );
}

function CollapsibleSection({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  defaultOpen = true,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-lg",
              iconBg,
            )}
          >
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen && <div className="px-4 pb-4 pt-0">{children}</div>}
    </div>
  );
}

export function IssueDetail({ issue, onBack }: IssueDetailProps) {
  const [activeTab, setActiveTab] = useState(0);
  const catConfig = CATEGORY_CONFIG[issue.category] || {
    bg: "bg-muted",
    text: "text-muted-foreground",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit group"
        type="button"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Back to results
      </button>

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Severity bar */}
        <div
          className={cn(
            "h-1",
            issue.severity === "critical" && "bg-red-500",
            issue.severity === "high" && "bg-orange-500",
            issue.severity === "medium" && "bg-yellow-500",
            issue.severity === "low" && "bg-blue-500",
            issue.severity === "info" && "bg-muted-foreground",
          )}
        />

        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <SeverityBadge severity={issue.severity} />
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                catConfig.bg,
                catConfig.text,
              )}
            >
              {issue.category.replace("-", " ")}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mb-2">
            {issue.title}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {issue.description}
          </p>
        </div>
      </div>

      {/* What This Means */}
      <CollapsibleSection
        icon={Lightbulb}
        iconColor="text-primary"
        iconBg="bg-primary/10"
        title="What This Means"
      >
        <p className="text-sm text-muted-foreground leading-relaxed">
          {issue.explanation}
        </p>
      </CollapsibleSection>

      {/* Evidence */}
      <CollapsibleSection
        icon={FileWarning}
        iconColor="text-amber-500"
        iconBg="bg-amber-500/10"
        title="Live Evidence"
      >
        <div className="rounded-lg bg-muted/30 p-3 border border-border/50">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">
              Detected from live scan
            </span>
          </div>
          {issue.evidence.includes("\n") ? (
            <ul className="flex flex-col gap-1">
              {issue.evidence.split("\n").map((line, i) => (
                <li
                  key={i}
                  className="text-sm font-mono text-foreground/80 break-all leading-relaxed"
                >
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-mono text-foreground/80 break-all leading-relaxed">
              {issue.evidence}
            </p>
          )}
        </div>
      </CollapsibleSection>

      {/* Risk Impact */}
      <CollapsibleSection
        icon={ShieldAlert}
        iconColor="text-orange-500"
        iconBg="bg-orange-500/10"
        title="Risk Impact"
      >
        <p className="text-sm text-muted-foreground leading-relaxed">
          {issue.riskImpact}
        </p>
      </CollapsibleSection>

      {/* Fix Steps */}
      <CollapsibleSection
        icon={AlertTriangle}
        iconColor="text-emerald-500"
        iconBg="bg-emerald-500/10"
        title="How to Fix"
      >
        <ol className="flex flex-col gap-3">
          {issue.fixSteps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-bold shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="text-muted-foreground leading-relaxed">
                {step}
              </span>
            </li>
          ))}
        </ol>
      </CollapsibleSection>

      {/* Code Examples */}
      {issue.codeExamples.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 px-1">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-500/10">
              <Code2 className="h-4 w-4 text-violet-500" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              Code Examples
            </h3>
          </div>

          {issue.codeExamples.length > 1 && (
            <div className="flex gap-1 p-1 rounded-lg bg-muted/50 w-fit">
              {issue.codeExamples.map((example, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveTab(i)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap",
                    activeTab === i
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {example.label}
                </button>
              ))}
            </div>
          )}

          <CodeBlock
            code={issue.codeExamples[activeTab].code}
            language={issue.codeExamples[activeTab].language}
          />
        </div>
      )}

      {/* Learn More Link */}
      {issue.references && issue.references.length > 0 && (
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-card/50">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Learn More
          </span>
          <div className="flex flex-wrap gap-2">
            {issue.references.map((ref, i) => (
              <a
                key={i}
                href={ref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {new URL(ref).hostname}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
