import Link from "next/link"
import { Share2, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export function SharesEmptyState() {
  return (
    <Card className="flex flex-col items-center gap-6 p-12 text-center border-dashed border-border/50 bg-card/50">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-muted">
        <Share2 className="h-6 w-6 text-muted-foreground/50" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground mb-1">No active shares</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Start sharing scan results from your history to make them available to others.
        </p>
      </div>
      <Link href="/history">
        <Button variant="outline" className="gap-2 bg-transparent">
          <Shield className="h-4 w-4" />
          View History
        </Button>
      </Link>
    </Card>
  )
}
