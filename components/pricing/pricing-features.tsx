import { Shield, Zap, Clock, Globe, Lock, Users, LucideIcon } from "lucide-react"

interface Feature {
  icon: LucideIcon
  title: string
  description: string
}

const FEATURES: Feature[] = [
  { icon: Shield, title: "Comprehensive Scanning", description: "Detect vulnerabilities, misconfigurations, and security issues across your entire web application." },
  { icon: Zap, title: "Instant Results", description: "Get detailed security reports in seconds. No waiting, no queues, just fast and reliable scanning." },
  { icon: Clock, title: "Scheduled Scans", description: "Set up automated scans to run on your schedule. Stay on top of security without manual effort." },
  { icon: Globe, title: "API Access", description: "Integrate security scanning into your CI/CD pipeline with our powerful REST API." },
  { icon: Lock, title: "SSL/TLS Analysis", description: "Deep analysis of your SSL/TLS configuration, certificate validity, and cipher suites." },
  { icon: Users, title: "Team Collaboration", description: "Share scan results, collaborate on fixes, and track security improvements together." },
]

export function PricingFeatures() {
  return (
    <section className="border-y border-border/50 bg-muted/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-12">
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">Features</p>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
            Everything you need for web security
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            All plans include our core security scanning features.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="flex gap-4 p-5 rounded-xl border border-border/50 bg-card/30 hover:bg-card/50 transition-colors">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1 text-sm">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
