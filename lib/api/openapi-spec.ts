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
          description: "The caller's own past scans, most recent first.",
          security: [{ apiKey: ["scan:read"] }],
          responses: {
            "200": { description: "A page of past scans" },
            "401": { $ref: "#/components/responses/Unauthorized" },
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
          summary: "Update a scan's notes, visibility, or team",
          description:
            "Edit one past scan. Send only the fields you want to change: an absent field is left alone. Turning isPublic off revokes any existing share link.",
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
            "200": { description: "The updated notes, visibility, and team" },
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
                  items: { type: "object" },
                },
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
            teamId: {
              type: ["integer", "null"],
              description:
                "Assign the scan to a team you can share to, or null to unassign it.",
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
