import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * Shared Prisma client for Supabase transaction pooler (:6543 + pgbouncer=true).
 * Use a small pool (2–3): connection_limit=1 starves the agent loop when the UI
 * (SSE + list APIs) also needs a connection; large pools cause remote resets.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Timed out fetching a new connection") ||
    msg.includes("Connection reset") ||
    msg.includes("ConnectionReset") ||
    msg.includes("Server has closed the connection") ||
    msg.includes("Can't reach database server") ||
    msg.includes("P1001") ||
    msg.includes("P1017") ||
    msg.includes("10054")
  );
}

/** Retry Prisma calls that fail on pool exhaustion / dropped sockets. */
export async function withPrismaRetry<T>(
  op: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? 400;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      last = err;
      if (!isTransientDbError(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}
