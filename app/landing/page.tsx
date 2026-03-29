import { Footer } from "@/components/scanner/footer"
import { LandingNav } from "@/components/landing/landing-nav"
import { LandingHero } from "@/components/landing/landing-hero"
import { LandingStats } from "@/components/landing/landing-stats"
import { LandingFeatures } from "@/components/landing/landing-features"
import { LandingHowItWorks } from "@/components/landing/landing-how-it-works"
import { LandingUseCases } from "@/components/landing/landing-use-cases"
import { LandingCta } from "@/components/landing/landing-cta"

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <LandingNav />
      <main className="flex-1">
        <LandingHero />
        <LandingStats />
        <LandingFeatures />
        <LandingHowItWorks />
        <LandingUseCases />
        <LandingCta />
      </main>
      <Footer />
    </div>
  )
}
