'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import { ROUTES } from '@/lib/config/constants'

export function DemoCTA() {
  return (
    <section className="mt-16 -mx-4 px-4 py-12 border-t border-border bg-muted/30">
      <div className="text-center max-w-xl mx-auto">
        <h2 className="text-2xl font-bold mb-3 tracking-tight">Ready for more?</h2>
        <p className="text-muted-foreground mb-6">
          Create a free account to scan your own sites, track history, and access the full API.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href={ROUTES.SIGNUP}>
            <Button size="lg" className="gap-2 shadow-lg shadow-primary/25">
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href={ROUTES.PRICING}>
            <Button size="lg" variant="outline">
              View Pricing
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
