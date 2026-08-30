import { randomUUID } from "node:crypto";

const DEFAULT_META_CUBE_URL = "http://127.0.0.1:8008";
const DEFAULT_TIMEOUT_MS = 5_000;

export class MetaCubeClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: unknown,
  ) {
    super(message);
    this.name = "MetaCubeClientError";
  }
}

function serviceUrl(path: string): URL {
  const baseUrl = process.env.META_CUBE_URL ?? DEFAULT_META_CUBE_URL;
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

export async function callMetaCube(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    correlationId?: string;
  } = {},
): Promise<unknown> {
  const url = serviceUrl(path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const timeoutMs = Number(process.env.META_CUBE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const correlationId = options.correlationId ?? randomUUID();

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown connection error";
    throw new MetaCubeClientError(
      `META-CUBE execution service is unavailable: ${reason}`,
      503,
      { error: "META-CUBE execution service is unavailable", correlationId },
    );
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    throw new MetaCubeClientError(
      `META-CUBE request failed with status ${response.status}`,
      response.status,
      data,
    );
  }

  return data;
}