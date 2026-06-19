"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { CodeBlock, InlineCode } from "./docs-code-block";
import { type Endpoint, METHOD_COLORS } from "./docs-types";

interface EndpointCardProps extends Endpoint {}

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
}: EndpointCardProps) {
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
        {/* Path Parameters */}
        {pathParams && pathParams.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Path Parameters
            </h4>
            <div className="space-y-2">
              {pathParams.map((param) => (
                <div
                  key={param.name}
                  className="flex items-start gap-3 text-sm"
                >
                  <InlineCode>{param.name}</InlineCode>
                  <span className="text-muted-foreground text-xs">
                    {param.type}
                  </span>
                  <span className="text-muted-foreground text-xs flex-1">
                    {param.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Query Parameters */}
        {queryParams && queryParams.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Query Parameters
            </h4>
            <div className="space-y-2">
              {queryParams.map((param) => (
                <div
                  key={param.name}
                  className="flex items-start gap-3 text-sm"
                >
                  <InlineCode>{param.name}</InlineCode>
                  <span className="text-muted-foreground text-xs">
                    {param.type}
                  </span>
                  {param.required && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      required
                    </Badge>
                  )}
                  <span className="text-muted-foreground text-xs flex-1">
                    {param.description}
                  </span>
                </div>
              ))}
            </div>
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
                <CheckCircle className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
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
