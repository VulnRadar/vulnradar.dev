"use client";

import { isValidElement } from "react";
import { cn } from "@/lib/ui/utils";
import { InlineCode } from "./docs-code-block";
import type { EndpointParam } from "./docs-types";

/**
 * From sm up a table scrolls inside its own box. A table that widens the page
 * breaks the whole layout at 375px, and the reader loses the navigation as
 * well as the table. Below sm the same rows are stacked definition blocks
 * instead (StackedRows), because a scroller there hid the description column
 * off-screen on eight of ten pages.
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
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container has to take focus to be scrolled from the keyboard
      tabIndex={0}
      className={cn(
        "relative hidden overflow-x-auto rounded-lg border border-border/50 sm:block",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The phone layout of a table: one block per row, divided by hairlines. */
function StackedRows({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border/50 rounded-lg border border-border/50 sm:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

const stackedRow = "space-y-1.5 px-3 py-3";
const stackedText = "text-[13px] leading-relaxed text-muted-foreground";
const stackedMono = "font-mono text-[11px] text-muted-foreground";

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
  "px-3 py-2.5 text-left align-top text-[13px] font-medium leading-relaxed text-foreground wrap-anywhere";
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

/**
 * Columns that describe the key rather than add to it, so on a phone they sit
 * on one mono line under the key instead of taking a row each: on the settings
 * registry, Tier and Type on every one of ~280 rows.
 */
const STACKED_META_COLUMNS = new Set(["tier", "type"]);

export function DocsTable<T extends Record<string, unknown>>({
  columns,
  data,
  caption,
  className,
}: DocsTableProps<T>) {
  const [keyColumn, ...rest] = columns;
  const meta = rest.filter((col) => STACKED_META_COLUMNS.has(col.key));
  const details = rest.filter((col) => !STACKED_META_COLUMNS.has(col.key));
  const text = (row: T, col: Column) => String(row[col.key] ?? "");
  // A prose cell can hold a link; everything else is a value to print.
  const cell = (row: T, col: Column): React.ReactNode => {
    const value = row[col.key];
    return isValidElement(value) ? value : text(row, col);
  };

  return (
    <>
      <StackedRows className={className}>
        {data.map((row, i) => (
          <div key={i} className={stackedRow}>
            <div
              className={cn(
                "text-[13px] font-medium leading-relaxed text-foreground wrap-anywhere",
                keyColumn.className,
                // A column's nowrap and width are for the table; here they
                // would push a long key past the edge of the phone.
                "w-auto whitespace-normal",
              )}
            >
              {cell(row, keyColumn)}
            </div>
            {meta.length > 0 && (
              <div className={stackedMono}>
                {meta.map((col) => text(row, col)).join(", ")}
              </div>
            )}
            <dl className="space-y-1.5">
              {details.map((col) => (
                <div key={col.key}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {col.header}
                  </dt>
                  <dd className={cn(stackedText, "wrap-anywhere")}>
                    {cell(row, col)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </StackedRows>
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
                      {cell(row, col)}
                    </th>
                  ) : (
                    <td key={col.key} className={cn(bodyCell, col.className)}>
                      {cell(row, col)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </>
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
    <>
      <StackedRows className={className}>
        <dl className="divide-y divide-border/50">
          {params.map((param) => (
            <div key={param.name} className={stackedRow}>
              <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <InlineCode className="wrap-anywhere text-[13px]">
                  {param.name}
                </InlineCode>
                <span className={stackedMono}>{param.type}</span>
                {param.required && (
                  <span className="rounded-full border border-border px-1.5 text-[11px] font-medium text-foreground">
                    required
                  </span>
                )}
              </dt>
              {param.default !== undefined && (
                <dd className={stackedMono}>Default: {param.default}</dd>
              )}
              <dd className={stackedText}>{param.description}</dd>
            </div>
          ))}
        </dl>
      </StackedRows>
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
                  <InlineCode className="wrap-anywhere text-[13px]">
                    {param.name}
                  </InlineCode>
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
    </>
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
    <TableScroller className={cn("block", className)}>
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
    <>
      <StackedRows className={className}>
        <dl className="divide-y divide-border/50">
          {fields.map((row, i) => (
            <div key={i} className={stackedRow}>
              <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <InlineCode className="wrap-anywhere text-[13px]">
                  {row.field}
                </InlineCode>
                <span className={stackedMono}>{row.type}</span>
              </dt>
              <dd className={stackedText}>{row.description}</dd>
            </div>
          ))}
        </dl>
      </StackedRows>
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
                  <InlineCode className="wrap-anywhere text-[13px]">
                    {row.field}
                  </InlineCode>
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
    </>
  );
}
