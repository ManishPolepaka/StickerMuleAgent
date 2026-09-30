import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  // Realtime demo APIs must never be browser-cached — stale /api/tasks hid new investigations.
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  return NextResponse.json(data, { ...init, headers });
}

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function parseJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}
