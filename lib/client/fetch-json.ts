/** Safe JSON fetch with retries for Next.js Fast Refresh transient 404 HTML pages. */

export class FetchJsonError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FetchJsonError";
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T = unknown>(
  input: string,
  init?: RequestInit & { retries?: number; retryDelayMs?: number },
): Promise<T> {
  const retries = init?.retries ?? 2;
  const retryDelayMs = init?.retryDelayMs ?? 400;
  const { retries: _r, retryDelayMs: _d, ...fetchInit } = init || {};

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, { cache: "no-store", ...fetchInit });
      const text = await res.text();
      const looksHtml = /^\s*<!DOCTYPE/i.test(text) || /^\s*<html/i.test(text);
      if (looksHtml) {
        throw new FetchJsonError(
          res.status === 404
            ? "API temporarily unavailable (reloading). Retrying…"
            : `Unexpected HTML response (${res.status})`,
          res.status,
        );
      }

      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new FetchJsonError("Response was not valid JSON", res.status);
      }

      if (!res.ok) {
        const msg =
          json && typeof json === "object" && "error" in json
            ? String((json as { error?: unknown }).error || "Request failed")
            : `Request failed (${res.status})`;
        throw new FetchJsonError(msg, res.status);
      }

      return json as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = err instanceof FetchJsonError ? err.status : 0;
      const transient = status === 404 || status === 502 || status === 503 || status === 0;
      if (!transient || attempt === retries) break;
      await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw lastError || new Error("Request failed");
}
