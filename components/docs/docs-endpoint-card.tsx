"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";
import { ROUTES } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { CodeBlock } from "./docs-code-block";
import { DOCS_ANCHOR_OFFSET } from "./docs-prose";
import { ParamTable } from "./docs-table";
import { DocsTabs } from "./docs-tabs";
import {
  type Endpoint,
  type EndpointNote,
  METHOD_COLORS,
  STATUS_TEXT,
} from "./docs-types";

/** Past five notes a card is an essay; the page's prose is the place for it. */
export const MAX_ENDPOINT_NOTES = 5;

const blockLabel = "mb-3 text-sm font-semibold text-foreground";
/** A code block sitting inside the card is a nested panel, so it takes the quiet tone. */
const nestedCode = "border-border/50 bg-card/50";

/**
 * The cap is on the new shape only. Cards still using plain strings carry up
 * to fourteen today, and capping those here would silently delete reference
 * material before anyone had moved it somewhere else.
 */
function normalizeNotes(notes: Endpoint["notes"] = []): EndpointNote[] {
  const legacy = notes.flatMap((note): EndpointNote[] =>
    typeof note === "string" ? [{ tone: "info", body: note }] : [],
  );
  const structured = notes
    .filter((note): note is EndpointNote => typeof note !== "string")
    .slice(0, MAX_ENDPOINT_NOTES);
  return [...legacy, ...structured];
}

export function EndpointCard({
  id,
  method,
  path,
  title,
  description,
  requestBody,
  responseExample,
  successStatus = 200,
  bodyParams,
  queryParams,
  pathParams,
  errors,
  notes,
  auth,
  tryIt,
}: Endpoint) {
  const status = `${successStatus} ${STATUS_TEXT[successStatus] ?? ""}`.trim();
  const allNotes = normalizeNotes(notes);
  const listNotes = allNotes.filter((note) => note.tone !== "warning");
  const warnings = allNotes.filter((note) => note.tone === "warning");

  const response = responseExample ? (
    <CodeBlock code={responseExample} title={status} className={nestedCode} />
  ) : (
    <p className="text-sm text-muted-foreground">{status}, with no body.</p>
  );

  return (
    // No hover treatment. The card used to lighten its border on hover,
    // which promises a click on a reference block that does not navigate
    // anywhere.
    <div
      id={id}
      className={cn(
        "rounded-xl border border-border bg-card p-4 sm:p-6",
        DOCS_ANCHOR_OFFSET,
      )}
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
        {tryIt && (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-11 w-full sm:ml-auto sm:h-8 sm:w-auto"
          >
            <Link
              href={`${ROUTES.API_PLAYGROUND}?op=${encodeURIComponent(tryIt)}`}
            >
              Try it
            </Link>
          </Button>
        )}
      </div>

      {/* The human name for the endpoint. At text-sm font-medium it was set
          smaller than the paragraph under it, so the one line telling you
          what the endpoint is for was the quietest thing in the card. */}
      <h3 className="mb-2 text-base font-semibold tracking-tight text-foreground">
        {title}
      </h3>

      <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>

      {auth && (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Auth: {auth}
        </p>
      )}

      {/* Blocks stacked with equal air between them read as one list rather
          than as request, response and errors. A hairline between the blocks
          says where each one ends. */}
      <div className="mt-5 divide-y divide-border/40 [&>div]:py-5 [&>div:first-child]:pt-0 [&>div:last-child]:pb-0 sm:mt-6">
        {pathParams && pathParams.length > 0 && (
          <div>
            <h4 className={blockLabel}>Path parameters</h4>
            <ParamTable
              params={pathParams}
              caption={`Path parameters for ${method} ${path}`}
            />
          </div>
        )}

        {queryParams && queryParams.length > 0 && (
          <div>
            <h4 className={blockLabel}>Query parameters</h4>
            <ParamTable
              params={queryParams}
              caption={`Query parameters for ${method} ${path}`}
            />
          </div>
        )}

        {bodyParams && bodyParams.length > 0 && (
          <div>
            <h4 className={blockLabel}>Request body</h4>
            <ParamTable
              params={bodyParams}
              caption={`Request body fields for ${method} ${path}`}
            />
          </div>
        )}

        {/* Request and response are tabs so the card is one code block tall
            instead of two, which on a phone was two screens per endpoint. */}
        <div>
          {requestBody ? (
            <DocsTabs
              label={`Examples for ${method} ${path}`}
              tabs={[
                {
                  id: "request",
                  label: "Request",
                  content: (
                    <CodeBlock code={requestBody} className={nestedCode} />
                  ),
                },
                {
                  id: "response",
                  label: `Response ${successStatus}`,
                  content: response,
                },
              ]}
            />
          ) : (
            <>
              <h4 className={blockLabel}>Response</h4>
              {response}
            </>
          )}
        </div>

        {warnings.length > 0 && (
          <div className="space-y-3">
            {warnings.map((note, i) => (
              <Callout key={i} variant="warning">
                {note.body}
              </Callout>
            ))}
          </div>
        )}

        {listNotes.length > 0 && (
          <div>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              {listNotes.map((note, i) => (
                <li key={i} className="min-w-0 wrap-break-word">
                  {note.body}
                </li>
              ))}
            </ul>
          </div>
        )}

        {errors && errors.length > 0 && (
          <div>
            <h4 className={blockLabel}>Error responses</h4>
            <div className="space-y-2">
              {errors.map((error) => (
                <div
                  key={error.code}
                  className="flex items-start gap-3 text-sm"
                >
                  <Badge variant="outline" className="text-xs font-mono">
                    {error.code}
                  </Badge>
                  <span className="min-w-0 wrap-break-word text-muted-foreground text-xs">
                    {error.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
