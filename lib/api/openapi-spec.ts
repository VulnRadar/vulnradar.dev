import {
  APP_NAME,
  APP_VERSION,
  AUTH_SESSION_COOKIE_NAME,
} from "@/lib/config/constants";

/**
 * A machine-readable OpenAPI 3.1 description of the core public v3 API: the
 * scan lifecycle, history reads, and report export. Served at
 * /api/v3/openapi.json (see the route) so it can be imported into Postman /
 * Insomnia / Bruno, rendered by an interactive explorer, and dogfooded by the
 * planned spec-import scanning feature.
 *
 * This is a hand-maintained subset focused on what an integrator actually
 * calls, not every internal endpoint. Keep it in step with app/docs/api when
 * an endpoint's shape changes. `baseUrl` is whatever origin this build was
 * compiled with; see the note on `servers` for why it is not the first entry.
 */
export function buildOpenApiSpec(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: `${APP_NAME} API`,
      version: APP_VERSION,
      description:
        "Run vulnerability scans and read their results over HTTP. The same engine as the web app. Authenticate with a Bearer API key (Settings > API Keys).",
      license: { name: "GPL-3.0" },
    },
    // servers[0] is deliberately a relative reference. OpenAPI 3.1 resolves a
    // relative server URL against the location the document is served from, so
    // this makes every consumer target the instance it fetched the spec from.
    // The absolute form cannot do that: NEXT_PUBLIC_APP_URL is inlined by Next
    // at build time and the published container image is built without it, so
    // the compiled APP_URL on any self-hosted deployment is the public SaaS
    // host. Everything that reads servers[0] (the docs playground, a generated
    // client) therefore used to send a self-hoster's own requests, API key
    // included, to vulnradar.dev, where they failed CORS. The compiled origin
    // stays as a second entry for the rare client that cannot resolve a
    // relative server. ref: AUDIT-014#apidoc-03
    servers: [
      {
        url: "/api/v3",
        description: "This deployment, relative to where this spec is served",
      },
      {
        url: `${baseUrl}/api/v3`,
        description: "The absolute origin this build was compiled with",
      },
    ],
    security: [{ apiKey: [] }],
    tags: [
      { name: "Scans", description: "Start scans and poll their results." },
      { name: "History", description: "Read past scans and export reports." },
      {
        name: "Remediation",
        description: "Track per-finding remediation status.",
      },
      {
        name: "API Keys",
        description: "Manage the account's API keys. Session cookie auth.",
      },
      {
        name: "Domains",
        description:
          "Add and verify domains that unlock active-probe scans. Session cookie auth.",
      },
      {
        name: "Schedules",
        description: "Recurring scheduled scans. Session cookie auth.",
      },
      {
        name: "Teams",
        description: "Teams the account belongs to. Session cookie auth.",
      },
      {
        name: "Webhooks",
        description:
          "Outbound webhooks fired on scan completion, their signing secret, and their delivery log. Session cookie auth.",
      },
      {
        name: "Browser",
        description:
          "Ephemeral remote browser sessions for manual inspection. Session cookie auth.",
      },
      {
        name: "System",
        description: "Unauthenticated service and catalogue endpoints.",
      },
    ],
    paths: {
      "/scan": {
        post: {
          tags: ["Scans"],
          summary: "Create a scan",
          description:
            "Start a background scan against a target. Returns a scan id immediately; poll GET /scan/status/{id} for the result.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScanRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Scan job created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanCreated" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description:
                "active-probes requested against a domain you have not verified (DOMAIN_NOT_VERIFIED)",
            },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/scan/crawl": {
        post: {
          tags: ["Scans"],
          summary: "Create a crawl scan",
          description:
            "Crawl and scan up to 15 pages of a site instead of a single URL. Otherwise identical to POST /scan.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScanRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Crawl job created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanCreated" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/scan/status/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Scan id returned by POST /scan.",
          },
        ],
        get: {
          tags: ["Scans"],
          summary: "Get scan status and result",
          description:
            "Poll a scan job. Returns live progress while running and the full result once status is completed.",
          security: [{ apiKey: ["scan:read"] }],
          responses: {
            "200": {
              description: "Current status (plus result when completed)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanStatus" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Scans"],
          summary: "Cancel a scan",
          description: "Cancel a scan that is still pending or running.",
          security: [{ apiKey: ["scan:write"] }],
          responses: {
            "200": { description: "Scan marked failed with cancelled: true" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": {
              description: "The scan already reached a terminal state",
            },
          },
        },
      },
      "/history": {
        get: {
          tags: ["History"],
          summary: "List scan history",
          description:
            "The caller's own past scans, most recent first. Paginated: `limit` and `offset` are both optional and default to the first page at the deployment's maximum page size, which is what this returned before paging existed. Compare `offset + scans.length` with `total`, or just read `truncated`, to know whether to ask for another page.",
          security: [{ apiKey: ["scan:read"] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 },
              description:
                "Rows to return. Clamped to the deployment's maximum page size (reported back as `maxLimit`), which is 100 by default.",
            },
            {
              name: "offset",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 0, default: 0 },
              description: "Rows to skip. Use it to walk past the first page.",
            },
          ],
          responses: {
            "200": {
              description: "A page of past scans",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HistoryPage" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
        delete: {
          tags: ["History"],
          summary: "Clear all scan history",
          description:
            "Delete every one of the caller's own past scans and their tags. Deliberately unbounded: it removes the whole account's history, not just the page GET returns. Not reversible.",
          security: [{ apiKey: ["scan:delete"] }],
          responses: {
            "200": { description: "The number of scans deleted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "The API key is missing the scan:delete scope",
            },
          },
        },
      },
      "/history/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        get: {
          tags: ["History"],
          summary: "Get one scan",
          description: "A single past scan's full result.",
          security: [{ apiKey: ["scan:read"] }],
          responses: {
            "200": { description: "The scan result" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        patch: {
          tags: ["History"],
          summary: "Update a scan's notes, visibility, or teams",
          description:
            "Edit one past scan. Send only the fields you want to change: an absent field is left alone, and a body with none of them is a 400. Turning isPublic off revokes any existing share link. A scan can be shared with several teams at once: send `teamIds` as the complete set you want it shared with.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScanUpdateRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "The updated notes, visibility, and teams",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanUpdateResult" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "The API key is missing the scan:write scope",
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["History"],
          summary: "Delete one scan",
          description:
            "Permanently remove a single past scan. Owner only. Not reversible.",
          security: [{ apiKey: ["scan:delete"] }],
          responses: {
            "200": { description: "The scan was deleted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "The API key is missing the scan:delete scope",
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/history/{id}/report": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
          {
            name: "format",
            in: "query",
            // Optional, not required: the route reads
            // `searchParams.get("format") || "json"`, and its FORMATS list
            // also accepts `markdown` as an alias for `md`. Marking it
            // required made every generated client demand an argument the API
            // defaults for you, and the short enum made a spec-driven
            // validator reject a legal `format=markdown` request.
            // ref: AUDIT-014#apidoc-30
            required: false,
            schema: {
              type: "string",
              enum: ["json", "sarif", "pdf", "md", "markdown", "compliance"],
              default: "json",
            },
            description:
              "The report format to render. Defaults to json when omitted. `markdown` is an alias for `md`.",
          },
        ],
        get: {
          tags: ["History"],
          summary: "Export a scan report",
          description:
            "Render one scan as SARIF, PDF, Markdown, a compliance summary, or raw JSON. Owner or team-read access.",
          security: [{ apiKey: ["scan:read"] }],
          responses: {
            "200": {
              description: "The rendered report in the requested format",
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/history/{id}/summary": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
          {
            name: "regenerate",
            in: "query",
            required: false,
            schema: { type: "boolean", default: false },
            description:
              "Force a fresh AI call and overwrite the cached summary.",
          },
        ],
        post: {
          tags: ["History"],
          summary: "Generate an AI scan summary",
          description:
            "Summarise a completed scan you own in plain English and persist it onto the scan. Once a summary exists a plain call returns the cached one, with no AI call and no rate-limit cost; pass regenerate=true to replace it. Owner only. Unmetered against the AI token quota but still rate-limited per account.",
          security: [{ apiKey: ["scan:write"] }],
          responses: {
            "200": {
              description: "The summary text, and whether it was cached",
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description:
                "AI is disabled in your settings, or the key is missing scan:write",
            },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/RateLimited" },
            "502": {
              description: "The AI provider returned nothing usable",
            },
          },
        },
      },
      "/scan/authenticated": {
        post: {
          tags: ["Scans"],
          summary: "Scan a page behind a login",
          description:
            "Scan one page after logging in. Credentials live in memory for the duration of this call and are never written to a table, a log line, or an audit record. Unlike POST /scan this is synchronous, so there is nothing to poll, and it scans exactly one page rather than crawling. isPublic defaults to false here whatever the account's default is.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthenticatedScanRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "The completed scan result plus an authReport",
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description:
                "Authenticated scanning is disabled on this deployment, or the target is not scannable",
            },
            "422": {
              description:
                "Login failed or could not be confirmed; see authReport.reason",
            },
            "429": { $ref: "#/components/responses/RateLimited" },
            "502": {
              description:
                "Login succeeded but the target could not be reached afterward",
            },
          },
        },
      },
      "/scan/crawl/discover": {
        post: {
          tags: ["Scans"],
          summary: "Discover URLs without scanning them",
          description:
            "List the links a crawl would cover, same-origin only, without scanning any of them. Does NOT consume a daily scan unit: discovery reads pages, it does not scan them. Rate-limited per user in its own bucket, separate from POST /scan.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CrawlDiscoverRequest" },
              },
            },
          },
          responses: {
            "200": {
              description:
                "The discovered URLs. The body is exactly { urls }: there is no total, read urls.length.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CrawlDiscoverResult" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "The API key is missing the scan:write scope",
            },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/scan/discover/progress/{requestId}": {
        parameters: [
          {
            name: "requestId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description:
              "The same requestId you passed in the POST /scan/discover body.",
          },
        ],
        get: {
          tags: ["Scans"],
          summary: "Read discovery progress",
          description:
            "Peek at an in-flight POST /scan/discover while it is still open. Read-only: it never changes the POST's behaviour, and the POST's own response stays the source of truth. An unknown requestId reports stage `queued` rather than 404, so a poll that starts early is indistinguishable from a typo. Progress lives in process memory and is dropped two minutes after the last update, so behind a load balancer a poll can land on an instance that never saw the POST.",
          security: [{ apiKey: ["scan:read"] }],
          responses: {
            "200": {
              description: "The current stage",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DiscoveryProgress" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "The API key is missing the scan:read scope",
            },
          },
        },
      },
      "/scan/reputation": {
        get: {
          tags: ["Scans"],
          summary: "Look up a host's reputation",
          description:
            "Has anyone ever scanned this host, and what did the latest scan find. Reads a host-keyed cache with no owner, so it answers for the host regardless of who scanned it. Pass `url` as well as `host` to get an exact-page match where one exists; without it you get the host-level fallback, whose scannedUrl is deliberately null so another user's scanned URL is never echoed back.",
          security: [{ apiKey: ["scan:read"] }],
          parameters: [
            {
              name: "host",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The hostname to look up.",
            },
            {
              name: "url",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "A full URL on that host. When a scan of this exact page exists it is preferred over the host-level answer and matchType is `exact`.",
            },
          ],
          responses: {
            "200": {
              description:
                "The reputation record, or known: false when the host has never been scanned",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReputationResult" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "The API key is missing the scan:read scope",
            },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/scan/verify-batch": {
        post: {
          tags: ["Scans"],
          summary: "AI-verify a findings array",
          description:
            "Run the per-finding AI verification pipeline over an array you supply, without it having to belong to a stored scan. Nothing is persisted: the response is your array enriched in place. Shares one rate-limit bucket with POST /scan/verify, so calling both does not double your effective quota. Long-running, so set a generous client timeout.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VerifyBatchRequest" },
              },
            },
          },
          responses: {
            "200": {
              description:
                "The same findings with aiVerdict / aiConfidence / aiReason applied",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/VerifyResult" },
                },
              },
            },
            "400": {
              description:
                "Missing url or findings[], or more findings than the deployment's batch cap",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description:
                "AI is disabled in your settings, or the key is missing scan:write",
            },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/scan/bulk": {
        post: {
          tags: ["Scans"],
          summary: "Bulk scan",
          description:
            "Queue a full single-page scan for several URLs in one request, up to your plan's per-request cap (absolute ceiling 100). Each URL counts as one daily scan. Returns immediately with one scan id per accepted URL; the scans then run one at a time in the background. Poll GET /scan/status/{id} for each id, the same way POST /scan works.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BulkScanRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Per-URL admission result for the whole batch",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BulkScanResult" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "Bulk scanning is disabled on this deployment",
            },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/scan/discover": {
        post: {
          tags: ["Scans"],
          summary: "Discover subdomains",
          description:
            "Enumerate subdomains for a domain from passive sources plus a prefix DNS brute-force. Results are cached per domain for 24 hours. Scan-triggering work, so it needs the scan:write scope.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DiscoverRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Discovered subdomains for the root domain",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DiscoverResult" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/scan/verify": {
        post: {
          tags: ["Scans"],
          summary: "AI-verify a scan's findings",
          description:
            "Re-run every finding on a scan you own through AI verification and persist aiVerdict, aiConfidence, and aiReason back onto the scan. Owner only. Bounded by the account's AI quota unless a BYOK key is configured.",
          security: [{ apiKey: ["scan:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VerifyRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "The scan's findings with AI verdicts applied",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/VerifyResult" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description:
                "AI is disabled in your settings, or the key is missing scan:write",
            },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/scan/remediation": {
        post: {
          tags: ["Remediation"],
          summary: "Set a finding's remediation status",
          description:
            "Record your own remediation status for a single finding, keyed on (finding id, finding URL) so it survives rescans. Setting status to open clears any stored status. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RemediationRequest" },
              },
            },
          },
          responses: {
            "200": {
              description:
                "The stored remediation row (or status: open when cleared)",
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "503": {
              description:
                "The finding_remediation table has not been migrated yet",
            },
          },
        },
        get: {
          tags: ["Remediation"],
          summary: "Read stored remediation statuses",
          description:
            "The caller's own remediation rows, newest first, capped at 500. Both filters are optional: omit them to list everything. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          parameters: [
            {
              name: "url",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Only rows recorded against this finding URL (the scanned target).",
            },
            {
              name: "findingId",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Only rows for this finding id.",
            },
          ],
          responses: {
            "200": { description: "The matching remediation rows" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "503": {
              description:
                "The finding_remediation table has not been migrated yet",
            },
          },
        },
        delete: {
          tags: ["Remediation"],
          summary: "Clear a finding's remediation status",
          description:
            "Remove the stored status for one finding, returning it to open. Both query parameters are required. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          parameters: [
            {
              name: "url",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The finding URL the status was recorded against.",
            },
            {
              name: "findingId",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The finding id to clear.",
            },
          ],
          responses: {
            "200": { description: "The stored status was cleared" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "503": {
              description:
                "The finding_remediation table has not been migrated yet",
            },
          },
        },
      },
      "/scan/remediation/bulk": {
        post: {
          tags: ["Remediation"],
          summary: "Set remediation status for many findings",
          description:
            "Apply one remediation status to up to 200 findings at once. assignee and dueAt are applied only when present; absent leaves each finding's existing value. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BulkRemediationRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The count of findings updated" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "503": {
              description:
                "The finding_remediation table has not been migrated yet",
            },
          },
        },
      },
      "/keys": {
        get: {
          tags: ["API Keys"],
          summary: "List API keys",
          description:
            "The account's API keys. Secret values are never returned. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "The caller's API keys" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["API Keys"],
          summary: "Create an API key",
          description:
            "Generate a new API key. The raw key value is returned only in this response, so copy it immediately. The active-key count is capped by your plan. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiKeyCreateRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "The created key, including its one-time raw value",
            },
            "400": {
              description:
                "Invalid name, or the active-key limit for your plan is reached",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "API keys are disabled on this deployment" },
          },
        },
      },
      "/keys/{id}/rotate": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "The key id to rotate.",
          },
        ],
        post: {
          tags: ["API Keys"],
          summary: "Rotate an API key",
          description:
            "Delete the key and issue a replacement with the same name and scopes. The new raw key is returned once. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": {
              description: "The new key, including its one-time raw value",
            },
            "400": { description: "Invalid key id" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { description: "Key not found or already revoked" },
          },
        },
      },
      "/keys/{id}/revoke": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "The key id to revoke.",
          },
        ],
        post: {
          tags: ["API Keys"],
          summary: "Revoke an API key",
          description:
            "Set revoked_at on the key. It stops working immediately. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "The key was revoked" },
            "400": { description: "Invalid key id" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { description: "Key not found" },
          },
        },
      },
      "/keys/{id}/reset-binding": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "The key id whose IP binding to clear.",
          },
        ],
        post: {
          tags: ["API Keys"],
          summary: "Clear a key's IP binding",
          description:
            "Forget the IP a key pinned itself to on first use, on deployments that have API-key IP binding switched on. Rotating the key used to be the only way out of a binding mismatch, which forces every consumer to be reconfigured for what is usually just a CI runner getting a different address. The next successful request re-adopts whichever subnet it comes from, so this is a recovery action, not a way to switch the feature off. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "The binding was cleared" },
            "400": { description: "Invalid key id" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { description: "Key not found or already revoked" },
          },
        },
      },
      "/domains": {
        get: {
          tags: ["Domains"],
          summary: "List domains",
          description:
            "Your verified and pending domains, plus any assigned to a team you belong to. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "The caller's domains" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Domains"],
          summary: "Add a domain",
          description:
            "Add a domain (or subdomain) pending verification. Returns a DNS TXT record to publish; verifying it enables active-probe scans for that domain and everything under it. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DomainCreateRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "The new domain plus the DNS TXT record to publish",
            },
            "200": {
              description:
                "The existing row's instructions (alreadyExists: true)",
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "Domain verification is disabled on this deployment",
            },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
        delete: {
          tags: ["Domains"],
          summary: "Remove a domain",
          description:
            "Remove a domain by id. Active probing stops being allowed against it and its subdomains immediately. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "query",
              required: true,
              schema: { type: "integer" },
              description: "The domain id to remove.",
            },
          ],
          responses: {
            "200": { description: "The domain was removed" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "You don't have permission to remove this domain",
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/domains/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "The domain id to reassign.",
          },
        ],
        patch: {
          tags: ["Domains"],
          summary: "Assign a domain to a team",
          description:
            "Share a verified domain with a team, or send `teamId: null` to make it personal again. Owner-only, matching the rule on webhooks: a team member with write access may use a shared domain, but deciding who a proof of ownership is shared with belongs to whoever proved it. A domain that is not yours returns 404 rather than 403, since there is no read-only variant of this action to leak existence through. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TeamAssignRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The updated domain row" },
            "400": {
              description:
                "Body carried no teamId, teamId was neither an integer nor null, or it names a team you cannot write into",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/domains/{id}/verify": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "The domain id to verify.",
          },
        ],
        post: {
          tags: ["Domains"],
          summary: "Verify a domain now",
          description:
            "Look up the DNS TXT record right now and update the domain's status. Safe to call repeatedly while a record propagates. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "The verification result and new status" },
            "400": { description: "Invalid domain id" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description:
                "Domain verification is disabled, or you lack write access to this domain",
            },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/schedules": {
        get: {
          tags: ["Schedules"],
          summary: "List scheduled scans",
          description:
            "Your scheduled scans plus any belonging to a team you're on. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "The caller's scheduled scans" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Schedules"],
          summary: "Create a scheduled scan",
          description:
            "Schedule a recurring scan of a target. Frequency defaults to weekly; hourly and 6hourly require a higher plan. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScheduleCreateRequest" },
              },
            },
          },
          responses: {
            "201": { description: "The created schedule" },
            "400": {
              description:
                "Invalid URL, a blocked target, or a plan limit was reached",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "Scheduled scans are disabled on this deployment",
            },
          },
        },
        patch: {
          tags: ["Schedules"],
          summary: "Pause, resume, or reassign a scheduled scan",
          description:
            "Toggle a schedule's active flag or move it to a different team. Send at least one of active or teamId. Reassigning is owner-only; toggling is open to anyone with team access. The worker deactivates a schedule itself once its target stops validating, and this is how the owner turns it back on. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScheduleUpdateRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The updated schedule" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "No access to this schedule" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Schedules"],
          summary: "Delete a scheduled scan",
          description:
            "Remove a schedule so it stops running. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScheduleDeleteRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The schedule was deleted" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "No access to this schedule" },
          },
        },
      },
      "/teams": {
        get: {
          tags: ["Teams"],
          summary: "List teams",
          description:
            "Teams you belong to, with your role and each team's member count, plus your plan's team limits. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "The caller's teams and plan limits" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Teams"],
          summary: "Create a team",
          description:
            "Create a team owned by the caller. The number of teams you can own is capped by your plan. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TeamCreateRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The created team" },
            "400": {
              description: "Invalid team name, or a plan limit was reached",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "Teams are disabled on this deployment" },
          },
        },
        patch: {
          tags: ["Teams"],
          summary: "Rename a team",
          description:
            "Change a team's name. Requires the manage_team permission, which owner, admin, manager and operator all hold. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TeamRenameRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The new team name" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "No permission to rename this team" },
          },
        },
        delete: {
          tags: ["Teams"],
          summary: "Delete a team",
          description:
            "Delete a team along with its members and pending invites. Owner only: this is its own delete_team permission, not part of manage_team. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TeamDeleteRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The team was deleted" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "Only the team owner can delete a team" },
          },
        },
      },
      "/webhooks": {
        get: {
          tags: ["Webhooks"],
          summary: "List webhooks",
          description:
            "Your webhooks plus any assigned to a team you belong to. The signing secret is never returned here: it is shown once at creation and once more on rotation. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": { description: "The caller's webhooks" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          tags: ["Webhooks"],
          summary: "Create a webhook",
          description:
            "Register a public HTTPS endpoint to be called when a scan completes. The response carries the HMAC signing secret, once: store it now, because nothing will return it again short of a rotation. The URL is checked against the same private-address guard the scanner uses, so a private or link-local target is refused. The number of webhooks you can hold is capped by your plan. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookCreateRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "The created webhook, including its one-time secret",
            },
            "400": {
              description:
                "Missing or unparseable URL, a non-HTTPS or blocked target, or the plan limit is reached",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description: "Webhooks are disabled on this deployment",
            },
          },
        },
        patch: {
          tags: ["Webhooks"],
          summary: "Send a test payload",
          description:
            "Deliver a one-off test payload to a webhook so you can confirm it is wired up. This does NOT edit the webhook: use PATCH /webhooks/{id} for that. The stored URL is re-validated against the private-address guard before the call, since DNS may have moved since registration. Needs write access. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookIdRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The test payload was delivered" },
            "400": {
              description:
                "Missing id, the target is now blocked, or the endpoint refused the delivery. The body is { success: false, error } rather than a bare { error }.",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "No write access to this webhook" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Webhooks"],
          summary: "Delete a webhook",
          description:
            "Remove a webhook so it stops being called. Needs write access. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookIdRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The webhook was deleted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "No write access to this webhook" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/webhooks/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "The webhook id to edit.",
          },
        ],
        patch: {
          tags: ["Webhooks"],
          summary: "Edit, pause, or reassign a webhook",
          description:
            "Update a webhook in place. Send at least one of active, url, name, type or teamId; an absent field is left alone. `active: false` pauses delivery without losing the id or the secret. Reassigning to a team is owner-only; the rest needs write access. Not to be confused with PATCH /webhooks, which sends a test payload. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookUpdateRequest" },
              },
            },
          },
          responses: {
            "200": { description: "The updated webhook" },
            "400": {
              description:
                "Invalid id, a body with nothing to update, or a blocked URL",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": {
              description:
                "Read access but not write access (a viewer-role co-member)",
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/webhooks/{id}/rotate-secret": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "The webhook id whose secret to replace.",
          },
        ],
        post: {
          tags: ["Webhooks"],
          summary: "Rotate a webhook's signing secret",
          description:
            "Issue a new HMAC signing secret in place: same row, same id, same URL. The new secret is returned once and never again, exactly like key rotation. Owner-only rather than merely team-write, because rotating invalidates every signature the consumer is currently verifying. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": {
              description: "The webhook, including its new one-time secret",
            },
            "400": { description: "Invalid webhook id" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": {
              description: "Webhook not found, or you are not its owner",
            },
          },
        },
      },
      "/webhooks/{id}/deliveries": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "The webhook id whose attempts to read.",
          },
        ],
        get: {
          tags: ["Webhooks"],
          summary: "Read a webhook's delivery log",
          description:
            "The 50 most recent delivery attempts, newest first, so a failing webhook can be diagnosed from what actually came back. `httpStatus` is null on a network error or a blocked target, in which case the snippet carries the error text instead. Neither field ever contains the request payload. Read access follows the list: the owner, or a co-member of the team it is assigned to. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          responses: {
            "200": {
              description: "The most recent delivery attempts",
            },
            "400": { description: "Invalid webhook id" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/browser/sessions": {
        post: {
          tags: ["Browser"],
          summary: "Start a browser session",
          description:
            "Open an ephemeral remote browser on a URL and return the metadata needed to embed its live view. The provider API key is server-side only and never reaches the client. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/BrowserSessionCreateRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "The session plus expiresInSeconds, which echoes the CLAMPED ttl actually applied rather than the one you asked for",
            },
            "400": {
              description:
                "url is neither a public http(s) URL nor a public IPv4, or it failed the target safety check",
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "402": {
              description:
                "The plan's monthly browser-minute allowance is spent. The only 402 in this API, and retrying does not clear it before the quota resets.",
            },
            "429": { $ref: "#/components/responses/RateLimited" },
            "502": {
              description: "The provider returned a session with no id",
            },
            "503": {
              description:
                "Two meanings, distinguished by the message: 'not configured' is permanent for this deployment, 'capacity is full' is transient. Branch on the message, not the status.",
            },
          },
        },
        get: {
          tags: ["Browser"],
          summary: "Read a browser session",
          description:
            "The session's current status, URL and viewer URL. Ownership is checked against the stored row, so another user's session id is a 403 rather than a 404. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The session id returned by POST.",
            },
          ],
          responses: {
            "200": { description: "The session metadata" },
            "400": { description: "Missing session id" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "That session belongs to another user" },
            "502": { description: "The provider read failed" },
            "503": { description: "Not configured on this server" },
          },
        },
        delete: {
          tags: ["Browser"],
          summary: "End a browser session",
          description:
            "End a session early. Idempotent, so it is safe to fire from an unload handler. This call is what bills the metered seconds and releases the concurrency slot: a session nobody ends is only reclaimed by the periodic sweep, so calling it promptly frees capacity for everyone on the deployment. Session cookie auth.",
          security: [{ cookieAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The session id to end.",
            },
          ],
          responses: {
            "200": { description: "The session was ended" },
            "400": { description: "Missing session id" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { description: "That session belongs to another user" },
            "503": { description: "Not configured on this server" },
          },
        },
      },
      "/health": {
        get: {
          tags: ["System"],
          summary: "Readiness check",
          description:
            "Whether this deployment can serve traffic: database connectivity and schema readiness. Unauthenticated. Returns 200 when healthy and 503 when degraded or unhealthy, so an orchestrator can act on the status code alone.",
          security: [],
          responses: {
            "200": { description: "The service is ready (status: ok)" },
            "503": {
              description:
                "The service is not ready (status: degraded or unhealthy)",
            },
          },
        },
      },
      "/finding-types": {
        get: {
          tags: ["System"],
          summary: "List finding types",
          description:
            "The full catalogue of detection checks: id, type, title, category, severity, and description for every check, plus per-category counts. Unauthenticated. Read the count from the response rather than hardcoding it.",
          security: [],
          responses: {
            "200": {
              description: "The catalogue of checks with per-category counts",
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description:
            "A VulnRadar API key from Settings > API Keys, sent as `Authorization: Bearer <key>`. Keys carry scopes: scan:write, scan:read, scan:delete.",
        },
        // Several documented operations (remediation, keys, domains,
        // schedules, teams) are gated on getSession() and never call
        // validateApiKey, so an API key genuinely cannot reach them. They all
        // used to advertise `apiKey` anyway, purely because it was the only
        // scheme this document defined, which told every spec consumer, and
        // the playground, the opposite of the truth. ref: AUDIT-014#apidoc-14
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: AUTH_SESSION_COOKIE_NAME,
          description:
            "A browser session cookie, set by signing in to the web app. These operations are session-only: an API key is not accepted.",
        },
      },
      responses: {
        BadRequest: { description: "Missing or invalid parameters" },
        Unauthorized: {
          description: "No valid session or API key",
        },
        NotFound: { description: "Not found or access denied" },
        RateLimited: { description: "Rate limit or daily quota exceeded" },
      },
      schemas: {
        ScanRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description:
                "A hostname, full URL, or public IPv4. https:// is prepended if the scheme is omitted.",
              example: "example.com",
            },
            portScan: {
              type: "boolean",
              description:
                "Opt in to a curated sweep of common ports and services. Replaces the removed per-service `probes` array. Requires the target domain to be verified on your account, the same gate active-probes uses.",
              example: true,
            },
            scanners: {
              type: "array",
              items: { type: "string" },
              description:
                "Restrict web checks to these categories. Omit to run all defaults. active-probes is opt-in and needs a verified domain.",
              // The example is load-bearing, not decoration. lib/api/playground.ts's
              // buildExample falls back to ["" ] for an array of strings with no
              // example, and the scan route reads a non-empty array as an explicit
              // category selection, so the playground's prefilled body used to
              // select the single category "" -- zero real categories. The first
              // request a developer sends from the docs burned a daily-scan unit
              // and came back reporting no findings, which reads as "your site is
              // clean" rather than "you sent an invalid selector".
              // ref: AUDIT-014#apidoc-02
              example: ["headers", "ssl"],
            },
          },
        },
        ScanCreated: {
          type: "object",
          properties: {
            scanId: { type: "integer", example: 12345 },
            status: { type: "string", example: "running" },
          },
        },
        ScanStatus: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["pending", "running", "completed", "failed"],
            },
            currentCategory: { type: "string" },
            categoriesCompleted: { type: "integer" },
            categoriesTotal: { type: "integer" },
            elapsedMs: { type: "integer" },
            partialFindings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  severity: { type: "string" },
                },
              },
              description:
                "Findings discovered so far, severity and title only, sent only while status is pending or running. Deliberately absent once the scan completes: deduplication runs after the last category, so this list can be LONGER than the final one. Label it 'found so far' and let result.findings replace it wholesale.",
            },
            error: {
              type: "string",
              description: "Present only when status is failed.",
            },
            result: {
              type: "object",
              description: "Present only when status is completed.",
              properties: {
                url: { type: "string" },
                scannedAt: { type: "string", format: "date-time" },
                duration: { type: "integer" },
                summary: { $ref: "#/components/schemas/Summary" },
                findings: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Finding" },
                },
                responseHeaders: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  description: "The target's response headers, when captured.",
                },
                scanHistoryId: {
                  type: "integer",
                  description:
                    "The numeric scan id. The feedback route needs this form.",
                },
                scanPublicId: {
                  type: "string",
                  description:
                    "The opaque, non-enumerable id. This is what /history lists and what a share URL carries.",
                },
                tags: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      tag: { type: "string" },
                      source: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        // A partial description on purpose: a finding carries a good deal more
        // (fix steps, code examples, evidence excerpts, CVE enrichment) and
        // pinning all of it here would guarantee this drifts. What is listed is
        // the part a gate script keys on, above all `id` and `remediation`.
        Finding: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "The stable finding id, `<checkId>--<hash>`. Stable across rescans of the same target, which is what makes it usable as the thing a build gate names.",
              example: "hsts-missing--a1b2c3d4",
            },
            title: { type: "string" },
            severity: {
              type: "string",
              enum: ["critical", "high", "medium", "low", "info"],
            },
            category: { type: "string" },
            description: { type: "string" },
            evidence: { type: "string" },
            cwe: { type: "string", example: "CWE-79" },
            owasp: { type: "string", example: "A03:2021" },
            confidence: {
              type: "integer",
              description:
                "0-100: how certain the engine is this is a true positive.",
            },
            aiVerdict: {
              type: "string",
              enum: ["confirmed", "possible_fp", "uncertain"],
              description:
                "Present only after AI verification has run over this scan.",
            },
            aiConfidence: { type: "integer" },
            aiReason: { type: "string" },
            suppressed: {
              type: "boolean",
              description:
                "The owner marked this a false positive. Suppressed findings are excluded from summary counts and the danger score, so a gate should skip them too.",
            },
            remediation: {
              type: "object",
              description:
                "The owner's own triage state for this finding, attached by finding id so it survives rescans. Absent when nothing has been recorded, which means open. Owner-only: a teammate or a shared view never sees it.",
              properties: {
                status: {
                  type: "string",
                  enum: [
                    "open",
                    "in_progress",
                    "fixed",
                    "accepted_risk",
                    "wont_fix",
                  ],
                },
                note: { type: ["string", "null"] },
                assignee: { type: ["string", "null"] },
                dueAt: { type: ["string", "null"] },
              },
            },
          },
        },
        Summary: {
          type: "object",
          properties: {
            critical: { type: "integer" },
            high: { type: "integer" },
            medium: { type: "integer" },
            low: { type: "integer" },
            info: { type: "integer" },
            total: { type: "integer" },
          },
        },
        BulkScanRequest: {
          type: "object",
          required: ["urls"],
          properties: {
            urls: {
              type: "array",
              items: { type: "string" },
              description:
                "URLs to scan, up to your plan's per-request cap (absolute ceiling 100). Each counts as one daily scan.",
              example: ["https://example.com", "https://example.org"],
            },
            isPublic: {
              type: "boolean",
              description:
                "Whether the resulting scans are public. Omit to use your account's default.",
            },
          },
        },
        BulkScanResult: {
          type: "object",
          properties: {
            total: { type: "integer" },
            queued: {
              type: "integer",
              description: "URLs accepted and given a scan id.",
            },
            failed: {
              type: "integer",
              description:
                "URLs refused before they were queued (blocked target, quota exhausted).",
            },
            skipped: {
              type: "integer",
              description:
                "URLs left out because the account's remaining daily quota could not cover the whole batch.",
            },
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  success: { type: "boolean" },
                  scanId: {
                    type: "integer",
                    description:
                      "Poll GET /scan/status/{scanId} for this URL's progress and result.",
                  },
                  status: { type: "string", enum: ["queued"] },
                  error: { type: "string" },
                  details: { type: "string" },
                },
              },
            },
          },
        },
        DiscoverRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description:
                "A hostname or URL. Its registrable root domain is enumerated.",
              example: "https://example.com",
            },
            forceRefresh: {
              type: "boolean",
              description:
                "Bypass the 24h per-domain cache and re-run discovery.",
              example: false,
            },
            requestId: {
              type: "string",
              description:
                "A caller-generated id for THIS request. Supply one and you can poll GET /scan/discover/progress/{requestId} while this call is still in flight. Omit it and there is nothing to poll: the progress endpoint has no other way to find the run. Either way this call still blocks until discovery finishes.",
              example: "a3f9c1e2-7b04-4d8a-9c31-5e6f0b2a8d47",
            },
          },
        },
        DiscoverResult: {
          type: "object",
          properties: {
            domain: { type: "string" },
            subdomains: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  host: { type: "string" },
                  source: { type: "string" },
                  reachable: { type: "boolean" },
                },
              },
            },
            total: { type: "integer" },
            reachable: { type: "integer" },
            cached: { type: "boolean" },
          },
        },
        VerifyRequest: {
          type: "object",
          required: ["scanHistoryId"],
          properties: {
            scanHistoryId: {
              description:
                "The scan to AI-verify. Accepts the opaque public id (string) or a legacy numeric id.",
              oneOf: [{ type: "integer" }, { type: "string" }],
              example: 12345,
            },
          },
        },
        VerifyResult: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            findings: {
              type: "array",
              items: { type: "object" },
              description:
                "The scan's findings with aiVerdict / aiConfidence / aiReason applied.",
            },
          },
        },
        RemediationRequest: {
          type: "object",
          required: ["findingId", "findingUrl", "status"],
          properties: {
            findingId: {
              type: "string",
              description: "The stable finding id (<checkId>--<hash>).",
              example: "hsts-missing--a1b2c3d4",
            },
            findingUrl: {
              type: "string",
              format: "uri",
              description: "The scanned URL the finding was reported on.",
              example: "https://example.com",
            },
            status: {
              type: "string",
              enum: [
                "open",
                "in_progress",
                "fixed",
                "accepted_risk",
                "wont_fix",
              ],
              description:
                "The remediation status. open clears any stored status.",
              example: "in_progress",
            },
            note: {
              type: "string",
              description: "Optional free-text note (max 2000 characters).",
            },
            assignee: {
              type: "string",
              description: "Optional assignee label (max 120 characters).",
            },
            dueAt: {
              type: "string",
              description:
                "Optional target/SLA date (ISO date or datetime). null or an unparseable value clears it.",
            },
          },
        },
        BulkRemediationRequest: {
          type: "object",
          required: ["items", "status"],
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              description: "The findings to update.",
              items: {
                type: "object",
                required: ["findingId", "findingUrl"],
                properties: {
                  findingId: { type: "string" },
                  findingUrl: { type: "string", format: "uri" },
                },
              },
              example: [
                {
                  findingId: "hsts-missing--a1b2c3d4",
                  findingUrl: "https://example.com",
                },
              ],
            },
            status: {
              type: "string",
              enum: [
                "open",
                "in_progress",
                "fixed",
                "accepted_risk",
                "wont_fix",
              ],
              description:
                "Applied to every listed finding. open clears each row.",
              example: "fixed",
            },
            assignee: {
              type: "string",
              description:
                "Applied only when present; absent leaves each finding's assignee unchanged.",
            },
            dueAt: {
              type: "string",
              description:
                "Applied only when present; absent leaves each finding's due date unchanged.",
            },
          },
        },
        ApiKeyCreateRequest: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                'A label for the key (1-100 characters). Defaults to "Default".',
              example: "CI",
            },
            scopes: {
              type: "array",
              items: {
                type: "string",
                enum: ["scan:write", "scan:read", "scan:delete"],
              },
              description:
                "Scopes for the key. Defaults to scan:write + scan:read when omitted.",
              example: ["scan:write", "scan:read"],
            },
          },
        },
        DomainCreateRequest: {
          type: "object",
          required: ["domain"],
          properties: {
            domain: {
              type: "string",
              description:
                "A bare domain, www.-prefixed domain, or URL (only its hostname is used). Not collapsed to its registrable root.",
              example: "example.com",
            },
          },
        },
        ScheduleCreateRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description:
                "The target to scan. Must be a public http/https URL.",
              example: "https://example.com",
            },
            frequency: {
              type: "string",
              enum: ["hourly", "6hourly", "daily", "weekly", "monthly"],
              description:
                "Cadence. Defaults to weekly. hourly and 6hourly require a higher plan.",
              example: "weekly",
            },
            preferredHourUtc: {
              type: "integer",
              minimum: 0,
              maximum: 23,
              description: "Preferred run hour in UTC.",
            },
            preferredDayOfWeek: {
              type: "integer",
              minimum: 0,
              maximum: 6,
              description:
                "Preferred day of week for weekly runs (0 = Sunday).",
            },
            preferredDayOfMonth: {
              type: "integer",
              minimum: 1,
              maximum: 28,
              description: "Preferred day of month for monthly runs.",
            },
          },
        },
        ScheduleUpdateRequest: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              oneOf: [{ type: "integer" }, { type: "string" }],
              description: "The schedule to update.",
              example: 42,
            },
            active: {
              type: "boolean",
              description:
                "Pause (false) or resume (true) the schedule. Omit to leave it alone.",
              example: true,
            },
            teamId: {
              type: ["integer", "null"],
              description:
                "Move the schedule to a team, or null to make it personal again. Owner only. Omit to leave it alone.",
            },
          },
        },
        ScheduleDeleteRequest: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              oneOf: [{ type: "integer" }, { type: "string" }],
              description: "The schedule to delete.",
              example: 42,
            },
          },
        },
        ScanUpdateRequest: {
          type: "object",
          description:
            "At least one field is required; a body with none of them is a 400.",
          properties: {
            notes: {
              type: "string",
              maxLength: 2000,
              description:
                "Your own notes on this scan. Truncated at 2000 characters.",
              example: "Staging only, the missing HSTS header is expected.",
            },
            isPublic: {
              type: "boolean",
              description:
                "Whether the scan has a public share link. Setting it to false revokes the existing link.",
              example: false,
            },
            teamIds: {
              type: "array",
              items: { type: "integer" },
              description:
                "The complete set of teams this scan is shared with, not a list to add. Send [] to unshare it entirely. Every id must name a team you can share into; one you cannot is a 400 for the whole request rather than a partial apply.",
              example: [7, 9],
            },
            teamId: {
              type: ["integer", "null"],
              description:
                "The single-team form, still accepted for clients written before multi-team sharing. Equivalent to teamIds: [teamId], or teamIds: [] for null. Send teamIds instead in new code.",
            },
          },
        },
        ScanUpdateResult: {
          type: "object",
          description:
            "Returned flat, with no { success } or { data } wrapper. teamIds is reported whether or not this request changed it, so a client can read back the current sharing set without a second call.",
          properties: {
            notes: { type: ["string", "null"] },
            isPublic: { type: "boolean" },
            teamId: {
              type: ["integer", "null"],
              description:
                "The primary team: the first entry of teamIds, kept for clients written against the single-team contract.",
            },
            teamIds: {
              type: "array",
              items: { type: "integer" },
            },
          },
        },
        HistoryPage: {
          type: "object",
          properties: {
            scans: {
              type: "array",
              items: { $ref: "#/components/schemas/HistoryEntry" },
            },
            total: {
              type: "integer",
              description:
                "Every scan on the account within retention, not the length of this page. Advisory: if the count query fails the page length is returned instead rather than failing the request.",
            },
            limit: {
              type: "integer",
              description: "The page size actually applied to this request.",
            },
            offset: { type: "integer", description: "Rows skipped." },
            maxLimit: {
              type: "integer",
              description:
                "The largest page size this deployment will serve. A larger `limit` is clamped to it, not rejected.",
            },
            truncated: {
              type: "boolean",
              description: "True when there are rows after this page.",
            },
          },
        },
        HistoryEntry: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "The scan's opaque public id. Every /history subroute accepts it, and so does the legacy numeric id.",
            },
            url: { type: "string" },
            summary: { $ref: "#/components/schemas/Summary" },
            findings_count: { type: "integer" },
            duration: { type: "integer" },
            scanned_at: { type: "string", format: "date-time" },
            source: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "running", "completed", "failed"],
              description:
                "A row is inserted as pending before any work starts, so a scan the user navigated away from appears here with an empty summary rather than as a clean result.",
            },
            tags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tag: { type: "string" },
                  source: { type: "string" },
                },
              },
            },
          },
        },
        AuthenticatedScanRequest: {
          type: "object",
          required: ["url", "auth"],
          properties: {
            url: { type: "string", example: "https://example.com/dashboard" },
            scanners: {
              type: "array",
              items: { type: "string" },
              description:
                "Restrict web checks to these categories, exactly as on POST /scan.",
              example: ["headers", "cookies", "content"],
            },
            isPublic: {
              type: "boolean",
              default: false,
              description:
                "Defaults to false here, unlike every other scan-creation path: an authenticated scan sees whatever a logged-in area renders, so neither the account default nor the column default can make it public. Only an explicit true does.",
            },
            auth: {
              type: "object",
              required: ["method"],
              description:
                "Nothing under this key is ever written to a table, a log line, or an audit record.",
              properties: {
                method: {
                  type: "string",
                  enum: ["form", "header", "cookie"],
                  description:
                    "form opens an ephemeral real browser session so a JavaScript-rendered login page can appear before the form is submitted; header and cookie attach the given values to every request instead.",
                },
                loginUrl: { type: "string" },
                username: { type: "string" },
                password: { type: "string" },
              },
            },
          },
        },
        CrawlDiscoverRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description:
                "The entry point. http and https only, unlike POST /scan's wider protocol set. Discovery is pinned to this hostname, so no subdomain or cross-host URL can enter the result.",
              example: "https://example.com",
            },
          },
        },
        CrawlDiscoverResult: {
          type: "object",
          properties: {
            urls: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        DiscoveryProgress: {
          type: "object",
          properties: {
            stage: {
              type: "string",
              enum: [
                "queued",
                "querying_sources",
                "brute_force",
                "dns_resolution",
                "reachability",
                "done",
              ],
              description:
                "`queued` also covers a requestId this instance has never seen, so an early poll and a typo look the same.",
            },
            stageIndex: {
              type: "integer",
              description:
                "The stage's 0-based position, and stagesTotal once stage is done, so stageIndex / stagesTotal is a usable fraction.",
            },
            stagesTotal: { type: "integer", example: 4 },
          },
        },
        ReputationResult: {
          type: "object",
          properties: {
            known: { type: "boolean" },
            host: { type: "string" },
            dangerScore: { type: ["number", "null"] },
            verdict: {
              type: ["string", "null"],
              enum: ["safe", "caution", "unsafe", null],
              description:
                "The canonical tier. Read this rather than re-deriving one from severityCounts: a naive `high > 0` rule cannot tell an exploitable high from a hardening high such as a lone missing HSTS, and flags hosts the real scorer considers safe.",
            },
            severityCounts: {
              anyOf: [
                { $ref: "#/components/schemas/Summary" },
                { type: "null" },
              ],
            },
            lastScannedAt: { type: ["string", "null"], format: "date-time" },
            scanId: {
              type: ["integer", "null"],
              description:
                "Null once the scan behind this record has been deleted.",
            },
            matchType: {
              type: ["string", "null"],
              enum: ["exact", "host", null],
              description:
                "`exact` when this reflects a scan of the precise page you asked about, `host` when it is a scan of a different page on the same host.",
            },
            scannedUrl: {
              type: ["string", "null"],
              description:
                "Only ever the URL you supplied yourself, on an exact match. Null on a host-level match, because that is someone else's scan of a page you never named and its query string could carry their tokens.",
            },
          },
        },
        VerifyBatchRequest: {
          type: "object",
          required: ["url", "findings"],
          properties: {
            url: { type: "string", example: "https://example.com" },
            findings: {
              type: "array",
              items: { type: "object" },
              description:
                "The findings to verify. Capped by the deployment's AI verify batch setting, which ships at 50; over it is a 400 naming the limit.",
            },
          },
        },
        WebhookCreateRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              format: "uri",
              description: "A public HTTPS endpoint. http is refused.",
              example: "https://hooks.example.com/vulnradar",
            },
            name: {
              type: "string",
              description: 'A label. Defaults to "Default".',
              example: "CI alerts",
            },
            type: {
              type: "string",
              enum: ["auto", "discord", "slack", "generic"],
              description:
                "The payload format. Omit it, or send auto, to detect it from the URL.",
            },
          },
        },
        WebhookIdRequest: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "integer", example: 3 },
          },
        },
        WebhookUpdateRequest: {
          type: "object",
          description:
            "At least one field is required; a body with none of them is a 400.",
          properties: {
            active: {
              type: "boolean",
              description:
                "false pauses delivery while keeping the id and the secret.",
            },
            url: { type: "string", format: "uri" },
            name: { type: "string" },
            type: {
              type: "string",
              enum: ["auto", "discord", "slack", "generic"],
            },
            teamId: {
              type: ["integer", "null"],
              description:
                "Share with a team, or null to make it personal. Owner only.",
            },
          },
        },
        BrowserSessionCreateRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description: "A public http(s) URL or public IPv4 to open.",
              example: "https://example.com",
            },
            ttlSeconds: {
              type: "integer",
              description:
                "Requested lifetime. Clamped to a 30 second floor and the deployment's ceiling, which ships at 360. Read expiresInSeconds in the response rather than assuming this was honoured. `ttl` is accepted as a legacy alias; this wins if both are sent.",
              example: 360,
            },
            viewport: {
              type: "object",
              description:
                "The remote browser's resolution. Defaults to 1920x1080, which is deliberately smaller than the provider's own default so the embedded viewer is legible.",
              properties: {
                width: { type: "integer", example: 1920 },
                height: { type: "integer", example: 1080 },
              },
            },
          },
        },
        TeamAssignRequest: {
          type: "object",
          required: ["teamId"],
          properties: {
            teamId: {
              type: ["integer", "null"],
              description:
                "A team you can write into, or null to make the resource personal again.",
              example: 7,
            },
          },
        },
        TeamCreateRequest: {
          type: "object",
          required: ["name"],
          properties: {
            name: {
              type: "string",
              minLength: 2,
              description:
                "The team name (2 characters up to the deployment's configured maximum).",
              example: "Security Team",
            },
          },
        },
        TeamRenameRequest: {
          type: "object",
          required: ["teamId", "name"],
          properties: {
            teamId: { type: "integer", example: 7 },
            name: {
              type: "string",
              minLength: 2,
              description:
                "The new team name (2 characters up to the deployment's configured maximum).",
              example: "Platform Security",
            },
          },
        },
        TeamDeleteRequest: {
          type: "object",
          required: ["teamId"],
          properties: {
            teamId: { type: "integer", example: 7 },
          },
        },
      },
    },
  };
}
