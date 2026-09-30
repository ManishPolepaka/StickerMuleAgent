/**
 * Deletes all support tickets (agent + seed). Does not delete orders/customers/tasks.
 *
 * Usage: npm run db:clear-tickets
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tickets = await prisma.supportTicket.deleteMany();
  console.log(`Cleared ${tickets.count} support ticket(s). Refresh Support Tickets.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
