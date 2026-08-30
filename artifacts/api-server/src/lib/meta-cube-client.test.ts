import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callMetaCube, MetaCubeClientError } from "./meta-cube-client";

const context = {
  tenantId: 7, principalType: "USER", principalId: "42", capability: "execution:read",
  correlationId: "correlation", idempotencyKey: "key",
};

describe("META-CUBE internal bridge", () => {
  afterEach(() => {
    delete process.env.META_CUBE_INTERNAL_SECRET;
    vi.unstubAllGlobals();
  });

  it("signs the typed tenant context without exposing the secret", async () => {
    process.env.META_CUBE_INTERNAL_SECRET = "test-secret";
    const fetch = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await callMetaCube("v1/executions", { context });
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const encoded = headers["x-meta-cube-context"];
    expect(JSON.parse(Buffer.from(encoded, "base64url").toString())).toMatchObject(context);
    expect(headers["x-meta-cube-signature"]).toBe(createHmac("sha256", "test-secret").update(encoded).digest("hex"));
  });

  it("fails closed when the shared secret is absent", async () => {
    await expect(callMetaCube("v1/executions", { context })).rejects.toBeInstanceOf(MetaCubeClientError);
  });
});