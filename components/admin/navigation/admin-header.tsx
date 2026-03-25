"use client"

interface AdminHeaderProps {
  title: string
  subtitle: string
}

export function AdminHeader({ title, subtitle }: AdminHeaderProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}
