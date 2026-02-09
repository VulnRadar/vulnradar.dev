"use client"

import React from "react"

import { useState } from "react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  MessageSquare,
  Bug,
  Lightbulb,
  HelpCircle,
  Shield,
  Send,
  CheckCircle2,
  Mail,
  FileText,
  BookOpen,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

const CATEGORIES = [
  { id: "bug", label: "Bug Report", icon: Bug, desc: "Something is broken or not working as expected" },
  { id: "feature", label: "Feature Request", icon: Lightbulb, desc: "Suggest a new feature or improvement" },
  { id: "security", label: "Security Issue", icon: Shield, desc: "Report a security vulnerability" },
  { id: "help", label: "General Help", icon: HelpCircle, desc: "Need help using VulnRadar" },
]

export default function ContactPage() {
  const [category, setCategory] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!category) {
      setError("Please choose a category.")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          subject,
          message,
          category,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error || "Unable to send your message. Please try again.")
        return
      }

      setSubmitted(true)
    } catch {
      setError("Unable to send your message. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <div className="flex flex-col gap-2 mb-8">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            Contact & Support
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Need help? Found a bug? Have a great idea? {"We'd"} love to hear from you.
          </p>
        </div>

        {submitted ? (
          <Card className="bg-card border-border">
            <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">Message Received</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
                  Thank you for reaching out. {"We'll"} review your {category === "security" ? "security report" : "message"} and get back to you as soon as possible.
                </p>
              </div>
              <div className="flex gap-3 mt-2">
                <Button variant="outline" className="bg-transparent" onClick={() => { setSubmitted(false); setCategory(null); setSubject(""); setMessage(""); setName(""); setEmail(""); setError(null) }}>
                  Send Another
                </Button>
                <Link href="/"><Button>Back to Scanner</Button></Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Quick links */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: BookOpen, label: "Documentation", href: "/docs", desc: "Guides & API reference" },
                { icon: FileText, label: "Changelog", href: "/changelog", desc: "Latest updates" },
                { icon: Mail, label: "Email Us", href: "mailto:support@vulnradar.dev", desc: "support@vulnradar.dev" },
              ].map((link) => (
                <Link key={link.label} href={link.href} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-primary/20 transition-all">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
                    <link.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{link.label}</p>
                    <p className="text-[11px] text-muted-foreground">{link.desc}</p>
                  </div>
                </Link>
              ))}
            </div>

            {/* Category selection */}
            <div>
              <p className="text-sm font-medium text-foreground mb-3">What can we help you with?</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={cn(
                      "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-center",
                      category === cat.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted/50 hover:border-primary/20"
                    )}
                  >
                    <cat.icon className={cn("h-5 w-5", category === cat.id ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-xs font-medium text-foreground">{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Contact form */}
            {category && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {CATEGORIES.find((c) => c.id === category)?.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="contact-name" className="text-sm font-medium text-foreground">Name</label>
                        <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="contact-email" className="text-sm font-medium text-foreground">Email</label>
                        <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="contact-subject" className="text-sm font-medium text-foreground">Subject</label>
                      <Input id="contact-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary of your message" required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="contact-message" className="text-sm font-medium text-foreground">Message</label>
                      <textarea
                        id="contact-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={category === "bug" ? "What happened? Steps to reproduce, expected vs actual behavior..." : category === "security" ? "Please describe the vulnerability in detail. Include steps to reproduce if possible." : category === "feature" ? "Describe the feature you'd like to see and how it would help your workflow..." : "How can we help you?"}
                        rows={5}
                        required
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed"
                      />
                    </div>
                    {category === "security" && (
                      <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <Shield className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>Security reports are handled with priority. We aim to acknowledge within 24 hours and will keep you updated on the resolution.</span>
                      </div>
                    )}
                    {error && (
                      <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                        {error}
                      </div>
                    )}
                    <Button type="submit" className="w-full sm:w-auto self-end gap-1.5" disabled={isSubmitting}>
                      <Send className="h-3.5 w-3.5" />{isSubmitting ? "Sending..." : "Send Message"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
