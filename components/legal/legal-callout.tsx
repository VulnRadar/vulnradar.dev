import { cn } from "@/lib/ui/utils";

interface LegalCalloutProps {
  variant?: "warning" | "danger" | "info";
  title: string;
  children: React.ReactNode;
  className?: string;
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
};

export function LegalCallout({
  variant = "info",
  title,
  children,
  className,
}: LegalCalloutProps) {
  const styles = variants[variant];

  return (
    <div
      className={cn(
        "max-w-prose rounded-xl border-2 p-5",
        styles.border,
        styles.bg,
        className,
      )}
    >
      <h3 className={cn("mb-2 text-base font-semibold", styles.title)}>
        {title}
      </h3>
      <div className="text-sm leading-relaxed text-foreground/90">
        {children}
      </div>
    </div>
  );
}
