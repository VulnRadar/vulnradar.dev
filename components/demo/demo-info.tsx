'use client'

import { TOTAL_CHECKS_LABEL } from '@/lib/config/constants'

export function DemoInfo() {
  return (
    <section className="mt-16 pt-12 border-t border-border">
      <h3 className="text-lg font-semibold text-center mb-6">Why run a self-scan?</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            title: 'Transparency',
            description:
              'We run the same checks on ourselves that we run on any site. No special treatment.',
          },
          {
            title: 'Eat Our Own Cooking',
            description:
              'If we find issues on our own site, we fix them. This proves we practice what we preach.',
          },
          {
            title: 'Real Results',
            description: `Live scan results, not pre-generated. The same ${TOTAL_CHECKS_LABEL} checks run in real-time.`,
          },
        ].map((item, i) => (
          <div
            key={i}
            className="p-6 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors"
          >
            <h4 className="font-semibold mb-2 text-primary">{item.title}</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
