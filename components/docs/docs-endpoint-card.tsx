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
    <Card
      id={id}
      className="p-4 sm:p-6 border-border/50 bg-card/50 scroll-mt-24 transition-all duration-200 hover:border-primary/30"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
        <Badge
          className={cn(
            "font-mono text-[10px] sm:text-xs border px-2 py-0.5",
            METHOD_COLORS[method],
          )}
        >
          {method}
        </Badge>
        <code className="text-primary font-mono text-xs sm:text-sm break-all bg-primary/5 px-2 py-0.5 rounded">
          {path}
        </code>
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-foreground mb-2">{title}</h3>

      {/* Description */}
      <p className="text-muted-foreground text-sm mb-4 sm:mb-6 leading-relaxed">
        {description}
      </p>

      <div className="space-y-6">
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
