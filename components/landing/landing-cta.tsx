import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
import { APP_NAME, BILLING_ENABLED, ROUTES } from "@/lib/constants"

export function LandingCta() {
  return (
    <section className="border-t border-border/50 bg-muted/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 tracking-tight">
            Ready to secure your applications?
          </h2>
          <p className="text-muted-foreground mb-8">
            Join thousands of developers shipping secure code with {APP_NAME}.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href={ROUTES.SIGNUP}>
              <Button size="lg" className="h-11 px-6 gap-2">
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            {BILLING_ENABLED && (
              <Link href={ROUTES.PRICING}>
                <Button size="lg" variant="outline" className="h-11 px-6">
                  View Pricing
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
