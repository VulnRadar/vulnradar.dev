import { CheckCircle, Globe, Shield, BarChart3 } from "lucide-react";

const USE_CASES = [
  {
    icon: Globe,
    title: "Developers",
    desc: "Catch vulnerabilities before they reach production.",
    features: [
      "Quick single-page scans",
      "API & CLI access",
      "Code fix suggestions",
    ],
  },
  {
    icon: Shield,
    title: "Security Teams",
    desc: "Comprehensive visibility across all your applications.",
    features: ["Bulk scanning", "Compliance reports", "Trend analysis"],
  },
  {
    icon: BarChart3,
    title: "DevOps",
    desc: "Automate security in your deployment pipeline.",
    features: [
      "CI/CD integration",
      "Webhook notifications",
      "Scheduled monitoring",
    ],
  },
];

export function LandingUseCases() {
  return (
    <section className="py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10">
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
            Use Cases
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
            Built for teams of all sizes
          </h2>
          <p className="text-muted-foreground">
            From solo developers to enterprise security teams.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {USE_CASES.map((useCase, i) => (
            <div
              key={i}
              className="p-6 rounded-xl border border-border/50 bg-card/50 hover:bg-card hover:border-border/60 transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-5">
                <useCase.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{useCase.title}</h3>
              <p className="text-sm text-muted-foreground mb-5">
                {useCase.desc}
              </p>
              <ul className="space-y-2">
                {useCase.features.map((feature, j) => (
                  <li key={j} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
