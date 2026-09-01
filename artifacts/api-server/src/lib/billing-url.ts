export function normalizeArtifactBasePath(value?: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

export function buildBillingReturnUrl(
  origin: string,
  basePath: string | undefined,
  correlationId: string,
): string {
  const url = new URL(origin);
  const normalized = normalizeArtifactBasePath(basePath);
  url.pathname = `${normalized}billing`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.searchParams.set("checkout_correlation", correlationId);
  return url.toString();
}