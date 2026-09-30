import OpenAI from "openai";

async function main() {
  const client = new OpenAI();
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    max_completion_tokens: 20,
  });
  console.log(
    JSON.stringify({
      requested: process.env.OPENAI_MODEL || "gpt-5-mini",
      model: response.model,
      content: response.choices[0]?.message?.content,
      usage: response.usage,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
