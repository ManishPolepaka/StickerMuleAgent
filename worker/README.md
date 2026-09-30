# Go Agent Worker

Background investigation worker for CommerceOps AI.

## What it does

- Connects to the same **Supabase Postgres** database as the Next.js app
- Exposes health + Supabase validation endpoints
- Runs Order Operations investigations reliably outside the Next.js request lifecycle

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Worker + DB health |
| GET | `/v1/supabase/validate` | Count customers/orders/tasks (connectivity proof) |
| POST | `/v1/tasks/{id}/run` | Run investigation for an existing `AgentTask` |

## Run locally

```bash
# from repo root
cd worker
go run ./cmd/worker
```

Default listen address: `:8080`  
Uses `DIRECT_URL` (preferred) or `DATABASE_URL` from repo `.env`.

## Next.js wiring

Set in `.env`:

```env
AGENT_WORKER_URL=http://127.0.0.1:8080
```

When set, Next creates the task then asks this Go worker to run it.
