# Deskpilot

AI-native IT help desk (working name). Admins describe automations, AI writes them as code, admins test
and publish them; the employee help desk agent can only run **published** automations.

**$0 project:** the default AI provider is a free mock (`LLM_PROVIDER=mock`). No paid APIs.

See [PLAN.md](PLAN.md) for the architecture and build order.

## Setup

Requirements: Node 22+, pnpm 9 (`npm i -g pnpm@9`). Docker Desktop from step 2 on.

```bash
cp .env.example .env     # then set SESSION_SECRET (command is in the file)
pnpm install
pnpm db:setup            # start Postgres in Docker, run migrations, add demo data
pnpm dev                 # web on :3000, worker on :4000
```

Open http://localhost:3000 and sign in with one click as **Ada Admin** (dashboard) or **Eli Employee**
(help desk chat). Demo login only: no passwords in Milestone 1.

The web app reads the repo-root `.env` through `apps/web/scripts/next.mjs`.
Worker health check: http://localhost:4000/health

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js admin dashboard + employee chat |
| `apps/worker` | Workflow sandbox runner + help desk agent (Hono HTTP server) |
| `packages/db` | Drizzle schema, migrations, seed (Postgres 16 + pgvector in Docker) |
| `packages/sdk` | What workflow code may call (`sdk.log`, `sdk.mockDirectory.*`) + the host side that checks every call |
| `packages/llm` | The one AI interface (`getLlm()`), the free mock provider (keyword → template), builder prompt |

## Scripts

`pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` (sandbox safety tests; needs `pnpm db:up`)

Database:

| Script | What |
|---|---|
| `pnpm db:up` / `db:down` | start / stop the Postgres container (data is kept in a Docker volume) |
| `pnpm db:generate` | after editing `packages/db/src/schema.ts`, write a new migration |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:seed` | wipe and re-add demo data (admin@acme.test, employee@acme.test, …) |
| `pnpm db:studio` | browse the database at https://local.drizzle.studio |

## Building a workflow

1. **Workflows → New workflow**, describe it ("Reset a user's password") and click **Generate**.
   The mock provider (`packages/llm/src/mock`) picks the closest template; unknown requests get a starter to edit.
2. Review/edit the code in the Monaco editor (`sdk.` autocompletes) and the input JSON Schema.
3. **Save draft** → the worker checks it (`POST /workflows/check`: compiles under sandbox rules, valid schema),
   then it's stored as a draft workflow with version 1.
4. On the workflow page, pick a version, fill in the **test form** (built from the input schema; "Edit as JSON"
   for raw input) and **Run test**. The result, output and logs show right there; the Mock directory panel shows
   what changed (**Reset** puts it back).
5. **Publish vN** makes that version live for the help desk. Allowed only after that version has a **successful**
   test run (checked on the server). **Unpublish** takes the workflow away from the help desk again.
6. **Edit** saves a **new draft version**. The live version keeps running until you publish the new one.

The editor loads Monaco from the jsDelivr CDN on first use (free, needs internet).

## How a workflow runs

1. Admin clicks **Run test** on a workflow page → web calls the worker (`POST /workflows/:id/test-run`, needs `WORKER_SECRET`).
2. Worker picks the version (help desk runs: **only** the published `current_version_id`; admin test runs: any version),
   checks the inputs against the JSON Schema, and records a `running` row.
3. The TypeScript is compiled (imports are rejected) and run in an `isolated-vm` isolate: 64 MB memory,
   10 s limit, no `require` / `process` / `fetch` / env vars. The only way out is `sdk.*`, checked by `packages/sdk/src/host.ts`.
4. The run row is updated with status, outputs, logs and error; see it on the **Runs** page.

`isolated-vm` is pinned to **6.0.2**: it ships a ready-made Windows build for Node 22 (7.x would need Visual Studio C++ tools).
