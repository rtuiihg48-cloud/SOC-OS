import { describe, expect, it } from "vitest";
import { buildBillingReturnUrl, normalizeArtifactBasePath } from "./billing-url";

describe("billing return URL", () => {
  it("supports a root-mounted dashboard", () => {
    expect(normalizeArtifactBasePath("/")).toBe("/");
    expect(buildBillingReturnUrl("https://app.example.com/ignored", "/", "corr"))
      .toBe("https://app.example.com/billing?checkout_correlation=corr");
  });

  it("supports an artifact subpath", () => {
    expect(normalizeArtifactBasePath("soc-dashboard")).toBe("/soc-dashboard/");
    expect(buildBillingReturnUrl("https://app.example.com", "/soc-dashboard/", "corr"))
      .toBe("https://app.example.com/soc-dashboard/billing?checkout_correlation=corr");
  });
});