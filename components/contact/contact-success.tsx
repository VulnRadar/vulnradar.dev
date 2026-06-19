import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ContactSuccessProps {
  category: string | null;
  onReset: () => void;
}

export function ContactSuccess({ category, onReset }: ContactSuccessProps) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
        <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">
            Message Received
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
            Thank you for reaching out. {"We'll"} review your{" "}
            {category === "security" ? "security report" : "message"} and get
            back to you as soon as possible.
          </p>
        </div>
        <div className="flex gap-3 mt-2">
          <Button
            variant="outline"
            className="bg-transparent"
            onClick={onReset}
          >
            Send Another
          </Button>
          <Link href="/">
            <Button>Back to Scanner</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
