"use client";

import { cn } from "@/lib/ui/utils";
import { InlineCode } from "./docs-code-block";
import type { EndpointParam } from "./docs-types";

/**
 * Every table on the docs site scrolls inside its own box. A table that
 * widens the page breaks the whole layout at 375px, and the reader loses the
 * navigation as well as the table.
 *
 * The wrapper is focusable so the scroll is reachable without a pointer.
 */
function TableScroller({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-lg border border-border/50",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </div>
  );
}

const headCell =
  "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
// 13px, not 12px. Docs prose is 14px and the tables carry the same kind of
// sentence, so text-xs made the reference material the least readable thing
// on the page. leading-relaxed matters more here than in prose: a description
// cell wraps to three or four lines against a narrow column.
const bodyCell =
  "px-3 py-2.5 align-top text-[13px] leading-relaxed text-muted-foreground";
// The key column. Every docs table is a lookup (a plan, a status, a constant,
// an endpoint, an error code) and the reader scans one column to find their
// row, so that column is a row header, not another muted cell.
const keyCell =
  "px-3 py-2.5 text-left align-top text-[13px] font-medium leading-relaxed text-foreground";
// Reading a wide row means tracking across a 900px table. The hairline rules
// give you the row; the hover tint tells you which one your pointer is on.
const bodyRow = "border-t border-border/50 transition-colors hover:bg-muted/40";

interface Column {
  key: string;
  header: string;
  className?: string;
}

interface DocsTableProps<T extends Record<string, unknown>> {
  columns: Column[];
  data: T[];
  /** Describes the table for screen readers. Not shown. */
  caption?: string;
  className?: string;
}

export function DocsTable<T extends Record<string, unknown>>({
  columns,
  data,
  caption,
  className,
}: DocsTableProps<T>) {
  return (
    <TableScroller className={className}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-muted/40">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(headCell, col.className)}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className={bodyRow}>
              {columns.map((col, colIndex) =>
                colIndex === 0 ? (
                  <th
                    key={col.key}
                    scope="row"
                    className={cn(keyCell, col.className)}
                  >
                    {String(row[col.key] ?? "")}
                  </th>
                ) : (
                  <td key={col.key} className={cn(bodyCell, col.className)}>
                    {String(row[col.key] ?? "")}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

/**
 * Parameter, type, required, default, description. This is the shape people
 * scan an API reference for, and it reads far faster than the same facts in
 * a sentence.
 */
export function ParamTable({
  params,
  caption,
  className,
}: {
  params: EndpointParam[];
  caption?: string;
  className?: string;
}) {
  const showDefault = params.some((p) => p.default !== undefined);

  return (
    <TableScroller className={className}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" className={headCell}>
              Parameter
            </th>
            <th scope="col" className={headCell}>
              Type
            </th>
            <th scope="col" className={headCell}>
              Required
            </th>
            {showDefault && (
              <th scope="col" className={headCell}>
                Default
              </th>
            )}
            <th scope="col" className={cn(headCell, "w-full")}>
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {params.map((param) => (
            <tr key={param.name} className={bodyRow}>
              <th
                scope="row"
                className="px-3 py-2.5 text-left align-top font-normal"
              >
                <InlineCode className="text-[13px]">{param.name}</InlineCode>
              </th>
              <td className={cn(bodyCell, "whitespace-nowrap font-mono")}>
                {param.type}
              </td>
              <td className={cn(bodyCell, "whitespace-nowrap")}>
                {param.required ? (
                  <span className="font-medium text-foreground">Yes</span>
                ) : (
                  "No"
                )}
              </td>
              {showDefault && (
                <td className={cn(bodyCell, "whitespace-nowrap font-mono")}>
                  {param.default ?? "none"}
                </td>
              )}
              <td className={bodyCell}>{param.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

interface EndpointTableRow {
  endpoint: string;
  method: string;
  description: string;
  /**
   * Anchor for the endpoint's full reference further down the page. The
   * index on /docs/api was captioned "with a link to its full reference" and
   * had none: the fastest route from the summary table to the card was to
   * read the path, then scroll thirty cards looking for it again.
   */
  href?: string;
}

export function EndpointTable({
  endpoints,
  caption,
  className,
}: {
  endpoints: EndpointTableRow[];
  caption?: string;
  className?: string;
}) {
  return (
    <TableScroller className={className}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" className={headCell}>
              Method
            </th>
            <th scope="col" className={headCell}>
              Endpoint
            </th>
            <th scope="col" className={cn(headCell, "w-full")}>
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((row, i) => (
            <tr key={i} className={bodyRow}>
              <td
                className={cn(
                  bodyCell,
                  "whitespace-nowrap font-mono font-medium text-foreground",
                )}
              >
                {row.method}
              </td>
              <td className="min-w-0 px-3 py-2.5 align-top">
                {row.href ? (
                  <a
                    href={row.href}
                    className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <InlineCode className="break-all text-primary">
                      {row.endpoint}
                    </InlineCode>
                  </a>
                ) : (
                  <InlineCode className="break-all">{row.endpoint}</InlineCode>
                )}
              </td>
              <td className={bodyCell}>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

interface FieldTableRow {
  field: string;
  type: string;
  description: string;
}

export function FieldTable({
  fields,
  caption,
  className,
}: {
  fields: FieldTableRow[];
  caption?: string;
  className?: string;
}) {
  return (
    <TableScroller className={className}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" className={headCell}>
              Field
            </th>
            <th scope="col" className={headCell}>
              Type
            </th>
            <th scope="col" className={cn(headCell, "w-full")}>
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((row, i) => (
            <tr key={i} className={bodyRow}>
              <th
                scope="row"
                className="px-3 py-2.5 text-left align-top font-normal"
              >
                <InlineCode className="text-[13px]">{row.field}</InlineCode>
              </th>
              <td className={cn(bodyCell, "whitespace-nowrap font-mono")}>
                {row.type}
              </td>
              <td className={bodyCell}>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
