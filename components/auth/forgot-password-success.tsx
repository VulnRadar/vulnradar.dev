import Link from "next/link"
import { Mail, ArrowLeft } from "lucide-react"

export function ForgotPasswordSuccess() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-muted/50">
        <div className="p-1.5 rounded-md bg-primary/10 shrink-0">
          <Mail className="h-4 w-4 text-primary" />
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Be sure to check your spam folder if you {"don't"} see the email within a few minutes.
        </p>
      </div>

      <Link
        href="/login"
        className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to login
      </Link>
    </div>
  )
}
