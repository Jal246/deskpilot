# Deskpilot

An AI-native IT help desk. IT admins describe an automation in plain words, the builder writes it as
TypeScript, and admins test and publish it. Employees chat with a help desk agent that can answer from the
knowledge base, open tickets, and run automations, but **only published ones, and only on their own account**.

**$0 project:** the default AI provider is a free mock (`LLM_PROVIDER=mock`). No API keys, no paid services.

See [PLAN.md](PLAN.md) for the architecture and build order.

## Quick start

Requirements: Node 22+, pnpm 9 (`npm i -g pnpm@9`), Docker Desktop.

```bash
cp .env.example .env     # then set SESSION_SECRET (the command to generate one is in the file)
pnpm install
pnpm db:setup            # start Postgres in Docker, run migrations, add demo data
pnpm dev                 # web on http://localhost:3000, worker on http://localhost:4000
```

Sign in with one click as **Ada Admin** (dashboard) or **Eli Employee** (help desk chat). Demo login only:
no passwords in Milestone 1.

## Demo script (about 5 minutes)

Start from fresh demo data: `pnpm db:seed`, then restart `pnpm dev` (that also resets the mock directory).
The seed has one published workflow (**Add user to group**) and one draft (**Reset password**).

**1. A draft can't be used by the help desk.**
Sign in as **Eli Employee** → type `I'm locked out of my account`.
Reset password is still a draft, so the agent can't run it and opens a ticket instead.
→ The ticket appears on **Tickets** when you sign in as admin.

**2. Build a workflow from a sentence.**
Sign out, sign in as **Ada Admin** → **Workflows → New workflow** → type `Remove a user from a group` → **Generate**.
Look over the code (type `sdk.` in the editor for autocomplete) → **Save draft**.
Try adding `import fs from "fs"` and saving: it's refused, with the line number.

**3. Test it.**
On the workflow page, fill in the form: email `dana@acme.test`, group `design` → **Run test**.
The result and logs appear under the code; the **Mock directory** panel shows Dana left design.
**Publish v1** was locked until this passing test; now it's enabled.

**4. Publish Reset password and try the chat again.**
Open **Reset password** → test it with `employee@acme.test` → **Publish v1**.
Sign in as **Eli** → `I'm locked out of my account` → the agent offers the workflow and asks
"Shall I go ahead?" → `yes` → you get a temporary password, and the run shows on **Runs** with trigger `helpdesk`.

**5. The other two paths.**
As Eli: `How do I set up the VPN?` → answered from the knowledge base.
`My monitor is broken` → ticket.

**6. New versions don't go live by themselves.**
As admin, **Edit** Reset password, change the log message, **Save as new version**. The page shows v2 as a
draft while employees keep getting v1 until you publish v2.

## How it works

```
 Admin (web) ── builder ──► workflow versions (draft) ── test ──► publish ──► current_version_id
                                                                                   │
 Employee (chat) ──► help desk agent ──► tools: wf_<published>, search_kb, create_ticket
                                              │
                                              ▼
                              worker: runWorkflow (published-only check) ──► isolated-vm sandbox ──► sdk.*
```

### Building a workflow

1. **New workflow**: describe it and click **Generate**. The mock (`packages/llm/src/mock`) picks the closest of
   6 templates; anything else gets a starter to edit by hand.
2. Edit code and input JSON Schema in Monaco (loaded from the jsDelivr CDN on first use).
3. **Save** → the worker checks it (`POST /workflows/check`: compiles under the sandbox rules, valid schema)
   and stores a new **draft version**. Saving never publishes.
4. **Test** with a form generated from the schema ("Edit as JSON" for raw input). Results and logs show inline.
5. **Publish vN** needs a **successful test run of that exact version** (checked on the server).
   **Unpublish** removes it from the help desk.

### The help desk chat

`apps/worker/src/agent` is a small tool-use loop: ask the model → run the tools it picks → give back the
results → repeat (at most 4 rounds, 3 tool calls per round).

| Tool | What it does |
|---|---|
| `wf_<slug>` | one per **published** workflow; runs it with `trigger = helpdesk` |
| `search_kb` | Postgres full-text search over the knowledge base |
| `create_ticket` | opens a ticket (shown on **Tickets**) |

The mock model (`packages/llm/src/mock/helpdesk.ts`): request matches a published workflow → describe it,
ask "Shall I go ahead?", run on yes; question → `search_kb`; nothing found or anything else → `create_ticket`.
A real model would plug in behind the same `LlmProvider` interface (`packages/llm/src/types.ts`).

### How a run works

1. The worker picks the version: help desk runs get **only** the published `current_version_id`; admin test
   runs may pick any version.
2. Inputs are checked against the version's JSON Schema, and a `running` row is recorded.
3. The TypeScript is compiled (imports rejected) and run in an `isolated-vm` isolate. The only way out is
   `sdk.*`, and `packages/sdk/src/host.ts` checks every call and argument.
4. The run row gets status, outputs, logs and error (see **Runs**).

## Safety model

The rules are enforced in code and covered by tests. The prompt is only for good manners.

| Rule | Where | Test |
|---|---|---|
| Help desk runs only published workflows, always the live version | `runner/run-workflow.ts`, `agent/tools.ts` | `run-workflow.test.ts`, `agent/helpdesk.test.ts` |
| Employees act only on their own account (email inputs) | `agent/tools.ts` | `agent/helpdesk.test.ts` |
| Identity comes from the login session; the browser sends only plain chat text | `app/chat/actions.ts`, `agent/helpdesk.ts` | `agent/helpdesk.test.ts`, `app.test.ts` |
| Publishing requires a passing test of that version | `workflows/[id]/actions.ts` | manual |
| No imports / `require` / `process` / `fetch` / env vars / filesystem | `runner/compile.ts`, `runner/sandbox.ts` | `compile.test.ts`, `sandbox.test.ts` |
| 10 s time limit (sync loops and never-ending awaits), 64 MB memory | `runner/sandbox.ts` | `sandbox.test.ts` |
| At most 500 sdk calls and 100 KB of output per run; 4 sandboxes at once | `runner/sandbox.ts` | `sandbox.test.ts` |
| Worker API needs `WORKER_SECRET`; request bodies capped at 1 MB | `apps/worker/src/app.ts` | `app.test.ts` |
| Agent stops after 4 rounds / 3 tool calls per round | `agent/helpdesk.ts` | `agent/helpdesk.test.ts` |

Not production-ready on purpose (Milestone 1): mock login, mock directory, no rate limiting per user.

## Tests

```bash
pnpm db:up     # the worker tests use the local Postgres (each test file makes and deletes its own org)
pnpm test      # llm: mock builder + help desk; worker: compiler, sandbox, runs, agent, HTTP
```

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 admin dashboard + employee chat |
| `apps/worker` | Hono HTTP API: sandbox runner (`runner/`) + help desk agent (`agent/`) |
| `packages/db` | Drizzle schema, migrations, seed (Postgres 16 + pgvector in Docker) |
| `packages/sdk` | What workflow code may call (`sdk.log`, `sdk.mockDirectory.*`) + the host side that checks every call |
| `packages/llm` | The AI interface (`getLlm()`), the free mock provider, prompts for real models later |

## Scripts

`pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test`

| Script | What |
|---|---|
| `pnpm db:up` / `db:down` | start / stop the Postgres container (data is kept in a Docker volume) |
| `pnpm db:generate` | after editing `packages/db/src/schema.ts`, write a new migration |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:seed` | wipe and re-add demo data |
| `pnpm db:studio` | browse the database at https://local.drizzle.studio |

Notes: the web app reads the repo-root `.env` through `apps/web/scripts/next.mjs`. `isolated-vm` is pinned to
**6.0.2** because it ships a ready-made Windows build for Node 22 (7.x would need Visual Studio C++ tools).
