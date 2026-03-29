import { Scale, FileText, Shield, AlertTriangle, Accessibility, Copyright } from "lucide-react"

const iconMap = {
  terms: Scale,
  privacy: Shield,
  disclaimer: AlertTriangle,
  "acceptable-use": FileText,
  accessibility: Accessibility,
  dmca: Copyright,
}

interface LegalPageHeaderProps {
  title: string
  lastUpdated: string
  type?: keyof typeof iconMap
}

export function LegalPageHeader({ title, lastUpdated, type = "terms" }: LegalPageHeaderProps) {
  const Icon = iconMap[type] || Scale
  
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      <p className="text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
    </div>
  )
}
