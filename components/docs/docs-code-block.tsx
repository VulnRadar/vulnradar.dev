"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/ui/utils"

interface CopyButtonProps {
  text: string
  className?: string
}

export function CopyButton({ text, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      className={cn(
        "p-1.5 rounded-lg bg-muted/80 hover:bg-muted border border-border/40 transition-all",
        className
      )}
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
      )}
    </button>
  )
}

interface CodeBlockProps {
  code: string
  language?: string
  showCopy?: boolean
  className?: string
}

export function CodeBlock({ code, language = "json", showCopy = true, className }: CodeBlockProps) {
  return (
    <div className={cn("relative group", className)}>
      <pre className="bg-card/50 p-4 rounded-xl overflow-x-auto text-sm border border-border/50 font-mono">
        <code className={`language-${language}`}>{code}</code>
      </pre>
      {showCopy && <CopyButton text={code} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
    </div>
  )
}

interface InlineCodeProps {
  children: React.ReactNode
  className?: string
}

export function InlineCode({ children, className }: InlineCodeProps) {
  return (
    <code className={cn("bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-primary", className)}>
      {children}
    </code>
  )
}
