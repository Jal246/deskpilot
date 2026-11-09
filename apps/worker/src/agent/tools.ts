// What the help desk agent can do, and the code-level rules around it:
//   - Workflow tools are built ONLY from published workflows. Each tool name maps to a
//     workflow id on the server; the model never sees or chooses ids or versions.
//   - Running goes through runWorkflow(trigger "helpdesk"), which re-checks "published"
//     and always uses current_version_id.
//   - Own account only: any *email* input must be the employee's own email.
//   - search_kb (Postgres full-text search) and create_ticket.
import { and, db, desc, eq, isNotNull, kbArticles, sql, ticketMessages, tickets, workflows, workflowVersions } from "@deskpilot/db";
import type { ToolCall, ToolDef } from "@deskpilot/llm";
import type { HostDeps } from "@deskpilot/sdk";
import { runWorkflow } from "../runner/run-workflow";

export type AgentUser = { id: string; name: string; email: string };
export type AgentContext = { orgId: string; user: AgentUser; deps: HostDeps };

/** What happened, for the chat UI (shown as small chips under the reply). */
export type AgentEvent =
  | { type: "workflow"; workflowName: string; status: "succeeded" | "failed" | "timed_out" | "refused"; runId?: string }
  | { type: "kb"; titles: string[] }
  | { type: "ticket"; ticketId: string; title: string };

export type ToolOutcome = { result: Record<string, unknown>; event?: AgentEvent };

export type Toolbox = { defs: ToolDef[]; execute(call: ToolCall): Promise<ToolOutcome> };

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 4_000;

export async function loadToolbox(ctx: AgentContext): Promise<Toolbox> {
  const published = await db
    .select({
      id: workflows.id,
      name: workflows.name,
      slug: workflows.slug,
      description: workflows.description,
      inputSchema: workflowVersions.inputSchema,
    })
    .from(workflows)
    .innerJoin(
      workflowVersions,
      and(eq(workflows.currentVersionId, workflowVersions.id), eq(workflowVersions.workflowId, workflows.id)),
    )
    .where(and(eq(workflows.orgId, ctx.orgId), eq(workflows.status, "published"), isNotNull(workflows.currentVersionId)));

  const byTool = new Map<string, (typeof published)[number]>();
  const defs: ToolDef[] = [];
  for (const wf of published) {
    let name = `wf_${wf.slug.replace(/[^a-z0-9]+/gi, "_")}`.slice(0, 60);
    for (let n = 2; byTool.has(name); n++) name = `${name.slice(0, 57)}_${n}`;
    byTool.set(name, wf);
    defs.push({
      name,
      description: `${wf.name}: ${wf.description || "No description."} Acts on the requesting employee's own account.`,
      inputSchema: wf.inputSchema,
    });
  }

  defs.push(
    {
      name: "search_kb",
      description: "Search the IT help articles. Use for how-to questions.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "What to look for" } },
        required: ["query"],
      },
    },
    {
      name: "create_ticket",
      description: "Open a ticket for the IT team when nothing else solves the problem.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short summary" },
          description: { type: "string", description: "Details from the conversation" },
        },
        required: ["title", "description"],
      },
    },
  );

  return {
    defs,
    async execute(call) {
      if (call.name === "search_kb") return searchKbTool(ctx, call.input);
      if (call.name === "create_ticket") return createTicketTool(ctx, call.input);
      const wf = byTool.get(call.name);
      if (!wf) return { result: { ok: false, error: `There is no tool called ${call.name}` } };
      return runWorkflowTool(ctx, wf, call.input);
    },
  };
}

async function runWorkflowTool(
  ctx: AgentContext,
  wf: { id: string; name: string; inputSchema: Record<string, unknown> },
  rawInput: Record<string, unknown>,
): Promise<ToolOutcome> {
  const input = typeof rawInput === "object" && rawInput && !Array.isArray(rawInput) ? { ...rawInput } : {};

  // Own account only. Fill missing email fields with the employee's email; refuse others.
  const props = Object.keys((wf.inputSchema.properties ?? {}) as Record<string, unknown>);
  for (const key of props.filter((k) => /email/i.test(k))) {
    const given = input[key];
    if (given === undefined || given === null || given === "") {
      input[key] = ctx.user.email;
    } else if (typeof given !== "string" || given.trim().toLowerCase() !== ctx.user.email.toLowerCase()) {
      return {
        result: { ok: false, error: `The help desk can only run "${wf.name}" for your own account (${ctx.user.email}). Ask IT for changes to other people's accounts.` },
        event: { type: "workflow", workflowName: wf.name, status: "refused" },
      };
    }
  }

  const res = await runWorkflow(
    { orgId: ctx.orgId, workflowId: wf.id, trigger: "helpdesk", triggeredBy: ctx.user.id, inputs: input },
    ctx.deps,
  );
  if (!res.ok) {
    return {
      result: { ok: false, error: [res.message, ...(res.details ?? [])].join("; ") },
      event: { type: "workflow", workflowName: wf.name, status: "refused" },
    };
  }
  return {
    result: { ok: true, status: res.status, output: res.outputs, error: res.error ? firstLine(res.error) : null },
    event: { type: "workflow", workflowName: wf.name, status: res.status, runId: res.runId },
  };
}

export async function searchKb(orgId: string, query: string, limit = 3) {
  // Plain words joined with OR: forgiving for natural questions. Only [a-z0-9] reach to_tsquery.
  const words = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1).slice(0, 12);
  if (words.length === 0) return [];
  const tsQuery = words.join(" | ");
  const doc = sql`to_tsvector('english', ${kbArticles.title} || ' ' || ${kbArticles.body})`;
  const q = sql`to_tsquery('english', ${tsQuery})`;
  return db
    .select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.body })
    .from(kbArticles)
    .where(and(eq(kbArticles.orgId, orgId), sql`${doc} @@ ${q}`))
    .orderBy(desc(sql`ts_rank(${doc}, ${q})`))
    .limit(limit);
}

async function searchKbTool(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  const query = typeof input.query === "string" ? input.query.slice(0, 500) : "";
  const hits = await searchKb(ctx.orgId, query);
  return {
    result: { results: hits.map((h) => ({ title: h.title, body: h.body })) },
    event: { type: "kb", titles: hits.map((h) => h.title) },
  };
}

async function createTicketTool(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolOutcome> {
  const description = (typeof input.description === "string" ? input.description : "").trim().slice(0, MAX_DESCRIPTION);
  const title =
    (typeof input.title === "string" ? input.title : "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) ||
    description.slice(0, 80) ||
    "Help desk request";

  const ticket = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(tickets)
      .values({ orgId: ctx.orgId, title, description, requesterId: ctx.user.id, source: "web" })
      .returning({ id: tickets.id });
    await tx.insert(ticketMessages).values({
      ticketId: t.id,
      authorId: ctx.user.id,
      authorKind: "user",
      body: description || title,
    });
    return t;
  });
  return { result: { ok: true, ticketId: ticket.id, title }, event: { type: "ticket", ticketId: ticket.id, title } };
}

const firstLine = (s: string) => s.split("\n")[0].slice(0, 300);
