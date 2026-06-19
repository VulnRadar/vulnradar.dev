"use client";

import { cn } from "@/lib/ui/utils";
import { InlineCode } from "./docs-code-block";

interface Column {
  key: string;
  header: string;
  className?: string;
}

interface DocsTableProps<T extends Record<string, unknown>> {
  columns: Column[];
  data: T[];
  className?: string;
}

export function DocsTable<T extends Record<string, unknown>>({
  columns,
  data,
  className,
}: DocsTableProps<T>) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "text-left py-2 font-semibold text-xs",
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-muted-foreground">
          {data.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn("py-2.5 text-xs", col.className)}
                >
                  {String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface EndpointTableRow {
  endpoint: string;
  method: string;
  description: string;
}

interface EndpointTableProps {
  endpoints: EndpointTableRow[];
  className?: string;
}

export function EndpointTable({ endpoints, className }: EndpointTableProps) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 font-semibold text-xs">Endpoint</th>
            <th className="text-left py-2 font-semibold text-xs">Method</th>
            <th className="text-left py-2 font-semibold text-xs">
              Description
            </th>
          </tr>
        </thead>
        <tbody className="text-muted-foreground">
          {endpoints.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              <td className="py-2.5">
                <InlineCode>{row.endpoint}</InlineCode>
              </td>
              <td className="py-2.5 text-xs">{row.method}</td>
              <td className="py-2.5 text-xs">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface FieldTableRow {
  field: string;
  type: string;
  description: string;
}

interface FieldTableProps {
  fields: FieldTableRow[];
  className?: string;
}

export function FieldTable({ fields, className }: FieldTableProps) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 font-semibold text-xs">Field</th>
            <th className="text-left py-2 font-semibold text-xs">Type</th>
            <th className="text-left py-2 font-semibold text-xs">
              Description
            </th>
          </tr>
        </thead>
        <tbody className="text-muted-foreground">
          {fields.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              <td className="py-2.5">
                <InlineCode>{row.field}</InlineCode>
              </td>
              <td className="py-2.5 text-xs">{row.type}</td>
              <td className="py-2.5 text-xs">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
