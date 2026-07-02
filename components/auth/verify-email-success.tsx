"use client";

interface VerifyEmailSuccessProps {
  message: string;
}

export function VerifyEmailSuccess({ message }: VerifyEmailSuccessProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-emerald-500">
          Verified.
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">{message}</p>
      </div>
      <p className="text-xs text-muted-foreground/60">
        Redirecting to dashboard...
      </p>
    </div>
  );
}
