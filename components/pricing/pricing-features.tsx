import { Check, Minus } from "lucide-react";

const PLAN_NAMES = ["Free", "Core", "Pro", "Elite"];

const ROWS: { label: string; values: (boolean | string)[] }[] = [
  {
    label: "Scans per day",
    values: ["25", "100", "150", "500"],
  },
  {
    label: "API requests/day",
    values: ["100", "500", "5,000", "Unlimited"],
  },
  {
    label: "Scan history",
    values: ["7 days", "30 days", "90 days", "Unlimited"],
  },
  {
    label: "All 12 scanner modules",
    values: [true, true, true, true],
  },
  {
    label: "API access (Bearer token)",
    values: [true, true, true, true],
  },
  {
    label: "Stable finding IDs",
    values: [true, true, true, true],
  },
  {
    label: "Webhook on scan complete",
    values: [false, false, true, true],
  },
  {
    label: "Bulk URL scanning",
    values: [false, false, true, true],
  },
  {
    label: "Scheduled scans",
    values: [false, false, true, true],
  },
  {
    label: "Team seats",
    values: ["1", "1", "5", "Unlimited"],
  },
  {
    label: "Support",
    values: ["Community", "Email", "Priority", "Dedicated"],
  },
  {
    label: "Self-hostable",
    values: [true, true, true, true],
  },
];

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-primary mx-auto" />
    ) : (
      <Minus className="h-4 w-4 text-muted-foreground/30 mx-auto" />
    );
  }
  return (
    <span
      className={
        value === "Unlimited"
          ? "text-sm font-medium text-primary tabular-nums"
          : "text-sm tabular-nums"
      }
    >
      {value}
    </span>
  );
}

export function PricingFeatures() {
  return (
    <section className="border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="mb-8">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-2">
            What each plan includes
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            All plans run the same detection engine. The difference is how many
            scans you can run per day and how long results are kept.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="text-left px-5 py-3.5 font-medium text-muted-foreground w-[44%]">
                  Feature
                </th>
                {PLAN_NAMES.map((p) => (
                  <th
                    key={p}
                    className="px-4 py-3.5 font-semibold text-center text-foreground"
                  >
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-5 py-3 text-muted-foreground">
                    {row.label}
                  </td>
                  {row.values.map((v, j) => (
                    <td
                      key={j}
                      className="px-4 py-3 text-center text-foreground"
                    >
                      <Cell value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
