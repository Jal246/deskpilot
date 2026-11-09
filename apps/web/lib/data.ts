// Read queries for the dashboard. Every query is scoped to the caller's org.
import {
  aliasedTable,
  and,
  asc,
  db,
  desc,
  eq,
  kbArticles,
  max,
  ticketMessages,
  tickets,
  users,
  workflowRuns,
  workflows,
  workflowVersions,
} from "@deskpilot/db";

/** Ids in URLs are user input; Postgres errors on a malformed uuid, so check first. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ---------- workflows ----------
export async function listWorkflows(orgId: string) {
  const lastRun = db
    .select({
      workflowId: workflowVersions.workflowId,
      lastRunAt: max(workflowRuns.startedAt).as("last_run_at"),
    })
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowRuns.workflowVersionId, workflowVersions.id))
    .groupBy(workflowVersions.workflowId)
    .as("last_run");

  return db
    .select({
      id: workflows.id,
      name: workflows.name,
      slug: workflows.slug,
      description: workflows.description,
      status: workflows.status,
      versionNumber: workflowVersions.versionNumber,
      updatedAt: workflows.updatedAt,
      lastRunAt: lastRun.lastRunAt,
    })
    .from(workflows)
    .leftJoin(workflowVersions, eq(workflows.currentVersionId, workflowVersions.id))
    .leftJoin(lastRun, eq(lastRun.workflowId, workflows.id))
    .where(eq(workflows.orgId, orgId))
    .orderBy(asc(workflows.name));
}

export async function getWorkflow(orgId: string, id: string) {
  return db.query.workflows.findFirst({
    where: and(eq(workflows.orgId, orgId), eq(workflows.id, id)),
    with: { versions: { orderBy: desc(workflowVersions.versionNumber) } },
  });
}

/** Version ids of this workflow that have at least one successful run (needed to publish). */
export async function testedVersionIds(workflowId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: workflowRuns.workflowVersionId })
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowRuns.workflowVersionId, workflowVersions.id))
    .where(and(eq(workflowVersions.workflowId, workflowId), eq(workflowRuns.status, "succeeded")));
  return rows.map((r) => r.id);
}

// ---------- runs ----------
const triggeredByUser = aliasedTable(users, "triggered_by_user");

const runColumns = {
  id: workflowRuns.id,
  status: workflowRuns.status,
  trigger: workflowRuns.trigger,
  startedAt: workflowRuns.startedAt,
  finishedAt: workflowRuns.finishedAt,
  workflowId: workflows.id,
  workflowName: workflows.name,
  versionNumber: workflowVersions.versionNumber,
  triggeredBy: triggeredByUser.email,
};

function runsQuery() {
  return db
    .select(runColumns)
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowRuns.workflowVersionId, workflowVersions.id))
    .innerJoin(workflows, eq(workflowVersions.workflowId, workflows.id))
    .leftJoin(triggeredByUser, eq(workflowRuns.triggeredBy, triggeredByUser.id));
}

export async function listRuns(orgId: string, filter: { workflowId?: string; status?: string } = {}) {
  const status = RUN_STATUSES.find((s) => s === filter.status);
  return runsQuery()
    .where(
      and(
        eq(workflows.orgId, orgId),
        filter.workflowId ? eq(workflows.id, filter.workflowId) : undefined,
        status ? eq(workflowRuns.status, status) : undefined,
      ),
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(200);
}
export const RUN_STATUSES = ["running", "succeeded", "failed", "timed_out"] as const;

export async function getRun(orgId: string, id: string) {
  const [row] = await db
    .select({ ...runColumns, inputs: workflowRuns.inputs, outputs: workflowRuns.outputs, error: workflowRuns.error, logs: workflowRuns.logs })
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowRuns.workflowVersionId, workflowVersions.id))
    .innerJoin(workflows, eq(workflowVersions.workflowId, workflows.id))
    .leftJoin(triggeredByUser, eq(workflowRuns.triggeredBy, triggeredByUser.id))
    .where(and(eq(workflows.orgId, orgId), eq(workflowRuns.id, id)));
  return row;
}

// ---------- tickets ----------
export async function listTickets(orgId: string) {
  return db.query.tickets.findMany({
    where: eq(tickets.orgId, orgId),
    orderBy: desc(tickets.createdAt),
    with: { requester: { columns: { name: true, email: true } }, assignee: { columns: { name: true } } },
  });
}

export async function getTicket(orgId: string, id: string) {
  return db.query.tickets.findFirst({
    where: and(eq(tickets.orgId, orgId), eq(tickets.id, id)),
    with: {
      requester: { columns: { name: true, email: true } },
      assignee: { columns: { name: true } },
      messages: {
        orderBy: asc(ticketMessages.createdAt),
        with: { author: { columns: { name: true } } },
      },
    },
  });
}

// ---------- knowledge base ----------
export async function listKbArticles(orgId: string) {
  return db.query.kbArticles.findMany({
    where: eq(kbArticles.orgId, orgId),
    orderBy: asc(kbArticles.title),
  });
}

export async function getKbArticle(orgId: string, id: string) {
  return db.query.kbArticles.findFirst({
    where: and(eq(kbArticles.orgId, orgId), eq(kbArticles.id, id)),
  });
}
