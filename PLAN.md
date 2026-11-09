# Deskpilot — Milestone 1 Plan

> Inspired by the *idea* of AI-native IT help desks; all names, copy and UI are our own.

## The big idea in one picture

```
 IT admin (web dashboard)                         Employee (web chat; Slack in M2)
        │                                                   │
        ▼                                                   ▼
 ┌──────────────────┐   writes code    ┌──────────────┐   asks for help   ┌───────────────────┐
 │  Builder agent   │ ───────────────► │  Workflows   │ ◄──────────────── │  Help desk agent  │
 │  (LLM codegen)   │  draft → test →  │  draft /     │  can ONLY call    │  KB answers,      │
 └──────────────────┘     publish      │  PUBLISHED   │  published ones   │  workflows, ticket│
                                       └──────┬───────┘                   └───────────────────┘
                                              │ runs inside
                                              ▼
                                   ┌─────────────────────┐
                                   │ Sandbox (isolated-vm)│ ── only the SDK is injected
                                   │ no fetch/fs/secrets  │ ── every run logged in DB
                                   └─────────────────────┘
```

**The safety boundary is enforced in code, not in the prompt.** The worker's "run for help desk" path
looks up the workflow by id, checks `status = 'published'`, and always runs `current_version_id`.
The LLM never gets to pick a version or run a draft, no matter what it says.

**Rule: $0 project.** No paid API, service or tool is used unless Jal explicitly approves it first.
The default AI provider is a free **mock** provider; no API key is needed to build or run anything.

---

## 0. Prerequisites (one-time, on this machine)

| Need | Status now | Fix |
|---|---|---|
| Node 22 | ✅ v22.19.0 | — |
| pnpm | ❌ not installed | `corepack enable` then `corepack prepare pnpm@latest --activate` |
| Postgres | ❌ Docker not installed | Install Docker Desktop (free for personal use), then `docker compose up -d` |
| AI model | not needed | `LLM_PROVIDER=mock` (default, free). Real models are optional, later, and only with approval |
| C++ build tools | maybe | Only if `isolated-vm` has no prebuilt binary for Windows/Node 22 (see Risks) |

---

## 1. Folder structure

```
deskpilot/
├─ package.json              # root scripts: dev, build, db:*, lint
├─ pnpm-workspace.yaml       # apps/*, packages/*
├─ turbo.json                # dev/build pipeline
├─ tsconfig.base.json
├─ docker-compose.yml        # postgres:16 (pgvector image so M2 KB search needs no swap)
├─ .env.example              # DATABASE_URL, WORKER_URL, WORKER_SECRET, LLM_MODEL
├─ README.md
├─ PLAN.md
│
├─ apps/
│  ├─ web/                   # Next.js App Router + Tailwind + shadcn/ui  (port 3000)
│  │  ├─ app/
│  │  │  ├─ login/page.tsx                 # pick/enter email → mock session cookie
│  │  │  ├─ (admin)/layout.tsx             # sidebar; admins only
│  │  │  ├─ (admin)/workflows/page.tsx     # list: name, status, last run
│  │  │  ├─ (admin)/workflows/[id]/page.tsx# THE editor (prompt → code → test → publish)
│  │  │  ├─ (admin)/runs/page.tsx          # all runs, filter by workflow/status
│  │  │  ├─ (admin)/runs/[id]/page.tsx     # inputs, outputs, logs, error
│  │  │  ├─ (admin)/tickets/page.tsx       # list + detail drawer with messages
│  │  │  ├─ (admin)/kb/page.tsx            # list + simple create/edit
│  │  │  ├─ chat/page.tsx                  # employee help desk chat
│  │  │  └─ api/
│  │  │     ├─ workflows/generate/route.ts # builder agent → {name, description, code, inputSchema}
│  │  │     ├─ workflows/[id]/versions/route.ts   # save a new version
│  │  │     ├─ workflows/[id]/test-run/route.ts   # proxy → worker (manual trigger, draft OK)
│  │  │     ├─ workflows/[id]/publish/route.ts    # set current_version_id + status=published
│  │  │     └─ chat/route.ts                      # proxy → worker help desk agent
│  │  ├─ components/            # shadcn ui/, CodeEditor (Monaco), RunLogView, JsonForm
│  │  └─ lib/ auth.ts, worker-client.ts
│  │
│  └─ worker/                # Node + TS service (port 4000), Slack bot lives here in M2
│     └─ src/
│        ├─ index.ts                 # small HTTP server, shared-secret auth from web
│        ├─ runner/compile.ts        # TS → JS (typescript.transpileModule), reject imports
│        ├─ runner/sandbox.ts        # isolated-vm: 64MB memory, 10s timeout, SDK bridge
│        ├─ runner/run-workflow.ts   # validate inputs → insert run(running) → execute → update row
│        ├─ agent/helpdesk.ts        # tool-use loop (max N turns)
│        └─ agent/tools.ts           # published workflows → tools, + search_kb, create_ticket
│
└─ packages/
   ├─ db/                    # Drizzle ORM
   │  ├─ src/schema.ts, src/client.ts, src/index.ts
   │  ├─ drizzle.config.ts, migrations/
   │  └─ src/seed.ts         # 1 org, admin@acme.test, employee@acme.test, 3 KB articles, 1 sample workflow
   ├─ sdk/                   # what workflow code can use
   │  ├─ src/types.ts        # the public API (also shown to the LLM + Monaco for autocomplete)
   │  ├─ src/host.ts         # host-side implementation the sandbox calls into
   │  └─ src/integrations/mock-directory.ts  # addUserToGroup, resetPassword, (listGroups)
   └─ llm/                   # the "one small llm interface"
      ├─ src/types.ts        # LLM interface: generateWorkflow(), chatWithTools()
      ├─ src/index.ts        # picks provider from LLM_PROVIDER (default: mock)
      ├─ src/mock/           # FREE default: canned workflows + scripted help desk rules
      └─ src/prompts/        # builder prompt, help desk prompt (used by real providers later)
```

Why a separate `packages/llm`: both `web` (builder) and `worker` (help desk agent) need it, and it keeps
"swap the model" to one file.

**Mock provider (default, $0):**
- *Builder:* matches the admin's prompt to ready-made templates ("reset password", "add to group",
  "add to group + log") and returns real, runnable code + input schema. Unknown prompts get a starter
  template the admin edits in Monaco.
- *Help desk:* simple scripted rules — "locked out / forgot password" → call reset-password tool;
  "add me to <group>" → add-to-group tool; question words → `search_kb`; anything else → `create_ticket`.
  It still goes through the exact same tool-calling path as a real model, so the safety checks are tested.
- Also used by all automated tests, so tests never call any API.

**Real providers (later, only with your OK):** Ollama (free, runs locally, needs RAM, weaker at code) or
a paid API like Anthropic (needs your explicit approval + a spend limit). Adding one = one new file.

---

## 2. Data model (Drizzle, all tables have `org_id` + timestamps)

- `organizations(id, name)`
- `users(id, org_id, email, name, role: admin|agent|employee)`
- `workflows(id, org_id, name, slug, description, status: draft|published|archived, current_version_id)`
- `workflow_versions(id, workflow_id, version_number, code, input_schema jsonb, prompt, created_by, created_at)`
- `workflow_runs(id, workflow_version_id, triggered_by, trigger: helpdesk|manual, inputs, outputs, status: running|succeeded|failed|timed_out, error, logs jsonb[], started_at, finished_at)`
- `tickets(id, org_id, title, description, status: open|in_progress|resolved, requester_id, assignee_id, source: slack|web)`
- `ticket_messages(id, ticket_id, author_id nullable, author_kind: user|agent, body)`
- `kb_articles(id, org_id, title, body)`

Versioning rule: editing a published workflow creates a **new draft version**; the published one keeps
running until you hit Publish again. So employees never hit half-edited code.

---

## 3. How a workflow looks (the contract the LLM writes to)

```ts
// input schema (JSON Schema) is generated alongside, e.g. { email: string, group: string }
export default async function run(input: { email: string; group: string }, sdk: Sdk) {
  sdk.log(`Adding ${input.email} to ${input.group}`);
  await sdk.mockDirectory.addUserToGroup(input.email, input.group);
  return { ok: true, message: `${input.email} added to ${input.group}` };
}
```

- No `import`s allowed — everything comes through `sdk`. The compiler step rejects code with imports.
- Inside the sandbox there is no `fetch`, `process`, `require`, env vars, or filesystem.
- `sdk.*` calls cross the sandbox wall as JSON-only messages to `host.ts`, which does the real work.
- `mockDirectory` keeps a fake directory in memory (users, groups) so tests have visible effects.

---

## 4. Build order (each step ends with `pnpm dev` working + "try this")

| # | Step | You'll be able to… |
|---|---|---|
| 1 ✅ | Monorepo skeleton: pnpm + Turbo, blank Next app, hello-world worker, shared tsconfig | `pnpm dev` → localhost:3000 page + localhost:4000/health |
| 2 ✅ | DB: docker-compose, Drizzle schema, first migration, seed | `pnpm db:studio` and see the seeded org/users |
| 3 ✅ | Web shell: mock login, sidebar layout, read-only Workflows/Runs/Tickets/KB lists, KB create/edit | log in as admin, browse, add a KB article |
| 4 ✅ | SDK + sandbox runner: compile → isolated-vm → record run; seeded sample workflow | trigger a test run, see it on the Runs page with logs |
| 5 ✅ | LLM package (mock provider) + builder: prompt box → generated code + schema → Monaco → save version | type "reset a user's password", get code |
| 6 ✅ | Test run + publish in the editor: auto-built input form from schema, live logs, Publish | full admin loop: describe → test → publish |
| 7 | Help desk chat: agent with published workflows as tools + `search_kb` + `create_ticket` | as employee: "I'm locked out" → it runs reset-password; "my monitor is broken" → ticket |
| 8 | Hardening + README: timeouts/memory tests, nasty-code tests (infinite loop, `process`, imports), demo script | run the full demo from README |

Safety tests in step 4/7 (written as small automated tests):
- infinite loop → `timed_out`, worker stays alive
- `process.env`, `require`, `fetch` → fail
- help desk tries to run a draft workflow → refused by the worker (not just the prompt)
- inputs that don't match the schema → refused before running

---

## 5. Dependencies

Listed in the kickoff (will add): next, react, tailwind, shadcn/ui, turbo, drizzle-orm + drizzle-kit, pg,
isolated-vm, typescript. (`@anthropic-ai/sdk` is NOT added until you approve a paid provider.)

**Small extras I'd like your OK on** (all free, open source):
- `zod` — validating API request bodies and LLM output
- `ajv` — validating workflow inputs against their JSON Schema
- `@monaco-editor/react` — the code editor component
- `tsx` — run the worker in dev with auto-reload
- `hono` — tiny HTTP framework for the worker (alternative: plain `node:http`, more boilerplate)
- `vitest` — tests

No paid services at all. Docker Desktop is free for personal use.

---

## 6. Risks & decisions

- **isolated-vm on Windows.** It's a native module. If no prebuilt binary matches Node 22 on Windows it
  needs Visual Studio C++ Build Tools to compile. Also needs Node flag `--no-node-snapshot` on Node 20+.
  We'll check this in step 4 before building on it. Fallback: run the worker in Docker (Linux) — no
  `node:vm` fallback, since `node:vm` is not a security boundary.
- **Async timeouts.** isolated-vm's timeout only covers sync code; we add a wall-clock timeout around the
  whole run and dispose the isolate on timeout.
- **Auth is mock in M1.** Cookie with user id, dev only. Worker trusts web via `WORKER_SECRET`.
- **Agent confirms before acting.** Help desk agent tells the employee what it's about to do and runs it on
  "yes" (prompt-level UX; the hard boundary is still the published-only check).
- **Model.** `LLM_PROVIDER=mock` by default. Any real provider is opt-in and needs your approval.
- **KB search** in M1 is plain Postgres text search; pgvector embeddings come later.

## Not in Milestone 1
Slack bot, real Okta/Google integrations, approval rules, ticket-history → automation suggestions,
JIT access, onboarding/offboarding journeys, email channel.
