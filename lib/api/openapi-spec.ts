import { APP_NAME, APP_VERSION } from "@/lib/config/constants";

/**
 * A machine-readable OpenAPI 3.1 description of the core public v3 API: the
 * scan lifecycle, history reads, and report export. Served at
 * /api/v3/openapi.json (see the route) so it can be imported into Postman /
 * Insomnia / Bruno, rendered by an interactive explorer, and dogfooded by the
 * planned spec-import scanning feature.
 *
 * This is a hand-maintained subset focused on what an integrator actually
 * calls, not every internal endpoint. Keep it in step with app/docs/api when
 * an endpoint's shape changes. `baseUrl` is the deployment's origin so a
 * self-hosted instance advertises its own server.
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
    servers: [{ url: `${baseUrl}/api/v3`, description: "v3 API" }],
    security: [{ apiKey: [] }],
    tags: [
      { name: "Scans", description: "Start scans and poll their results." },
      { name: "History", description: "Read past scans and export reports." },
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
            required: true,
            schema: {
              type: "string",
              enum: ["sarif", "pdf", "md", "compliance", "json"],
            },
            description: "The report format to render.",
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
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description:
            "A VulnRadar API key from Settings > API Keys, sent as `Authorization: Bearer <key>`. Keys carry scopes: scan:write, scan:read, scan:delete.",
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
            probes: {
              type: "array",
              items: { type: "string" },
              description:
                'Opt-in service probes as "service:port", e.g. "ssh:22".',
              example: ["ssh:22"],
            },
            scanners: {
              type: "array",
              items: { type: "string" },
              description:
                "Restrict web checks to these categories. Omit to run all defaults. active-probes is opt-in and needs a verified domain.",
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
      },
    },
  };
}
