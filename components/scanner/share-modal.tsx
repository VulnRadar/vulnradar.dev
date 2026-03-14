"use client"

import { useState } from "react"
import { X, Link2, Check, Copy, Mail, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shareUrl: string
  title?: string
}

/**
 * Clipboard write with fallback for mobile browsers that don't support
 * navigator.clipboard (or block it outside secure user-gesture contexts).
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy fallback
    }
  }

  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.left = "-9999px"
    textarea.style.top = "-9999px"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const success = document.execCommand("copy")
    document.body.removeChild(textarea)
    return success
  } catch {
    return false
  }
}

const SHARE_OPTIONS = [
  {
    id: "x",
    label: "X",
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    bgColor: "bg-foreground",
    textColor: "text-background",
    hoverColor: "hover:bg-foreground/90",
    getUrl: (url: string, title: string) =>
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
    bgColor: "bg-[#1877F2]",
    textColor: "text-white",
    hoverColor: "hover:bg-[#1877F2]/90",
    getUrl: (url: string) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
    bgColor: "bg-[#0A66C2]",
    textColor: "text-white",
    hoverColor: "hover:bg-[#0A66C2]/90",
    getUrl: (url: string, title: string) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    bgColor: "bg-[#25D366]",
    textColor: "text-white",
    hoverColor: "hover:bg-[#25D366]/90",
    getUrl: (url: string, title: string) =>
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  },
  {
    id: "email",
    label: "Email",
    icon: Mail,
    bgColor: "bg-muted",
    textColor: "text-foreground",
    hoverColor: "hover:bg-muted/80",
    getUrl: (url: string, title: string) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`Check out this VulnRadar scan report:\n\n${url}`)}`,
  },
]

export function ShareModal({ open, onOpenChange, shareUrl, title = "VulnRadar Scan Report" }: ShareModalProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const success = await copyText(shareUrl)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function handleShare(option: (typeof SHARE_OPTIONS)[number]) {
    const url = option.getUrl(shareUrl, title)
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=400")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-center text-lg font-semibold">Share</DialogTitle>
          <DialogDescription className="sr-only">Share this scan report via social media or copy the link</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* Share options grid */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {SHARE_OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.id}
                  onClick={() => handleShare(option)}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <div
                    className={cn(
                      "flex items-center justify-center h-12 w-12 rounded-full transition-all",
                      option.bgColor,
                      option.textColor,
                      option.hoverColor
                    )}
                  >
                    <Icon />
                  </div>
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* URL copy section */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                readOnly
                value={shareUrl}
                className="pl-10 pr-3 bg-muted/50 border-border text-sm font-mono truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
            <Button
              onClick={handleCopy}
              size="sm"
              className={cn(
                "min-w-[80px] transition-all",
                copied
                  ? "bg-emerald-500 hover:bg-emerald-500 text-white"
                  : "bg-primary hover:bg-primary/90"
              )}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-1.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
