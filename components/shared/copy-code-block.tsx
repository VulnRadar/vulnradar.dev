"use client"

import { Copy, Check } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

interface CopyCodeBlockProps {
  code: string
  children?: React.ReactNode
}

export function CopyCodeBlock({ code, children }: CopyCodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  return (
    <div className="relative">
      <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto">
        <code>{children}</code>
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute top-2 right-2 h-8 w-8 p-0"
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}
