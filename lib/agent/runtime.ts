import { after } from "next/server";
import { prisma, withPrismaRetry } from "@/lib/db/prisma";
import { getModelProvider } from "@/lib/providers";
import type { ProviderMessage } from "@/lib/providers/types";
import { AgentFinalResultSchema, type AgentFinalResult } from "@/lib/providers/types";
import { executeTool, getToolDefinitions } from "@/lib/tools";
import { assertCanRunAgent } from "@/lib/agent/permissions";
import { ensurePendingApproval } from "@/lib/agent/ensure-approval";
import { isRestrictedAction } from "@/lib/agent/permissions";
import { publishRealtime } from "@/lib/realtime/events";
import { cacheInvalidate } from "@/lib/cache/memory";

/**
 * Run work after the HTTP response is sent.
 * Must return a Promise to `after()` so Next keeps the runtime alive until the agent finishes.
 */
function runInBackground(work: () => void | Promise<void>) {
  const run = async () => {
    try {
      console.log("[agent] background loop starting");
      await work();
      console.log("[agent] background loop finished");
    } catch (err) {
      console.error("[agent] Background agent start failed:", err);
      throw err;
    }
  };

  try {
    after(run);
    console.log("[agent] scheduled via next/server after()");
  } catch {
    // Outside a request context (scripts/tests): fire-and-forget.
    console.log("[agent] after() unavailable — using setTimeout fallback");
    setTimeout(() => {
      void run();
    }, 0);
  }
}

const SYSTEM_PROMPT = `You are the Order Operations Agent for CommerceOps AI, a DEMO e-commerce operations platform.
All business data and carrier/production/email integrations are simulated demo systems — never claim they are real Sticker Mule systems.

Your job:
1. Investigate delayed or problematic orders using tools only.
2. Never invent order information, delivery dates, refunds, discounts, or action success.
3. If evidence is insufficient, say so and escalate.
4. AUTO-ALLOWED (do these yourself — do NOT call request_human_approval):
   - Read order / production / shipping / customer history
   - Draft AND send status/update emails via send_customer_email (simulated)
   - Create support tickets
   - Escalate for more evidence
   - Record investigation outcomes
5. RESTRICTED (MUST use request_human_approval — never execute yourself):
   - Refunds, credits, discounts, cancellations, shipping-address changes, compensation promises
6. For normal delivery/status inquiries: investigate → send_customer_email with a verified update → record_agent_outcome with finalTaskStatus "resolved" and approvalRequired false.
7. Customer copy rules: write findings and emails in plain language. Never put snake_case codes (not_shipped, in_production) or ISO timestamps (2026-10-04T09:03:39.144Z) in customer emails — say "has not shipped yet" and "October 4, 2026" instead.
8. SPEED: When tools are independent, call several in ONE turn (e.g. get_production_status + track_shipment together). Prefer the shortest path: investigate → send_customer_email → record_agent_outcome.
9. Prefer verified tool results. Always call record_agent_outcome before finishing.
10. CRITICAL: Your FINAL assistant message (after tools) must be ONLY a single raw JSON object — no markdown, no headings, no bullet lists, no code fences. Exact shape:
{
  "problemIdentified": string,
  "evidenceCollected": string[],
  "investigationSummary": string,
  "rootCause": string|null,
  "proposedOrCompletedAction": string,
  "approvalRequired": boolean,
  "customerResponse": string|null,
  "remainingRisks": string[],
  "finalTaskStatus": "resolved"|"awaiting_approval"|"escalated"|"failed"|"needs_human"
}`;

function normalizeFinalResult(
  result: AgentFinalResult,
  toolNames: string[],
  pausedForApproval: boolean,
): AgentFinalResult {
  // Only pause for humans when a restricted action was actually gated.
  if (pausedForApproval || toolNames.includes("request_human_approval")) {
    return {
      ...result,
      approvalRequired: true,
      finalTaskStatus: "awaiting_approval",
    };
  }
  if (
    result.approvalRequired ||
    result.finalTaskStatus === "awaiting_approval"
  ) {
    const proposesRestricted = isRestrictedAction(result.proposedOrCompletedAction || "");
    if (!proposesRestricted) {
      return {
        ...result,
        approvalRequired: false,
        finalTaskStatus:
          result.finalTaskStatus === "awaiting_approval" ? "resolved" : result.finalTaskStatus,
      };
    }
  }
  return result;
}

function titleForTool(name: string) {
  const map: Record<string, string> = {
    get_order_details: "Retrieved order details",
    get_production_status: "Checked production status",
    track_shipment: "Checked shipment tracking",
    get_customer_history: "Reviewed customer history",
    create_support_ticket: "Created support ticket",
    draft_customer_email: "Drafted customer response",
    send_customer_email: "Sent simulated customer email",
    request_human_approval: "Requested human approval",
    escalate_task: "Escalated task",
    record_agent_outcome: "Recorded agent outcome",
  };
  return map[name] || `Called ${name}`;
}

async function nextTaskNumber() {
  const count = await prisma.agentTask.count();
  return `TASK-${1000 + count + 1}`;
}

function tryParseFinal(content: string | null): AgentFinalResult | null {
  if (!content) return null;

  const candidates: string[] = [];
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Prefer the largest JSON-looking object in the text.
  const allObjects = content.match(/\{[\s\S]*\}/g);
  if (allObjects) {
    candidates.push(...[...allObjects].sort((a, b) => b.length - a.length));
  }
  candidates.push(content.trim());

  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw);
      const result = AgentFinalResultSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function sectionFromProse(content: string, label: string): string | null {
  const re = new RegExp(
    `(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*(?:\\*\\*)?(?:Problem Identified|Evidence Collected|Investigation Summary|Root Cause|Proposed|Approval|Customer Response|Remaining Risks|Final Task Status|$)|(?=$))`,
    "i",
  );
  const match = content.match(re);
  if (!match?.[1]) return null;
  return match[1].replace(/\*\*/g, "").trim();
}

/** Build a structured result when the model returns prose instead of JSON. */
function synthesizeFinalFromRun(args: {
  content: string | null;
  toolNames: string[];
  toolResultSnippets: string[];
}): AgentFinalResult | null {
  const { content, toolNames, toolResultSnippets } = args;
  const joined = `${content || ""}\n${toolResultSnippets.join("\n")}`.toLowerCase();

  const recorded = toolNames.includes("record_agent_outcome");
  const investigated =
    toolNames.includes("get_order_details") &&
    (toolNames.includes("get_production_status") || toolNames.includes("track_shipment"));

  if (!investigated && !content) return null;

  const delay =
    joined.includes("delay") ||
    joined.includes("delayed") ||
    joined.includes("material shortage") ||
    joined.includes("print_queue");
  const escalated = toolNames.includes("escalate_task");
  const approval = toolNames.includes("request_human_approval");

  const problemFromProse = content ? sectionFromProse(content, "Problem Identified") : null;
  const summaryFromProse = content ? sectionFromProse(content, "Investigation Summary") : null;
  const rootFromProse = content ? sectionFromProse(content, "Root Cause") : null;
  const actionFromProse = content
    ? sectionFromProse(content, "Proposed or Completed Action") ||
      sectionFromProse(content, "Proposed Action")
    : null;

  const evidence: string[] = [];
  if (toolNames.includes("get_order_details")) evidence.push("Order details retrieved from database");
  if (toolNames.includes("get_production_status")) {
    evidence.push(
      delay
        ? "Production delay confirmed via simulated production system"
        : "Production status checked",
    );
  }
  if (toolNames.includes("track_shipment")) evidence.push("Shipment/tracking checked via simulated carrier");
  if (toolNames.includes("create_support_ticket")) evidence.push("Support ticket created");
  if (toolNames.includes("draft_customer_email")) evidence.push("Customer email drafted from verified findings");
  if (toolNames.includes("send_customer_email")) evidence.push("Simulated status email sent to customer");

  // Pull a few concrete lines from prose bullets if present.
  if (content) {
    for (const line of content.split("\n")) {
      const cleaned = line.replace(/^[-*•]\s*/, "").trim();
      if (cleaned.length > 20 && cleaned.length < 220 && /order|production|shipping|delay|ticket/i.test(cleaned)) {
        evidence.push(cleaned.replace(/\*\*/g, ""));
      }
      if (evidence.length >= 8) break;
    }
  }

  if (approval) {
    return {
      problemIdentified: problemFromProse || "Restricted action requires approval",
      evidenceCollected: evidence.length ? evidence : ["Approval requested after investigation"],
      investigationSummary:
        summaryFromProse || "Investigation complete; restricted action awaiting human approval.",
      rootCause: rootFromProse || null,
      proposedOrCompletedAction: actionFromProse || "Requested human approval",
      approvalRequired: true,
      customerResponse: null,
      remainingRisks: ["Action not executed until approved"],
      finalTaskStatus: "awaiting_approval",
    };
  }

  if (escalated) {
    return {
      problemIdentified: problemFromProse || "Issue requires human follow-up",
      evidenceCollected: evidence,
      investigationSummary: summaryFromProse || content?.slice(0, 500) || "Escalated after investigation.",
      rootCause: rootFromProse || null,
      proposedOrCompletedAction: actionFromProse || "Escalated to human support",
      approvalRequired: false,
      customerResponse: null,
      remainingRisks: ["Needs human review"],
      finalTaskStatus: "escalated",
    };
  }

  if (investigated || recorded || (content && content.length > 80)) {
    return {
      problemIdentified:
        problemFromProse ||
        (delay ? "Order delayed in production" : "Order operations issue investigated"),
      evidenceCollected: evidence.length ? [...new Set(evidence)].slice(0, 10) : ["Tool-based investigation completed"],
      investigationSummary:
        summaryFromProse ||
        content?.replace(/\*\*/g, "").slice(0, 800) ||
        "Investigation completed using application tools.",
      rootCause:
        rootFromProse ||
        (delay ? "Production delay reported (e.g. material shortage / queue delay)" : null),
      proposedOrCompletedAction:
        actionFromProse ||
        (toolNames.includes("send_customer_email")
          ? "Sent simulated customer status email from verified evidence"
          : toolNames.includes("draft_customer_email")
            ? "Drafted customer update from verified evidence"
            : toolNames.includes("create_support_ticket")
              ? "Created support ticket and documented findings"
              : "Documented investigation findings"),
      approvalRequired: false,
      customerResponse: toolNames.includes("send_customer_email")
        ? "Simulated status email sent from verified findings"
        : toolNames.includes("draft_customer_email")
          ? "Draft email prepared from verified findings"
          : null,
      remainingRisks: delay
        ? ["Delivery date may still slip if production remains delayed"]
        : [],
      finalTaskStatus: "resolved",
    };
  }

  return null;
}

export type StartInvestigationInput = {
  orderId?: string | null;
  /** When already resolved, skip a second order lookup. */
  orderDbId?: string | null;
  prompt: string;
  taskType?: string;
  priority?: string;
  issueType?: string | null;
  triggerType?: string | null;
  triggerEventId?: string | null;
};

export async function startInvestigation(input: StartInvestigationInput) {
  assertCanRunAgent();

  const [settings, order, taskCount] = await Promise.all([
    prisma.agentSettings.findUnique({ where: { id: "default" } }),
    input.orderDbId
      ? Promise.resolve(null)
      : input.orderId
        ? prisma.order.findFirst({
            where: { OR: [{ orderNumber: input.orderId }, { id: input.orderId }] },
          })
        : Promise.resolve(null),
    prisma.agentTask.count(),
  ]);

  if (settings && !settings.agentEnabled) {
    throw new Error("Order Operations Agent is disabled in settings.");
  }

  const orderDbId = input.orderDbId ?? order?.id ?? null;
  const issueType = input.issueType ?? order?.issueType ?? null;

  const task = await prisma.agentTask.create({
    data: {
      taskNumber: `TASK-${1000 + taskCount + 1}`,
      taskType: input.taskType || "delayed_order_investigation",
      issueType,
      orderId: orderDbId,
      prompt: input.prompt,
      status: "running",
      priority: input.priority || "medium",
      triggerType: input.triggerType || "manual",
      triggerEventId: input.triggerEventId || null,
      startedAt: new Date(),
    },
  });

  publishRealtime({
    type: "task_updated",
    taskId: task.id,
    status: task.status,
    taskNumber: task.taskNumber,
  });
  publishRealtime({ type: "dashboard_changed", reason: "task_created" });
  cacheInvalidate("tasks:");
  cacheInvalidate("dashboard:");

  // Detach from the request so /api/triggers returns before the OpenAI loop.
  runInBackground(async () => {
    try {
      await runAgentLoop(task.id);
    } catch (err) {
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: "failed",
          actionResult: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        },
      });
      publishRealtime({
        type: "task_updated",
        taskId: task.id,
        status: "failed",
        taskNumber: task.taskNumber,
      });
      publishRealtime({ type: "dashboard_changed", reason: "task_failed" });
    }
  });

  return task;
}

export async function runAgentLoop(taskId: string) {
  const task = await prisma.agentTask.findUnique({
    where: { id: taskId },
    include: { order: true },
  });
  if (!task) throw new Error("Task not found");

  const settings = (await prisma.agentSettings.findUnique({ where: { id: "default" } })) || {
    provider: process.env.OPENAI_API_KEY ? "openai" : "simulated",
    modelName: process.env.OPENAI_MODEL || "gpt-5-mini",
    maxIterations: 12,
    executionTimeoutMs: 120000,
  };

  const provider = getModelProvider(settings.provider);
  const modelName =
    provider.isSimulated
      ? "simulated-order-ops-v1"
      : settings.modelName || process.env.OPENAI_MODEL || "gpt-5-mini";

  const execution = await prisma.agentExecution.create({
    data: {
      taskId: task.id,
      agentName: "Order Operations Agent",
      modelProvider: provider.id,
      modelName,
      inputSummary: task.prompt.slice(0, 500),
      status: "running",
    },
  });

  let stepIndex = 0;
  const addStep = async (data: {
    stepType: string;
    title: string;
    detail?: string;
    toolName?: string;
    toolInputJson?: string;
    toolResultJson?: string;
    status?: string;
  }) => {
    stepIndex += 1;
    const step = await withPrismaRetry(() =>
      prisma.agentStep.create({
        data: {
          executionId: execution.id,
          stepIndex,
          ...data,
          status: data.status || "completed",
        },
      }),
    );
    publishRealtime({
      type: "step_added",
      taskId: task.id,
      executionId: execution.id,
      step: {
        id: step.id,
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        title: step.title,
        detail: step.detail,
        toolName: step.toolName,
        toolInputJson: step.toolInputJson,
        toolResultJson: step.toolResultJson,
        status: step.status,
        createdAt: step.createdAt.toISOString(),
      },
    });
    return step;
  };

  const emitTaskStatus = (status: string) => {
    publishRealtime({
      type: "task_updated",
      taskId: task.id,
      status,
      taskNumber: task.taskNumber,
    });
    // Avoid dashboard SSE storms during the loop; only notify on terminal-ish updates.
    if (status !== "running") {
      publishRealtime({ type: "dashboard_changed", reason: `task_${status}` });
    }
  };

  await addStep({
    stepType: "lifecycle",
    title: "Investigation started",
    detail: `Provider: ${provider.displayName}${provider.isSimulated ? " (demo)" : ""}`,
  });

  const orderHint = task.order?.orderNumber
    ? `Related order: ${task.order.orderNumber}.`
    : "";

  const messages: ProviderMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${task.prompt}\n\n${orderHint}\nInternal taskId for tools that need it: ${task.id} (you may pass "CURRENT" as taskId).`,
    },
  ];

  const started = Date.now();
  const timeoutMs = settings.executionTimeoutMs || 120000;
  const maxIterations = settings.maxIterations || 12;
  let promptTokens = 0;
  let completionTokens = 0;
  let estimatedCost = 0;
  let pauseForApproval = false;
  let finalResult: AgentFinalResult | null = null;
  const usedToolNames: string[] = [];
  const toolResultSnippets: string[] = [];

  try {
    console.log(`[agent] loop start task=${task.taskNumber} provider=${provider.id} model=${modelName}`);
    for (let i = 0; i < maxIterations; i++) {
      if (Date.now() - started > timeoutMs) {
        throw new Error("Agent execution timed out.");
      }

      console.log(`[agent] iteration ${i + 1}/${maxIterations}`);
      const response = await provider.complete({
        model: modelName,
        messages,
        tools: getToolDefinitions(),
      });
      console.log(
        `[agent] model response finish=${response.finishReason} tools=${response.toolCalls?.length || 0}`,
      );

      if (response.usage) {
        promptTokens += response.usage.promptTokens;
        completionTokens += response.usage.completionTokens;
        estimatedCost += response.estimatedCostUsd || 0;
      }

      if (response.toolCalls.length) {
        messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // Log call steps, then execute independent tools in parallel (faster).
        for (const call of response.toolCalls) {
          usedToolNames.push(call.name);
          console.log(`[agent] tool ${call.name}`);
          await addStep({
            stepType: "tool_call",
            title: titleForTool(call.name),
            toolName: call.name,
            toolInputJson: JSON.stringify(call.arguments),
            detail: `Calling ${call.name}`,
          });
        }

        const settled = await Promise.all(
          response.toolCalls.map(async (call) => {
            const result = await executeTool(call.name, call.arguments, {
              taskId: task.id,
              executionId: execution.id,
              actorRole: "agent",
            });
            console.log(`[agent] tool ${call.name} -> ${result.ok ? "ok" : "error"}`);
            return { call, result };
          }),
        );

        for (const { call, result } of settled) {
          toolResultSnippets.push(JSON.stringify(result).slice(0, 500));

          await addStep({
            stepType: "tool_result",
            title: `${titleForTool(call.name)} — result`,
            toolName: call.name,
            toolResultJson: JSON.stringify(result).slice(0, 8000),
            detail: result.ok ? "Tool succeeded" : result.error,
            status: result.ok ? "completed" : "error",
          });

          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify(result),
          });

          if (
            call.name === "request_human_approval" &&
            result.ok &&
            (result.data as { pauseExecution?: boolean })?.pauseExecution
          ) {
            pauseForApproval = true;
            const approvalId = (result.data as { approvalId?: string })?.approvalId;
            if (approvalId) {
              publishRealtime({
                type: "approval_requested",
                taskId: task.id,
                approvalId,
              });
            }
            emitTaskStatus("awaiting_approval");
          }

          if (call.name === "get_production_status" && result.ok) {
            const data = result.data as { delayReported?: boolean };
            if (data.delayReported) {
              await addStep({
                stepType: "decision",
                title: "Identified a production delay",
                detail: "Production tool reported a delay.",
              });
            }
          }
        }

        if (pauseForApproval) {
          finalResult = {
            problemIdentified: "Restricted action requires approval",
            evidenceCollected: ["Approval request created"],
            investigationSummary: "Agent paused for human approval.",
            rootCause: null,
            proposedOrCompletedAction: "Awaiting approval",
            approvalRequired: true,
            customerResponse: null,
            remainingRisks: ["Action not executed"],
            finalTaskStatus: "awaiting_approval",
          };
          break;
        }
        continue;
      }

      messages.push({ role: "assistant", content: response.content });
      finalResult =
        tryParseFinal(response.content) ||
        synthesizeFinalFromRun({
          content: response.content,
          toolNames: usedToolNames,
          toolResultSnippets,
        });
      await addStep({
        stepType: "decision",
        title: "Investigation completed",
        detail: response.content?.slice(0, 2000) || "No content",
      });
      break;
    }

    if (!finalResult) {
      finalResult =
        synthesizeFinalFromRun({
          content: null,
          toolNames: usedToolNames,
          toolResultSnippets,
        }) || {
          problemIdentified: "Incomplete investigation",
          evidenceCollected: [],
          investigationSummary: "Agent stopped without a structured final result.",
          rootCause: null,
          proposedOrCompletedAction: "Escalate for review",
          approvalRequired: false,
          customerResponse: null,
          remainingRisks: ["Incomplete agent run"],
          finalTaskStatus: "needs_human",
        };
    }

    finalResult = normalizeFinalResult(finalResult, usedToolNames, pauseForApproval);

    if (finalResult.finalTaskStatus === "needs_human") {
      await prisma.agentTask.update({
        where: { id: task.id },
        data: { status: "needs_human" },
      });
      emitTaskStatus("needs_human");
    }

    const durationMs = Date.now() - started;
    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: pauseForApproval ? "awaiting_approval" : "completed",
        outputSummary: finalResult.investigationSummary,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: estimatedCost,
        durationMs,
        completedAt: new Date(),
      },
    });

    const existing = await prisma.agentTask.findUnique({ where: { id: task.id } });
    if (existing && !["awaiting_approval", "escalated", "resolved"].includes(existing.status)) {
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: finalResult.finalTaskStatus,
          investigationSummary: finalResult.investigationSummary,
          reasoningSummary: finalResult.problemIdentified,
          selectedAction: finalResult.proposedOrCompletedAction,
          requiresHumanApproval: finalResult.approvalRequired,
          finalResultJson: JSON.stringify(finalResult),
          completedAt: finalResult.finalTaskStatus === "awaiting_approval" ? null : new Date(),
        },
      });
      emitTaskStatus(finalResult.finalTaskStatus);
    } else if (existing) {
      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          investigationSummary: finalResult.investigationSummary,
          reasoningSummary: finalResult.problemIdentified,
          finalResultJson: JSON.stringify(finalResult),
        },
      });
      emitTaskStatus(existing.status);
    }

    // Only create/backfill approval rows for real restricted-action pauses.
    if (pauseForApproval || usedToolNames.includes("request_human_approval")) {
      await ensurePendingApproval(task.id);
      emitTaskStatus("awaiting_approval");
      publishRealtime({
        type: "approval_requested",
        taskId: task.id,
        approvalId: "ensured",
      });
    }

    cacheInvalidate("tasks:");
    cacheInvalidate("dashboard:");

    return { executionId: execution.id, result: finalResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await addStep({
      stepType: "error",
      title: "Agent error",
      detail: message,
      status: "error",
    });
    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "failed",
        errorMessage: message,
        durationMs: Date.now() - started,
        completedAt: new Date(),
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: estimatedCost,
      },
    });
    await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: "failed", actionResult: message, completedAt: new Date() },
    });
    emitTaskStatus("failed");
    throw err;
  }
}

/** Synchronous run used by evaluations — waits for completion. */
export async function runInvestigationSync(input: StartInvestigationInput) {
  assertCanRunAgent();
  const settings = await prisma.agentSettings.findUnique({ where: { id: "default" } });
  if (settings && !settings.agentEnabled) {
    throw new Error("Order Operations Agent is disabled in settings.");
  }

  let orderDbId: string | null = null;
  let issueType = input.issueType ?? null;
  if (input.orderId) {
    const order = await prisma.order.findFirst({
      where: { OR: [{ orderNumber: input.orderId }, { id: input.orderId }] },
    });
    if (order) {
      orderDbId = order.id;
      issueType = issueType || order.issueType;
    }
  }

  const task = await prisma.agentTask.create({
    data: {
      taskNumber: await nextTaskNumber(),
      taskType: input.taskType || "evaluation",
      issueType,
      orderId: orderDbId,
      prompt: input.prompt,
      status: "running",
      priority: input.priority || "medium",
      startedAt: new Date(),
    },
  });

  const result = await runAgentLoop(task.id);
  const fresh = await prisma.agentTask.findUnique({
    where: { id: task.id },
    include: {
      executions: { include: { steps: true }, orderBy: { createdAt: "desc" }, take: 1 },
      approvals: true,
    },
  });
  return { task: fresh, ...result };
}
