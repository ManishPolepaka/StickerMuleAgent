/**
 * Clears investigation / agent-run data so Tasks, Triggers, Logs, and Overview
 * start empty — without wiping the demo order/customer catalog.
 *
 * Usage: npx tsx scripts/clear-investigations.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Child rows first where FK is not cascading from AgentTask.
  const steps = await prisma.agentStep.deleteMany();
  const approvals = await prisma.humanApproval.deleteMany();
  const emails = await prisma.simulatedEmail.deleteMany();
  const executions = await prisma.agentExecution.deleteMany();
  const triggers = await prisma.triggerEvent.deleteMany();
  const messages = await prisma.incomingMessage.deleteMany();
  const tasks = await prisma.agentTask.deleteMany();

  // Agent-created support tickets only (keep any seed/manual ones if tagged otherwise).
  const tickets = await prisma.supportTicket.deleteMany({
    where: { createdBy: "order_operations_agent" },
  });

  console.log("Cleared investigation data:");
  console.log({
    tasks: tasks.count,
    executions: executions.count,
    steps: steps.count,
    approvals: approvals.count,
    emails: emails.count,
    triggers: triggers.count,
    messages: messages.count,
    agentTickets: tickets.count,
  });
  console.log("Orders/customers/settings kept. Refresh the Tasks page.");
  console.log("To delete ALL support tickets: npm run db:clear-tickets");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
