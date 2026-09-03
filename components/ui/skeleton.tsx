import { cn } from "@/lib/ui/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // motion-reduce: a pulsing block is exactly the kind of repeated
        // motion WCAG 2.3.3 asks to drop, and a skeleton grid of them fills
        // the screen. The placeholder still reads as a placeholder when still.
        "animate-pulse motion-reduce:animate-none rounded-md bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
