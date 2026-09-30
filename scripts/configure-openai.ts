import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const settings = await prisma.agentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      provider: "openai",
      modelName: process.env.OPENAI_MODEL || "gpt-5-mini",
      agentEnabled: true,
    },
    update: {
      provider: "openai",
      modelName: process.env.OPENAI_MODEL || "gpt-5-mini",
      agentEnabled: true,
    },
  });
  console.log(
    JSON.stringify({
      provider: settings.provider,
      modelName: settings.modelName,
      agentEnabled: settings.agentEnabled,
      hasKey: Boolean(process.env.OPENAI_API_KEY),
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
