// Help desk agent, end to end with the mock model. Needs Postgres (pnpm db:up).
// Uses its own throwaway org, deleted afterwards.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  and,
  closeDb,
  db,
  eq,
  kbArticles,
  organizations,
  tickets,
  users,
  workflowRuns,
  workflows,
  workflowVersions,
} from "@deskpilot/db";
import { TEMPLATES } from "@deskpilot/llm";
import { MockDirectoryStore } from "@deskpilot/sdk";
import { helpdeskChat, validateHistory, type HistoryMessage } from "./helpdesk";
import { loadToolbox } from "./tools";

const directory = new MockDirectoryStore();
const deps = { directory };

let orgId: string;
let employee: { id: string; name: string; email: string };
let resetWfId: string;
let addWfId: string;

const template = (id: string) => TEMPLATES.find((t) => t.id === id)!.build();

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: "Test org (helpdesk.test)" }).returning();
  orgId = org.id;
  const [emp] = await db
    .insert(users)
    .values({ orgId, email: "employee@acme.test", name: "Eli Employee", role: "employee" })
    .returning();
  employee = { id: emp.id, name: emp.name, email: emp.email };

  // Published: reset password.
  const reset = template("reset-password");
  const [rw] = await db
    .insert(workflows)
    .values({ orgId, name: reset.name, slug: "reset-password", description: reset.description, status: "published" })
    .returning();
  resetWfId = rw.id;
  const [rv] = await db
    .insert(workflowVersions)
    .values({ workflowId: rw.id, versionNumber: 1, code: reset.code, inputSchema: reset.inputSchema })
    .returning();
  await db.update(workflows).set({ currentVersionId: rv.id }).where(eq(workflows.id, rw.id));

  // Draft only: add to group. The help desk must never run it.
  const add = template("add-to-group");
  const [aw] = await db
    .insert(workflows)
    .values({ orgId, name: add.name, slug: "add-user-to-group", description: add.description, status: "draft" })
    .returning();
  addWfId = aw.id;
  await db.insert(workflowVersions).values({ workflowId: aw.id, versionNumber: 1, code: add.code, inputSchema: add.inputSchema });

  await db.insert(kbArticles).values({
    orgId,
    title: "Setting up the VPN",
    body: "Install the VPN client from the Self Service app and sign in with your work account.",
  });
});

afterAll(async () => {
  if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  await closeDb();
});

beforeEach(() => directory.reset());

async function chat(messages: HistoryMessage[]) {
  const res = await helpdeskChat({ orgId, userId: employee.id, messages }, deps);
  if (!res.ok) throw new Error(res.message);
  return res;
}

async function runsOf(workflowId: string) {
  return db
    .select({ trigger: workflowRuns.trigger, status: workflowRuns.status, triggeredBy: workflowRuns.triggeredBy })
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowRuns.workflowVersionId, workflowVersions.id))
    .where(eq(workflowVersions.workflowId, workflowId));
}

describe("help desk agent", () => {
  it("asks first, then runs the published reset-password workflow on yes", async () => {
    const ask = await chat([{ role: "user", content: "I'm locked out of my account" }]);
    expect(ask.events).toEqual([]);
    expect(ask.reply).toMatch(/Shall I go ahead\?$/);
    expect(await runsOf(resetWfId)).toHaveLength(0);

    const done = await chat([
      { role: "user", content: "I'm locked out of my account" },
      { role: "assistant", content: ask.reply },
      { role: "user", content: "yes" },
    ]);
    expect(done.events).toEqual([expect.objectContaining({ type: "workflow", status: "succeeded" })]);
    expect(done.reply).toMatch(/Tmp-/);
    expect(directory.getUser("employee@acme.test")?.locked).toBe(false);
    expect(await runsOf(resetWfId)).toEqual([{ trigger: "helpdesk", status: "succeeded", triggeredBy: employee.id }]);
  });

  it("only offers published workflows as tools", async () => {
    const box = await loadToolbox({ orgId, user: employee, deps });
    const names = box.defs.map((d) => d.name);
    expect(names).toContain("wf_reset_password");
    expect(names).not.toContain("wf_add_user_to_group");
  });

  it("refuses a made-up tool call for a draft workflow (nothing runs)", async () => {
    const box = await loadToolbox({ orgId, user: employee, deps });
    const out = await box.execute({ id: "x", name: "wf_add_user_to_group", input: { email: employee.email, group: "design" } });
    expect(out.result).toMatchObject({ ok: false });
    expect(await runsOf(addWfId)).toHaveLength(0);
    expect(directory.getUser("employee@acme.test")?.groups).not.toContain("design");
  });

  it("refuses to act on someone else's account", async () => {
    const box = await loadToolbox({ orgId, user: employee, deps });
    const before = (await runsOf(resetWfId)).length;
    const out = await box.execute({ id: "x", name: "wf_reset_password", input: { email: "admin@acme.test" } });
    expect(out.result).toMatchObject({ ok: false, error: expect.stringMatching(/your own account/) });
    expect(out.event).toMatchObject({ status: "refused" });
    expect(await runsOf(resetWfId)).toHaveLength(before);
  });

  it("refuses if the workflow is unpublished after the tools were loaded", async () => {
    const box = await loadToolbox({ orgId, user: employee, deps });
    await db.update(workflows).set({ status: "draft" }).where(eq(workflows.id, resetWfId));
    try {
      const out = await box.execute({ id: "x", name: "wf_reset_password", input: {} });
      expect(out.result).toMatchObject({ ok: false, error: expect.stringMatching(/not published/) });
    } finally {
      await db.update(workflows).set({ status: "published" }).where(eq(workflows.id, resetWfId));
    }
  });

  it("answers how-to questions from the knowledge base", async () => {
    const res = await chat([{ role: "user", content: "How do I set up the VPN?" }]);
    expect(res.events).toEqual([{ type: "kb", titles: ["Setting up the VPN"] }]);
    expect(res.reply).toContain("Self Service");
  });

  it("opens a ticket when no published workflow fits (the draft one doesn't count)", async () => {
    const res = await chat([{ role: "user", content: "Please add me to the design group" }]);
    expect(res.events).toEqual([expect.objectContaining({ type: "ticket" })]);
    const [row] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.orgId, orgId), eq(tickets.title, "Please add me to the design group")));
    expect(row).toMatchObject({ requesterId: employee.id, status: "open", source: "web" });
  });
});

describe("validateHistory", () => {
  it("accepts plain user/assistant text ending with the user", () => {
    expect(validateHistory([{ role: "user", content: "hi" }])).toBeNull();
  });
  it("rejects tool messages, empty history, and a trailing assistant message", () => {
    expect(validateHistory([])).not.toBeNull();
    expect(validateHistory([{ role: "tool", content: "{}" }])).not.toBeNull();
    expect(validateHistory([{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }])).not.toBeNull();
    expect(validateHistory([{ role: "user", content: "x".repeat(5000) }])).not.toBeNull();
  });
});
