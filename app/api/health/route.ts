import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Lightweight probe for Netlify / DB connectivity. */
export async function GET() {
  const started = Date.now();
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { ok: false, error: "DATABASE_URL is not set in this environment" },
        { status: 500 },
      );
    }
    await prisma.$queryRaw`SELECT 1`;
    const customers = await prisma.customer.count();
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - started,
      customers,
      netlify: Boolean(process.env.NETLIFY),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
