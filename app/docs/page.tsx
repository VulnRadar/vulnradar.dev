"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { BookOpen, Zap, Code2 } from "lucide-react"

export default function DocsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2">Documentation</h1>
        <p className="text-lg text-muted-foreground">Everything you need to get started with VulnRadar</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6 border-border/40">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-2xl font-bold">API Reference</h2>
          </div>
          <p className="text-muted-foreground mb-4">Learn how to use the VulnRadar REST API to scan websites programmatically.</p>
          <Button asChild variant="outline">
            <Link href="/docs/api">Read API Docs →</Link>
          </Button>
        </Card>

        <Card className="p-6 border-border/40">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Code2 className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-2xl font-bold">Setup Guide</h2>
          </div>
          <p className="text-muted-foreground mb-4">Step-by-step instructions for setting up VulnRadar for development or deployment.</p>
          <Button asChild variant="outline">
            <Link href="/docs/setup">View Setup →</Link>
          </Button>
        </Card>
      </div>

      <Card className="p-6 border-border/40 bg-card/50">
        <div className="flex items-center gap-3 mb-4">
          <BookOpen className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-bold">Quick Start</h3>
        </div>
        <ol className="space-y-3 text-muted-foreground">
          <li><span className="font-semibold text-foreground">1. Create an Account</span> - Sign up at vulnradar.app to get started</li>
          <li><span className="font-semibold text-foreground">2. Generate API Key</span> - Go to your profile and create an API key</li>
          <li><span className="font-semibold text-foreground">3. Make Your First Scan</span> - Use the API or web UI to scan a website</li>
          <li><span className="font-semibold text-foreground">4. Explore Results</span> - View detailed vulnerability reports with remediation steps</li>
        </ol>
      </Card>
    </div>
  )
}
