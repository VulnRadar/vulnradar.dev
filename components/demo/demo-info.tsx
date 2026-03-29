import { Eye, Shield, Zap } from "lucide-react"
import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants"

const INFO_ITEMS = [
  {
    icon: Eye,
    title: "Transparency",
    description: "We run the same checks on ourselves that we run on any site. No special treatment.",
  },
  {
    icon: Shield,
    title: "Eat Our Own Cooking",
    description: "If we find issues on our own site, we fix them. This proves we practice what we preach.",
  },
  {
    icon: Zap,
    title: "Real Results",
    description: `Live scan results, not pre-generated. The same ${TOTAL_CHECKS_LABEL} checks run in real-time.`,
  },
]

export function DemoInfo() {
  return (
    <section className="py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10">
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">Why Self-Scan</p>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
            Transparency you can trust
          </h2>
          <p className="text-muted-foreground max-w-xl">
            We believe in practicing what we preach. Run a scan on our own site to see exactly what we deliver.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {INFO_ITEMS.map((item, i) => (
            <div key={i} className="group p-5 rounded-xl border border-border/50 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-all">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                <item.icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-base font-semibold mb-1.5">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
