import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingStats } from "@/components/landing/landing-stats";
import { LandingFeatures } from "@/components/landing/landing-features";
import { LandingSampleFinding } from "@/components/landing/landing-sample-finding";
import { LandingCategories } from "@/components/landing/landing-categories";
import { LandingHowItWorks } from "@/components/landing/landing-how-it-works";
import { LandingApiExample } from "@/components/landing/landing-api-example";
import { LandingUseCases } from "@/components/landing/landing-use-cases";
import { LandingOpenSource } from "@/components/landing/landing-open-source";
import { LandingCta } from "@/components/landing/landing-cta";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background overflow-x-hidden">
      <LandingNav />
      <main className="flex-1 min-w-0">
        <LandingHero />
        <LandingStats />
        <LandingFeatures />
        <LandingSampleFinding />
        <LandingCategories />
        <LandingHowItWorks />
        <LandingApiExample />
        <LandingUseCases />
        <LandingOpenSource />
        <LandingCta />
      </main>
      <Footer />
    </div>
  );
}
