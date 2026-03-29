import { cn } from "@/lib/ui/utils"

interface LegalCalloutProps {
  variant?: "warning" | "danger" | "info"
  title: string
  children: React.ReactNode
}

const variants = {
  warning: {
    border: "border-[hsl(var(--severity-medium))]/30",
    bg: "bg-[hsl(var(--severity-medium))]/5",
    title: "text-[hsl(var(--severity-medium))]",
  },
  danger: {
    border: "border-destructive/30",
    bg: "bg-destructive/5",
    title: "text-destructive",
  },
  info: {
    border: "border-primary/30",
    bg: "bg-primary/5",
    title: "text-primary",
  },
}

export function LegalCallout({ variant = "info", title, children }: LegalCalloutProps) {
  const styles = variants[variant]
  
  return (
    <div className={cn("rounded-xl border-2 p-5", styles.border, styles.bg)}>
      <h3 className={cn("text-base font-semibold mb-2", styles.title)}>{title}</h3>
      <div className="text-sm text-foreground/90 leading-relaxed">
        {children}
      </div>
    </div>
  )
}
