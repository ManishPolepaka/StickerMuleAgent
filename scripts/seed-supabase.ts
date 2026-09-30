import { readFileSync } from "fs";
import { spawnSync } from "child_process";

// Clear stale shell DATABASE_URL then load .env for child processes.
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq);
  let value = trimmed.slice(eq + 1);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.env[key] = value;
}

const url = process.env.DATABASE_URL || "";
if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
  console.error("DATABASE_URL is not a Postgres URL. Check .env");
  process.exit(1);
}

console.log("Using Supabase pooler for seed…");
const result = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});
process.exit(result.status ?? 1);
