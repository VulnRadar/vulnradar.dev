import { AlertCircle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DashboardErrorStateProps {
  error: string
  onRetry: () => void
}

export function DashboardErrorState({ error, onRetry }: DashboardErrorStateProps) {
  return (
    <div className="flex flex-col items-center gap-5 py-12">
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-destructive/10">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="flex flex-col items-center gap-2 text-center max-w-sm">
        <h2 className="text-base font-semibold text-foreground">Scan Failed</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
      </div>
      <Button variant="outline" onClick={onRetry} className="bg-transparent">
        <RotateCcw className="mr-2 h-4 w-4" />
        <span className="hidden sm:inline">Try Again</span>
      </Button>
    </div>
  )
}
