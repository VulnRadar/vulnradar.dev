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
        "p-1.5 rounded-md bg-secondary/50 hover:bg-secondary transition-colors",
        className
      )}
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
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
      <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm border border-border/40">
        <code className={`language-${language}`}>{code}</code>
      </pre>
      {showCopy && <CopyButton text={code} className="absolute top-3 right-3" />}
    </div>
  )
}

interface InlineCodeProps {
  children: React.ReactNode
  className?: string
}

export function InlineCode({ children, className }: InlineCodeProps) {
  return (
    <code className={cn("bg-secondary px-1.5 py-0.5 rounded text-xs font-mono", className)}>
      {children}
    </code>
  )
}
