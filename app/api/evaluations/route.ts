import { prisma } from "@/lib/db/prisma";
import { runEvaluationSuite } from "@/lib/evaluations/runner";
import { jsonError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const [cases, runs] = await Promise.all([
      prisma.evaluationCase.findMany({ orderBy: { code: "asc" } }),
      prisma.evaluationRun.findMany({
        include: {
          results: { include: { evaluationCase: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);

    const latest = runs[0];
    const failureCategories: Record<string, number> = {};
    if (latest) {
      for (const r of latest.results) {
        if (!r.passed) {
          const cat = r.evaluationCase.category;
          failureCategories[cat] = (failureCategories[cat] || 0) + 1;
        }
      }
    }

    return jsonOk({
      totalTests: cases.length,
      cases,
      runs,
      latestRun: latest
        ? {
            ...latest,
            passRate: latest.totalTests ? latest.passed / latest.totalTests : 0,
            failureCategories,
          }
        : null,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load evaluations", 500);
  }
}

export async function POST() {
  try {
    const run = await runEvaluationSuite();
    return jsonOk({ run }, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to run evaluations", 500);
  }
}
