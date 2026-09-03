"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { CodeBlock } from "./docs-code-block";
import { ParamTable } from "./docs-table";
import { type Endpoint, METHOD_COLORS } from "./docs-types";

export function EndpointCard({
  id,
  method,
  path,
  title,
  description,
  requestBody,
  responseExample,
  queryParams,
  pathParams,
  errors,
  notes,
}: Endpoint) {
  return (
    // No hover treatment. The card used to lighten its border on hover,
    // which promises a click on a reference block that does not navigate
    // anywhere.
    <Card
      id={id}
      className="p-4 sm:p-6 border-border/50 bg-card/50 scroll-mt-24"
    >
      {/* The method and path are the endpoint's identity, so they lead and
          they are the largest thing in the card. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
        <Badge
          className={cn(
            "font-mono text-[10px] sm:text-xs border px-2 py-0.5",
            METHOD_COLORS[method],
          )}
        >
          {method}
        </Badge>
        <code className="rounded bg-primary/5 px-2 py-0.5 font-mono text-[13px] sm:text-sm break-all text-primary">
          {path}
        </code>
      </div>

      {/* The human name for the endpoint. At text-sm font-medium it was set
          smaller than the paragraph under it, so the one line telling you
          what the endpoint is for was the quietest thing in the card. */}
      <h3 className="mb-2 text-base font-semibold tracking-tight text-foreground">
        {title}
      </h3>

      <p className="mb-5 sm:mb-6 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>

      {/* Five uppercase labels stacked with equal air between them read as
          one list of five things rather than as request, response and
          errors. A hairline between the blocks says where each one ends. */}
      <div className="divide-y divide-border/40 [&>div]:py-5 [&>div:first-child]:pt-0 [&>div:last-child]:pb-0">
        {/* Path and query parameters. These used to be hand-written flex rows
            here while components/docs/docs-table.tsx exported a purpose-built
            ParamTable that took this exact EndpointParam[] and no page ever
            rendered. Two rendering paths for the same data meant a styling or
            accessibility fix applied to the table never reached /docs/api, and
            the hand-rolled version dropped the default column entirely. */}
        {pathParams && pathParams.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Path Parameters
            </h4>
            <ParamTable
              params={pathParams}
              caption={`Path parameters for ${method} ${path}`}
            />
          </div>
        )}

        {queryParams && queryParams.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Query Parameters
            </h4>
            <ParamTable
              params={queryParams}
              caption={`Query parameters for ${method} ${path}`}
            />
          </div>
        )}

        {/* Request Body */}
        {requestBody && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Request Body
            </h4>
            <CodeBlock code={requestBody} />
          </div>
        )}

        {/* Response */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Response{" "}
            <Badge variant="outline" className="ml-2 text-[10px]">
              200 OK
            </Badge>
          </h4>
          <CodeBlock code={responseExample} />
        </div>

        {/* Notes */}
        {notes && notes.length > 0 && (
          <div className="space-y-2">
            {notes.map((note, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs text-muted-foreground"
              >
                <CheckCircle className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        )}

        {/* Errors */}
        {errors && errors.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Error Responses
            </h4>
            <div className="space-y-2">
              {errors.map((error) => (
                <div
                  key={error.code}
                  className="flex items-start gap-3 text-sm"
                >
                  <Badge variant="outline" className="text-xs font-mono">
                    {error.code}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {error.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
