import { getCategoryCounts } from "@/lib/scanner/registry";

export function LandingStats() {
  const counts = getCategoryCounts();
  const totalChecks = Object.values(counts).reduce((a, b) => a + b, 0);
  const categoryCount = Object.keys(counts).length;

  return (
    <section className="border-y border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5">
        <p className="text-center text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{totalChecks}</span>{" "}
          checks across{" "}
          <span className="font-medium text-foreground">{categoryCount}</span>{" "}
          categories · median scan under{" "}
          <span className="font-medium text-foreground">3 seconds</span> ·
          open source · GPL-3.0
        </p>
      </div>
    </section>
  );
}
