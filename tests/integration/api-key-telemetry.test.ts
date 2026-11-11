import { it, expect, vi, beforeEach } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import pool from "@/lib/database/db";
import {
  generateApiKey,
  listApiKeysByVersionUsage,
  recordKeyUsage,
  __resetKeyUsageThrottle,
} from "@/lib/api/api-keys";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { versioned } from "@/lib/api/v4/wrap";
import type { OpName } from "@/lib/api/v4/types";
import { GET as reputationGET } from "@/app/api/v3/scan/reputation/route";
import { GET as meGET } from "@/app/api/v3/auth/me/route";
import { GET as statusGET } from "@/app/api/v3/scan/status/[id]/route";
import { describeIntegration, createUser } from "./_db";

// There is no request scope in a test to read the caller's address from.
vi.mock("@/lib/api/request-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/request-utils")>()),
  getClientIp: async () => "203.0.113.20",
  getUserAgent: async () => "integration-test",
}));

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => {}),
}));

/**
 * The v3 sunset telemetry against a real PostgreSQL: the two columns the
 * boot schema adds, written through the real routes the extension and the
 * CLI call, and read back by the helper the admin panel and the review use.
 *
 * The routes are wrapped in versioned() here because that is what sets the
 * ambient version and client; a route already wrapped by its own file is
 * simply wrapped twice, which enters the same context again.
 */

interface Telemetry {
  last_used_api_version: string | null;
  last_used_client: string | null;
}

async function telemetryOf(keyId: number): Promise<Telemetry> {
  const { rows } = await pool.query<Telemetry>(
    "SELECT last_used_api_version, last_used_client FROM api_keys WHERE id = $1",
    [keyId],
  );
  return rows[0];
}

/** The write is fire and forget, so the row is polled until it lands. */
async function expectTelemetry(keyId: number, expected: Telemetry) {
  await vi.waitFor(async () => {
    expect(await telemetryOf(keyId)).toEqual(expected);
  });
}

async function createKey(): Promise<{ id: number; raw: string }> {
  const user = await createUser();
  await pool.query("UPDATE users SET tos_accepted_at = NOW() WHERE id = $1", [
    user.id,
  ]);
  const key = await generateApiKey(
    user.id,
    "telemetry",
    100,
    [API_KEY_SCOPES.SCAN_READ],
    null,
  );
  expect(key).not.toBeNull();
  return { id: key!.id, raw: key!.raw_key };
}

function apiRequest(
  path: string,
  rawKey: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${rawKey}`, ...headers },
  });
}

function call<TArgs extends [NextRequest, ...unknown[]]>(
  op: OpName,
  handler: (...args: TArgs) => Promise<NextResponse>,
  ...args: TArgs
): Promise<NextResponse> {
  return versioned(op, handler)(...args);
}

beforeEach(() => {
  __resetKeyUsageThrottle();
});

describeIntegration("API key version and client telemetry", () => {
  it("records a reputation lookup, which is never metered", async () => {
    const key = await createKey();
    const res = await call(
      "scan.reputation",
      reputationGET,
      apiRequest("/api/v3/scan/reputation?host=example.com", key.raw, {
        "x-vulnradar-client": "extension/0.3.0",
      }),
    );
    expect(res.status).toBe(200);
    await expectTelemetry(key.id, {
      last_used_api_version: "v3",
      last_used_client: "extension/0.3.0",
    });
  });

  it("records auth/me, the extension's other steady call", async () => {
    const key = await createKey();
    const res = await call(
      "auth.me",
      meGET,
      apiRequest("/api/v3/auth/me", key.raw, {
        "x-vulnradar-client": "extension/0.3.0",
      }),
    );
    expect(res.status).toBe(200);
    await expectTelemetry(key.id, {
      last_used_api_version: "v3",
      last_used_client: "extension/0.3.0",
    });
  });

  it("records a status poll, even for a scan that is not there", async () => {
    const key = await createKey();
    const res = await call(
      "scan.status",
      statusGET,
      apiRequest("/api/v3/scan/status/999999999", key.raw, {
        "x-vulnradar-client": "cli/2.1.0",
      }),
      { params: Promise.resolve({ id: "999999999" }) },
    );
    expect(res.status).not.toBe(401);
    await expectTelemetry(key.id, {
      last_used_api_version: "v3",
      last_used_client: "cli/2.1.0",
    });
  });

  it("records a pre-4.0 client, which sends no header, as NULL", async () => {
    const key = await createKey();
    await call("auth.me", meGET, apiRequest("/api/v3/auth/me", key.raw));
    await expectTelemetry(key.id, {
      last_used_api_version: "v3",
      last_used_client: null,
    });
  });

  it("stores NULL for a client string outside the allowed shape", async () => {
    const key = await createKey();
    await call(
      "auth.me",
      meGET,
      apiRequest("/api/v3/auth/me", key.raw, {
        "x-vulnradar-client": "extension/0.3.0 <b>",
      }),
    );
    await expectTelemetry(key.id, {
      last_used_api_version: "v3",
      last_used_client: null,
    });
  });

  it("records the v4 marker when middleware says the request is v4", async () => {
    const key = await createKey();
    await call(
      "auth.me",
      meGET,
      apiRequest("/api/v3/auth/me", key.raw, {
        "x-vr-api-version": "v4",
        "x-vulnradar-client": "cli/3.0.0",
      }),
    );
    await expectTelemetry(key.id, {
      last_used_api_version: "v4",
      last_used_client: "cli/3.0.0",
    });
  });

  it("writes once per window, and again at once when the client changes", async () => {
    const key = await createKey();
    const usage = { apiVersion: "v3", client: "cli/2.1.0" } as const;
    await recordKeyUsage(key.id, usage);
    expect(await telemetryOf(key.id)).toEqual({
      last_used_api_version: "v3",
      last_used_client: "cli/2.1.0",
    });

    // A marker no real write produces: if the throttled call wrote, it is gone.
    await pool.query(
      "UPDATE api_keys SET last_used_client = 'marker' WHERE id = $1",
      [key.id],
    );
    await recordKeyUsage(key.id, usage);
    expect((await telemetryOf(key.id)).last_used_client).toBe("marker");

    await recordKeyUsage(key.id, { apiVersion: "v4", client: "cli/3.0.0" });
    expect(await telemetryOf(key.id)).toEqual({
      last_used_api_version: "v4",
      last_used_client: "cli/3.0.0",
    });
  });

  it("lists keys still on v3 before v4, a missing client first", async () => {
    const onV4 = await createKey();
    const onV3WithClient = await createKey();
    const onV3NoClient = await createKey();
    await recordKeyUsage(onV4.id, { apiVersion: "v4", client: "cli/3.0.0" });
    await recordKeyUsage(onV3WithClient.id, {
      apiVersion: "v3",
      client: "cli/2.1.0",
    });
    await recordKeyUsage(onV3NoClient.id, { apiVersion: "v3", client: null });

    const ours = new Set([onV4.id, onV3WithClient.id, onV3NoClient.id]);
    const order = (await listApiKeysByVersionUsage({ limit: 500 }))
      .filter((row) => ours.has(row.keyId))
      .map((row) => row.keyId);
    expect(order).toEqual([onV3NoClient.id, onV3WithClient.id, onV4.id]);

    const v3Only = (await listApiKeysByVersionUsage({ only: "v3", limit: 500 }))
      .map((row) => row.keyId)
      .filter((id) => ours.has(id));
    expect(v3Only).toEqual([onV3NoClient.id, onV3WithClient.id]);

    const noClient = (
      await listApiKeysByVersionUsage({ only: "no-client", limit: 500 })
    )
      .map((row) => row.keyId)
      .filter((id) => ours.has(id));
    expect(noClient).toEqual([onV3NoClient.id]);
  });
});
