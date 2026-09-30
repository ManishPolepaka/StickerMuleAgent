import { prisma } from "@/lib/db/prisma";
import { createStaticSwrLoader } from "@/lib/cache/swr";

async function loadTriggersInbox() {
  const [triggers, messages] = await Promise.all([
    prisma.triggerEvent.findMany({
      select: {
        id: true,
        type: true,
        source: true,
        status: true,
        routerDecision: true,
        taskId: true,
        createdAt: true,
        task: { select: { taskNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.incomingMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return JSON.parse(JSON.stringify({ triggers, messages })) as {
    triggers: Array<{
      id: string;
      type: string;
      source: string;
      status: string;
      routerDecision: string | null;
      taskId: string | null;
      createdAt: string;
      task: { taskNumber: string } | null;
    }>;
    messages: Array<{
      id: string;
      channel: string;
      fromEmail: string;
      subject: string;
      body: string;
      orderNumber: string | null;
      status: string;
      classification: string | null;
      taskId: string | null;
      createdAt: string;
    }>;
  };
}

const loader = createStaticSwrLoader("triggers:list", loadTriggersInbox, 60_000);

export async function getTriggersInbox() {
  return loader.get();
}

export async function warmTriggersInbox() {
  await loader.warm();
}
