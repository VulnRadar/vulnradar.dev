import { Zap, Eye, Code, Users, Cpu, Lock } from "lucide-react";

const FEATURES = [
  {
    icon: Zap,
    title: "Lightning Fast",
    desc: "Complete security scans in under 3 seconds with our optimized engine.",
  },
  {
    icon: Eye,
    title: "Deep Analysis",
    desc: "Detect XSS, SQL injection, CSRF, misconfigurations, and 50+ vulnerability types.",
  },
  {
    icon: Code,
    title: "Developer First",
    desc: "API access, CI/CD integration, and webhooks for seamless automation.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    desc: "Invite members, assign issues, and track remediation together.",
  },
  {
    icon: Cpu,
    title: "Scheduled Scans",
    desc: "Automated monitoring with instant notifications for new vulnerabilities.",
  },
  {
    icon: Lock,
    title: "Privacy Focused",
    desc: "Your data stays yours. We never store sensitive scan information.",
  },
];

export function LandingFeatures() {
  return (
    <section className="py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10">
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
            Features
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
            Everything you need to ship secure
          </h2>
          <p className="text-muted-foreground max-w-xl">
            A complete toolkit for identifying, understanding, and fixing
            security vulnerabilities.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 min-w-0">
          {FEATURES.map((feature, i) => (
            <div
              key={i}
              className="group p-4 sm:p-5 rounded-xl border border-border/50 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                <feature.icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-base font-semibold mb-1.5">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed break-words">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
