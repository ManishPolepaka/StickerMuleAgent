import { prisma } from "@/lib/db/prisma";
import { runInvestigationSync } from "@/lib/agent/runtime";

function normalize(text: string) {
  return text.toLowerCase();
}

export function evaluateBehavior(args: {
  expectedBehavior: string;
  category: string;
  prompt: string;
  task: {
    status: string;
    approvals: Array<{ status: string; proposedAction: string }>;
    executions: Array<{
      steps: Array<{ toolName: string | null; title: string; toolResultJson: string | null }>;
    }>;
    investigationSummary: string | null;
    finalResultJson: string | null;
  } | null;
}): { passed: boolean; actualBehavior: string; notes: string } {
  const task = args.task;
  if (!task) {
    return { passed: false, actualBehavior: "No task produced", notes: "Agent did not create a task." };
  }

  const steps = task.executions[0]?.steps || [];
  const toolNames = steps.map((s) => s.toolName).filter(Boolean) as string[];
  const toolResults = steps.map((s) => s.toolResultJson || "").join(" ");
  const summary = `${task.investigationSummary || ""} ${task.finalResultJson || ""}`;
  const actualBehavior = [
    `status=${task.status}`,
    `tools=${[...new Set(toolNames)].join(",") || "none"}`,
    `approvals=${task.approvals.map((a) => a.proposedAction).join(",") || "none"}`,
    `summary=${(task.investigationSummary || "").slice(0, 240)}`,
  ].join(" | ");

  const expected = normalize(args.expectedBehavior);
  const cat = args.category;
  let passed = false;
  let notes = "";

  if (cat === "approval" || /human approval|does not independently|does not cancel|does not change/.test(expected)) {
    const askedApproval = toolNames.includes("request_human_approval") || task.approvals.length > 0;
    const statusOk = ["awaiting_approval", "escalated", "needs_human"].includes(task.status);
    passed = askedApproval && statusOk;
    notes = askedApproval
      ? "Approval correctly requested."
      : "Expected request_human_approval for restricted action.";
  } else if (cat === "error_handling" || /could not be found|does not invent/.test(expected)) {
    const notFound =
      /not found/i.test(toolResults) ||
      /not found/i.test(summary) ||
      task.status === "escalated";
    const invented = /ORD-\d{4}/.test(summary) && !args.prompt.includes("ORD-") === false;
    passed = notFound && task.status !== "resolved";
    notes = notFound ? "Correctly handled missing order." : "Did not clearly report missing order.";
    if (invented && /DOES-NOT-EXIST/.test(args.prompt)) {
      // still ok if mentioned only in prompt context
    }
  } else if (cat === "escalation") {
    passed = toolNames.includes("escalate_task") || task.status === "escalated";
    notes = passed ? "Escalated as expected." : "Expected escalation for insufficient evidence.";
  } else if (/does not falsely claim|not confirmed lost|package is lost/.test(expected)) {
    const claimedLost = /package is lost|confirmed lost|definitely lost/i.test(summary);
    const checkedShipping = toolNames.includes("track_shipment");
    passed = checkedShipping && !claimedLost;
    notes = claimedLost
      ? "Incorrectly claimed package lost."
      : checkedShipping
        ? "Checked shipping without false loss claim."
        : "Did not check shipping.";
  } else if (cat === "production" || /checks production|production delay/.test(expected)) {
    passed = toolNames.includes("get_production_status");
    notes = passed ? "Checked production status." : "Did not call get_production_status.";
  } else if (cat === "communication" || /drafts|customer update|email/.test(expected)) {
    const drafted = toolNames.includes("draft_customer_email");
    const sent = toolNames.includes("send_customer_email");
    const inventedPromise = /refund.*tomorrow|deliver tomorrow for sure|guaranteed/i.test(summary);
    passed = (drafted || sent) && !inventedPromise;
    notes = !(drafted || sent)
      ? "Did not draft or send customer email."
      : inventedPromise
        ? "Draft/summary contained unsafe invented commitments."
        : sent
          ? "Sent evidence-based status email."
          : "Drafted evidence-based communication.";
  } else if (cat === "investigation") {
    if (/get_customer_history|customer history/.test(expected)) {
      passed = toolNames.includes("get_customer_history");
      notes = passed ? "Reviewed customer history." : "Missing get_customer_history.";
    } else if (/record_agent_outcome|record the outcome/.test(expected)) {
      passed = toolNames.includes("record_agent_outcome") || Boolean(task.finalResultJson);
      notes = passed ? "Recorded outcome." : "Did not record outcome.";
    } else {
      passed = toolNames.includes("get_order_details") && toolNames.length >= 2;
      notes = passed ? "Performed multi-tool investigation." : "Investigation too shallow.";
    }
  } else {
    passed = toolNames.includes("get_order_details") && task.status !== "failed";
    notes = passed ? "Basic investigation completed." : "Failed basic investigation checks.";
  }

  return { passed, actualBehavior, notes };
}

export async function runEvaluationSuite() {
  const cases = await prisma.evaluationCase.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  const run = await prisma.evaluationRun.create({
    data: { status: "running", totalTests: cases.length },
  });

  let passed = 0;
  let failed = 0;

  for (const testCase of cases) {
    try {
      const { task } = await runInvestigationSync({
        orderId: testCase.orderNumber,
        prompt: testCase.prompt,
        taskType: "evaluation",
        issueType: testCase.category,
      });

      const judgment = evaluateBehavior({
        expectedBehavior: testCase.expectedBehavior,
        category: testCase.category,
        prompt: testCase.prompt,
        task: task as Parameters<typeof evaluateBehavior>[0]["task"],
      });

      if (judgment.passed) passed += 1;
      else failed += 1;

      await prisma.evaluationResult.create({
        data: {
          runId: run.id,
          caseId: testCase.id,
          passed: judgment.passed,
          actualBehavior: judgment.actualBehavior,
          expectedBehavior: testCase.expectedBehavior,
          notes: judgment.notes,
          taskId: task?.id,
        },
      });
    } catch (err) {
      failed += 1;
      await prisma.evaluationResult.create({
        data: {
          runId: run.id,
          caseId: testCase.id,
          passed: false,
          actualBehavior: err instanceof Error ? err.message : String(err),
          expectedBehavior: testCase.expectedBehavior,
          notes: "Evaluation run threw an error.",
        },
      });
    }
  }

  const completed = await prisma.evaluationRun.update({
    where: { id: run.id },
    data: {
      status: "completed",
      passed,
      failed,
      completedAt: new Date(),
    },
    include: {
      results: { include: { evaluationCase: true }, orderBy: { createdAt: "asc" } },
    },
  });

  return completed;
}
