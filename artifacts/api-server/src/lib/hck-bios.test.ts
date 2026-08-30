import { afterEach, describe, expect, it, vi } from "vitest";

const healthyDependencies = {
  checkDatabase: async () => ({ connected: true }),
  checkSchema: async () => ({ missing: [] }),
  checkMetaCube: async () => ({ status: "ok", persistence: "postgres" }),
  getQueueStatus: () => ({ hasProcessor: true }),
};

afterEach(() => {
  delete process.env.NODE_ENV;
  vi.resetModules();
});

describe("HCK-BIOS META-CUBE production readiness", () => {
  it("fails rather than reporting ready for file-backed META-CUBE", async () => {
    process.env.NODE_ENV = "production";
    const { bootHckBios } = await import("./hck-bios");

    const bios = await bootHckBios({
      ...healthyDependencies,
      checkMetaCube: async () => ({ status: "ok", persistence: "file" }),
    });

    expect(bios.status).toBe("failed");
    expect(bios.stages.find((stage) => stage.name === "meta_cube")).toMatchObject({
      status: "failed",
      data: { status: "ok", persistence: "file" },
    });
  });

  it("fails rather than reporting ready for an unhealthy META-CUBE", async () => {
    process.env.NODE_ENV = "production";
    const { bootHckBios } = await import("./hck-bios");

    const bios = await bootHckBios({
      ...healthyDependencies,
      checkMetaCube: async () => ({ status: "degraded", persistence: "postgres" }),
    });

    expect(bios.status).toBe("failed");
    expect(bios.stages.find((stage) => stage.name === "meta_cube")?.status).toBe("failed");
  });
});