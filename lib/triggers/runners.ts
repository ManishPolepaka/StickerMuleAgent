import { prisma } from "@/lib/db/prisma";
import { startInvestigation } from "@/lib/agent/runtime";
import { publishRealtime } from "@/lib/realtime/events";
import { extractOrderNumber, routeTrigger, type TriggerType } from "@/lib/triggers/router";

async function findActiveTaskForOrder(orderId: string) {
  return prisma.agentTask.findFirst({
    where: {
      orderId,
      status: { in: ["pending", "running", "awaiting_approval"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Clear zombie "running" tasks that never finished (e.g. pool timeout killed the loop). */
async function reclaimStaleRunningTasks(orderId: string) {
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
  await prisma.agentTask.updateMany({
    where: {
      orderId,
      status: "running",
      startedAt: { lt: staleBefore },
    },
    data: {
      status: "failed",
      actionResult: "Timed out while running (connection/pool interrupt). Re-trigger to investigate again.",
      completedAt: new Date(),
    },
  });
}

async function recordAndMaybeStart(args: {
  triggerType: TriggerType;
  source: string;
  payload: Record<string, unknown>;
  orderNumber?: string | null;
  messageId?: string | null;
  subject?: string;
  body?: string;
  shippingStatus?: string;
  productionDelay?: boolean;
  hoursOpen?: number;
}) {
  const decision = routeTrigger({
    triggerType: args.triggerType,
    subject: args.subject,
    body: args.body,
    orderNumber: args.orderNumber,
    shippingStatus: args.shippingStatus,
    productionDelay: args.productionDelay,
    hoursOpen: args.hoursOpen,
  });

  let orderDbId: string | null = null;
  if (decision.orderNumber) {
    const order = await prisma.order.findFirst({
      where: { orderNumber: decision.orderNumber },
      select: { id: true },
    });
    orderDbId = order?.id ?? null;
  }

  if (decision.shouldStartAgent && orderDbId) {
    await reclaimStaleRunningTasks(orderDbId);
    const existing = await findActiveTaskForOrder(orderDbId);
    if (existing) {
      const trigger = await prisma.triggerEvent.create({
        data: {
          type: args.triggerType,
          source: args.source,
          status: "skipped",
          payloadJson: JSON.stringify(args.payload),
          orderId: orderDbId,
          messageId: args.messageId || null,
          taskId: existing.id,
          routerDecision: JSON.stringify({
            ...decision,
            shouldStartAgent: false,
            reason: `Skipped: order already has active investigation ${existing.taskNumber}.`,
            existingTaskId: existing.id,
          }),
        },
      });

      const linkedMessage = args.messageId
        ? await prisma.incomingMessage.update({
            where: { id: args.messageId },
            data: {
              status: "routed",
              classification: decision.classification,
              taskId: existing.id,
              orderNumber: decision.orderNumber,
            },
          })
        : null;

      publishRealtime({
        type: "trigger_processed",
        triggerId: trigger.id,
        triggerType: args.triggerType,
        taskId: existing.id,
        status: "skipped",
      });
      publishRealtime({ type: "dashboard_changed", reason: "trigger_skipped_existing" });
      return {
        trigger,
        task: existing,
        decision: {
          ...decision,
          shouldStartAgent: false,
          reason: `Order already has active investigation ${existing.taskNumber}.`,
        },
        message: linkedMessage,
        skippedExisting: true,
      };
    }
  }

  const trigger = await prisma.triggerEvent.create({
    data: {
      type: args.triggerType,
      source: args.source,
      status: decision.shouldStartAgent ? "routed" : "skipped",
      payloadJson: JSON.stringify(args.payload),
      orderId: orderDbId,
      messageId: args.messageId || null,
      routerDecision: JSON.stringify(decision),
    },
  });

  // Notify UI as soon as routing finishes so Triggers does not sit on "Routing…".
  publishRealtime({
    type: "trigger_processed",
    triggerId: trigger.id,
    triggerType: args.triggerType,
    status: decision.shouldStartAgent ? "routed" : "skipped",
  });

  if (!decision.shouldStartAgent) {
    return { trigger, task: null, decision, message: null };
  }

  const task = await startInvestigation({
    orderId: orderDbId || decision.orderNumber,
    orderDbId,
    prompt: decision.prompt,
    priority: decision.priority,
    issueType: decision.issueType,
    taskType: `auto_${args.triggerType}`,
    triggerType: args.triggerType,
    triggerEventId: trigger.id,
  });

  const [updatedTrigger, updatedMessage] = await Promise.all([
    prisma.triggerEvent.update({
      where: { id: trigger.id },
      data: { status: "agent_started", taskId: task.id },
    }),
    args.messageId
      ? prisma.incomingMessage.update({
          where: { id: args.messageId },
          data: {
            status: "routed",
            classification: decision.classification,
            taskId: task.id,
          },
        })
      : Promise.resolve(null),
  ]);

  publishRealtime({
    type: "trigger_processed",
    triggerId: trigger.id,
    triggerType: args.triggerType,
    taskId: task.id,
    taskNumber: task.taskNumber,
    status: "agent_started",
    summary: `Investigation ${task.taskNumber} started`,
  });
  publishRealtime({ type: "dashboard_changed", reason: "agent_started" });
  publishRealtime({
    type: "task_updated",
    taskId: task.id,
    status: task.status,
    taskNumber: task.taskNumber,
  });

  return { trigger: updatedTrigger, task, decision, message: updatedMessage };
}

/** Customer email/chat/ticket arrives → router → maybe agent */
export async function ingestCustomerMessage(input: {
  channel: "email" | "chat" | "ticket";
  fromEmail: string;
  subject: string;
  body: string;
  orderNumber?: string | null;
  customerId?: string | null;
}) {
  const orderNumber =
    input.orderNumber ||
    extractOrderNumber(`${input.subject} ${input.body}`) ||
    null;

  const message = await prisma.incomingMessage.create({
    data: {
      channel: input.channel,
      fromEmail: input.fromEmail,
      subject: input.subject,
      body: input.body,
      orderNumber,
      customerId: input.customerId || null,
      status: "new",
    },
  });

  const result = await recordAndMaybeStart({
    triggerType: "customer_message",
    source: `inbox:${input.channel}`,
    payload: { messageId: message.id, subject: input.subject, body: input.body },
    orderNumber,
    messageId: message.id,
    subject: input.subject,
    body: input.body,
  });

  if (!result.decision.shouldStartAgent && !result.task) {
    const ignored = await prisma.incomingMessage.update({
      where: { id: message.id },
      data: {
        status: "ignored",
        classification: result.decision.classification,
        orderNumber,
      },
    });
    return {
      message: ignored,
      trigger: result.trigger,
      task: result.task,
      decision: result.decision,
      skippedExisting: false,
    };
  }

  return {
    message:
      result.message || {
        ...message,
        status: "routed",
        classification: result.decision.classification,
        taskId: result.task?.id ?? null,
        orderNumber,
      },
    trigger: result.trigger,
    task: result.task,
    decision: result.decision,
    skippedExisting: Boolean(result.skippedExisting),
  };
}

/** Scan orders past expected delivery that are not delivered */
export async function runLateOrderScan(limit = 5) {
  const now = new Date();
  const lateOrders = await prisma.order.findMany({
    where: {
      expectedDeliveryDate: { lt: now },
      orderStatus: { not: "delivered" },
    },
    orderBy: { expectedDeliveryDate: "asc" },
    take: limit,
  });

  const results = [];
  for (const order of lateOrders) {
    results.push(
      await recordAndMaybeStart({
        triggerType: "late_order",
        source: "scheduler:late_order_scan",
        payload: {
          orderNumber: order.orderNumber,
          expectedDeliveryDate: order.expectedDeliveryDate,
          orderStatus: order.orderStatus,
        },
        orderNumber: order.orderNumber,
        body: `Late order ${order.orderNumber}`,
      }),
    );
  }
  return { scanned: lateOrders.length, results };
}

/** Simulated carrier webhook */
export async function ingestShippingWebhook(input: {
  orderNumber: string;
  status: string;
  eventLabel: string;
  location?: string;
}) {
  const order = await prisma.order.findFirst({ where: { orderNumber: input.orderNumber } });
  if (!order) throw new Error(`Order not found: ${input.orderNumber}`);

  await prisma.shipmentEvent.create({
    data: {
      orderId: order.id,
      trackingNumber: order.trackingNumber,
      carrier: order.shippingCarrier,
      status: input.status,
      eventLabel: input.eventLabel,
      location: input.location || "Unknown",
      eventAt: new Date(),
      estimatedDelivery: order.expectedDeliveryDate,
    },
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { shippingStatus: input.status },
  });

  return recordAndMaybeStart({
    triggerType: "shipping_webhook",
    source: "webhook:simulated_carrier",
    payload: input,
    orderNumber: input.orderNumber,
    shippingStatus: input.status,
    body: input.eventLabel,
  });
}

/** Simulated production delay signal */
export async function ingestProductionDelay(input: {
  orderNumber: string;
  delayReason: string;
}) {
  const order = await prisma.order.findFirst({
    where: { orderNumber: input.orderNumber },
    include: { productionRecords: { take: 1, orderBy: { updatedAt: "desc" } } },
  });
  if (!order) throw new Error(`Order not found: ${input.orderNumber}`);

  if (order.productionRecords[0]) {
    await prisma.productionRecord.update({
      where: { id: order.productionRecords[0].id },
      data: {
        delayReported: true,
        delayReason: input.delayReason,
        stage: "delayed",
      },
    });
  } else {
    await prisma.productionRecord.create({
      data: {
        orderId: order.id,
        stage: "delayed",
        delayReported: true,
        delayReason: input.delayReason,
        startedAt: new Date(),
        estimatedCompletionAt: new Date(Date.now() + 4 * 86400000),
        notes: "Simulated production delay signal",
      },
    });
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { productionStatus: "delayed", orderStatus: "in_production" },
  });

  return recordAndMaybeStart({
    triggerType: "production_delay",
    source: "signal:simulated_production",
    payload: input,
    orderNumber: input.orderNumber,
    productionDelay: true,
    body: input.delayReason,
  });
}

/** Open support tickets older than N hours */
export async function runSlaScan(hours = 4) {
  const cutoff = new Date(Date.now() - hours * 3600000);
  const tickets = await prisma.supportTicket.findMany({
    where: {
      status: "open",
      createdAt: { lt: cutoff },
      orderId: { not: null },
    },
    include: { order: true },
    take: 5,
  });

  const results = [];
  for (const ticket of tickets) {
    if (!ticket.order) continue;
    results.push(
      await recordAndMaybeStart({
        triggerType: "sla_breach",
        source: "scheduler:sla_scan",
        payload: { ticketId: ticket.id, hoursOpen: hours },
        orderNumber: ticket.order.orderNumber,
        hoursOpen: hours,
        body: ticket.description,
      }),
    );
  }
  return { scanned: tickets.length, results };
}

/** Operator bulk: investigate all currently delayed/problematic orders */
export async function runBulkDelayedScan(limit = 8) {
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { issueType: { in: ["production_delay", "stale_tracking", "missing_tracking"] } },
        { orderStatus: { in: ["in_production", "on_hold"] } },
      ],
    },
    take: limit,
    orderBy: { expectedDeliveryDate: "asc" },
  });

  const results = [];
  for (const order of orders) {
    results.push(
      await recordAndMaybeStart({
        triggerType: "bulk_scan",
        source: "operator:bulk_scan",
        payload: { orderNumber: order.orderNumber, issueType: order.issueType },
        orderNumber: order.orderNumber,
      }),
    );
  }
  return { scanned: orders.length, results };
}
