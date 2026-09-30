# CommerceOps AI

A working demo of an AI ops agent for e-commerce order problems (delays, shipping, customer updates).

This is a **capability sample** — one slice of a larger ops pipeline — not a claim that Sticker Mule’s production systems were rebuilt. It shows how an agent can investigate issues with tools, take safe actions, and ask a human only when needed.

> **Important:** This is a fictional demo product. All business data, production status, shipping carriers, and email delivery are **simulated**. It does **not** connect to Sticker Mule (or any real) internal systems.

---

## What this shows

Something happens → agent investigates → takes safe actions → asks a human only when needed → leaves a clear audit trail.

- **Multiple ways to start the agent** — not only a manual **Run investigation** click. It can also start from triggers such as a simulated **customer email**, late-order scan, shipping webhook, production delay, or bulk scan (**Triggers & Inbox**).
- **Status updates:** agent can send a simulated customer email directly (plain language, no technical codes)
- **Restricted actions:** refunds, credits, cancellations, address changes, and compensation always need human approval
- **Operators:** live task timeline, approvals, tickets, triggers, and evaluations

---

## Try the demo (quick walkthrough)

After `npm run dev` and opening the app:

### A) Start from a trigger (recommended — shows the real pipeline)

1. Open **Triggers & Inbox**.
2. Try one of these (each can start the agent automatically):
   - **Customer message / email** — paste a status question or refund request about an order (e.g. ORD-1000)
   - **Late order scan** / **Production delay** / **Shipping webhook** / **Bulk scan**
3. Open **Tasks & Investigations** → click the new task while it is **Running**.
4. Watch the **timeline** live: each step is a tool call (order lookup, production, shipping, email, etc.).
5. When it finishes:
   - **Status / delivery case** → task resolves and a **simulated customer email** is stored.
   - **Refund / cancel / address case** → task waits for **human approval** → Approve or Reject on the task.

You do **not** need to click **Run investigation** for these — the trigger starts the agent.

### B) Start manually (optional)

1. Go to **AI Agents** → **Run investigation** (or start from an **Order**).
2. Pick a seeded order such as **ORD-1000** / **ORD-1001**.
3. Follow the same task timeline steps as above.

Also useful: **Orders**, **Support Tickets**, **Agent Activity Logs**, **Evaluations**, **Settings**.

**Tip:** The task detail page is the best place to see *what the agent did* and *why*.

---

## Demo vs real production

| Area | In this demo (now) | In real production |
|------|--------------------|--------------------|
| Customer email in | Simulated inbox on **Triggers & Inbox** | Real mailbox / helpdesk webhook (Zendesk, Intercom, Gmail, etc.) |
| Order / production / shipping data | Seeded demo database + fake integrations | Live order DB, manufacturing systems, carrier APIs |
| Agent reply email | Saved as **simulated** email in the app (not sent to a real inbox) | Real send/reply via SES, SendGrid, or helpdesk reply API |
| Human approval | In-app Approve / Reject on restricted actions | Same idea — ops queue, Slack, or ticket workflow before money/address changes |
| Triggers | Buttons that simulate events | Webhooks + scheduled jobs from real systems |
| Models | OpenAI and/or Simulated LLM fallback | Chosen models (OpenAI, Claude, Grok, open source) with cost/latency controls |
| Scope | **One** Order Operations agent (pipeline slice) | Several agents across departments, with owners, metrics, and retire rules |

**Same in both:** tool-using investigation, no invented facts, auto-allowed status updates, human gate for refunds/credits/cancels/address/compensation, full audit trail.

---

## Frontend

- Dashboard for tasks, approvals, orders, tickets, triggers, logs, and settings
- Live updates while the agent runs (timeline updates in real time)
- Clear operator UI: what the agent found, what it did, and when a human must approve

## Backend

- APIs for tasks, approvals, orders, triggers, evaluations, and realtime events
- Agent runtime that calls tools in a loop (look up order, check production/shipping, draft/send status email, escalate, request approval)
- Safety rules: status emails can go automatically; restricted commercial actions pause for a human
- Database for orders, customers, tasks, emails, tickets, and audit steps

## Architecture / pipeline

1. Signal comes in from **one of several triggers** (customer email/message, late order, shipping event, production delay, bulk scan) — or from a manual **Run investigation**
2. Router decides if an agent should start
3. Agent investigates using tools only (does not invent facts)
4. Agent acts: status email / ticket / escalate, or pause for approval on restricted actions
5. Result is recorded and shown to operators
6. Evaluations check whether the agent behaved correctly

**Manual run is only one entry point.** In day-to-day use (and in real production), the agent is meant to wake up from events — especially inbound email — without an operator clicking every time.

In a real company, those events would often arrive as **webhooks** from email/helpdesk or shipping systems. In this demo, the same idea is shown with buttons on **Triggers & Inbox**.

## Tech stack

- TypeScript, Next.js 15 (App Router), React, Tailwind CSS, shadcn/ui
- **Go agent worker** (`worker/`) for reliable background investigations
- Postgres via Prisma / Supabase
- OpenAI for the Node agent path, with Simulated LLM fallback; Go worker uses a deterministic simulated tool loop
- Realtime via Server-Sent Events (SSE)
- Zod validation, Vitest tests
- Recharts, Lucide

### Go worker

```bash
cd worker
go run ./cmd/worker
# health: http://127.0.0.1:8080/health
# supabase check: http://127.0.0.1:8080/v1/supabase/validate
```

Set `AGENT_WORKER_URL=http://127.0.0.1:8080` in `.env` so Next delegates runs to Go.

---

## Quick start

```bash
npm install
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Local: `file:./dev.db`. Later: Supabase Postgres URL |
| `DIRECT_URL` | Optional Supabase direct URL for migrations |
| `OPENAI_API_KEY` | OpenAI key (optional — Simulated LLM used if empty) |
| `OPENAI_MODEL` | Default `gpt-5-mini` (set `gpt-5-nano` for cheaper/faster) |
| `DEMO_ADMIN_ROLE` | `admin` (default), `operator`, or `viewer` |

### Switch to Supabase (PostgreSQL)

1. Create a Supabase project and open **Connect → Direct connection string** (or ORM → Prisma).
2. Put URLs in `.env` (encode special password chars: `@` → `%40`):

```env
DATABASE_URL="postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres?sslmode=require"
```

On Windows, prefer the **pooler** host for both (direct `db.*` often needs IPv6).

3. Prisma is already set to `provider = "postgresql"`.
4. Run:

```bash
npx prisma db push
npx tsx scripts/seed-supabase.ts
npm run dev
```

If seed fails with sqlite/`file:` URL errors, clear a stale shell env: `Remove-Item Env:DATABASE_URL` (PowerShell), then retry.

## Automatic triggers (real-time)

Open **Triggers & Inbox** (`/triggers`) to simulate:

| Trigger | What it does |
|---------|----------------|
| Customer message | Inbox → rule router → starts agent if order-ops related |
| Late order scan | Finds orders past expected delivery |
| Shipping webhook | Carrier exception → agent (routine updates skipped) |
| Production delay | Production signal → agent |
| Bulk scan | Operator batch of problem orders |

Live updates use **Server-Sent Events** (`/api/realtime/...`). Timeline and dashboard refresh as the agent writes steps — no polling.

Router decides **whether** to start the agent; OpenAI/Simulated LLM decides **how** to investigate.

## Agent tools

`get_order_details`, `get_production_status`, `track_shipment`, `get_customer_history`, `create_support_ticket`, `draft_customer_email`, `send_customer_email` (simulated), `request_human_approval`, `escalate_task`, `record_agent_outcome`

## Scripts

```bash
npm run dev          # development server
npm run build        # production build
npm run test         # unit tests
npm run db:seed      # reseed demo data
npm run db:reset     # reset + seed
```

## Deploy notes

- Configuration via environment variables
- Modular agent/tools/providers for future workers
- Stateless Next.js app suitable for Netlify / container deploy
- Background worker extraction point: `lib/agent/runtime.ts` (`startInvestigation` currently runs in-process)

## License

Demo / portfolio project — capability sample for AI agent ops work.
