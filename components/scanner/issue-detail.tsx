"use client"

import React from "react"

import { useState } from "react"
import {
  ArrowLeft,
  AlertTriangle,
  Code2,
  FileWarning,
  Lightbulb,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { SeverityBadge } from "@/components/scanner/severity-badge"
import type { Vulnerability } from "@/lib/scanner/types"
import { cn } from "@/lib/utils"

interface IssueDetailProps {
  issue: Vulnerability
  onBack: () => void
}

function CodeBlock({
  code,
  language,
}: {
  code: string
  language: string
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
        <span className="text-xs font-mono text-muted-foreground">
          {language}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed bg-card">
        <code className="font-mono text-foreground">{code}</code>
      </pre>
    </div>
  )
}

function Section({
  icon: Icon,
  iconColor,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", iconColor)} />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  )
}

export function IssueDetail({ issue, onBack }: IssueDetailProps) {
  const [activeTab, setActiveTab] = useState(0)

  return (
    <div className="flex flex-col gap-5">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to results
      </button>

      {/* Header card */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={issue.severity} />
          <span className="inline-flex items-center rounded-lg bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
            {issue.category.replace("-", " ")}
          </span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          {issue.title}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {issue.description}
        </p>
      </div>

      {/* Explanation */}
      <Section icon={Lightbulb} iconColor="text-primary" title="What This Means">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {issue.explanation}
        </p>
      </Section>

      {/* Evidence */}
      <Section icon={FileWarning} iconColor="text-primary" title="Live Evidence">
        <div className="rounded-lg bg-muted/50 p-3 border border-border/50">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              Detected from live scan
            </span>
          </div>
          {issue.evidence.includes("\n") ? (
            <ul className="flex flex-col gap-1">
              {issue.evidence.split("\n").map((line, i) => (
                <li key={i} className="text-sm font-mono text-muted-foreground break-all leading-relaxed">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-mono text-muted-foreground break-all leading-relaxed">
              {issue.evidence}
            </p>
          )}
        </div>
      </Section>

      {/* Risk Impact */}
      <Section icon={ShieldAlert} iconColor="text-orange-500" title="Risk Impact">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {issue.riskImpact}
        </p>
      </Section>

      {/* Fix Steps */}
      <Section icon={AlertTriangle} iconColor="text-emerald-500" title="How to Fix">
        <ol className="flex flex-col gap-3">
          {issue.fixSteps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-muted-foreground">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                {i + 1}
              </span>
              <span className="leading-relaxed pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </Section>

      {/* Code Examples */}
      {issue.codeExamples.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <Code2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Code Examples
            </h3>
          </div>

          {issue.codeExamples.length > 1 && (
            <div className="flex gap-1 rounded-xl bg-muted p-1 overflow-x-auto">
              {issue.codeExamples.map((example, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveTab(i)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap",
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
        </section>
      )}
    </div>
  )
}
