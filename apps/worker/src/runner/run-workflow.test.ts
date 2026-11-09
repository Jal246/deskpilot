// Needs Postgres running (pnpm db:up). Uses its own throwaway org, deleted afterwards.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db, eq, organizations, workflowRuns, workflows, workflowVersions } from "@deskpilot/db";
import { MockDirectoryStore } from "@deskpilot/sdk";
import { runWorkflow } from "./run-workflow";

const directory = new MockDirectoryStore();
const deps = { directory };

const SCHEMA = {
  type: "object",
  properties: { email: { type: "string", format: "email" }, group: { type: "string" } },
  required: ["email", "group"],
  additionalProperties: false,
};
const codeReturning = (tag: string) =>
  `export default async function run(input: { email: string; group: string }, sdk: Sdk) {
    await sdk.mockDirectory.addUserToGroup(input.email, input.group);
    return { ran: "${tag}" };
  }`;

let orgId: string;
let publishedId: string; // published, live = v1, plus a newer draft v2
let draftV2Id: string;
let draftOnlyId: string; // never published

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: "Test org (run-workflow.test)" }).returning();
  orgId = org.id;

  const [pub] = await db
    .insert(workflows)
    .values({ orgId, name: "Published WF", slug: "published-wf", status: "published" })
    .returning();
  publishedId = pub.id;
  const [v1, v2] = await db
    .insert(workflowVersions)
    .values([
      { workflowId: pub.id, versionNumber: 1, code: codeReturning("v1"), inputSchema: SCHEMA },
      { workflowId: pub.id, versionNumber: 2, code: codeReturning("v2-draft"), inputSchema: SCHEMA },
    ])
    .returning();
  draftV2Id = v2.id;
  await db.update(workflows).set({ currentVersionId: v1.id }).where(eq(workflows.id, pub.id));

  const [draft] = await db
    .insert(workflows)
    .values({ orgId, name: "Draft WF", slug: "draft-wf", status: "draft" })
    .returning();
  draftOnlyId = draft.id;
  await db
    .insert(workflowVersions)
    .values({ workflowId: draft.id, versionNumber: 1, code: codeReturning("draft"), inputSchema: SCHEMA });
});

afterAll(async () => {
  if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId)); // cascades to everything
  await closeDb();
});

beforeEach(() => directory.reset());

const input = { email: "employee@acme.test", group: "design" };

async function runCount(workflowId: string) {
  const rows = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowRuns.workflowVersionId, workflowVersions.id))
    .where(eq(workflowVersions.workflowId, workflowId));
  return rows.length;
}

describe("runWorkflow: the published-only boundary", () => {
  it("help desk can run a published workflow, and the run is recorded", async () => {
    const result = await runWorkflow(
      { orgId, workflowId: publishedId, trigger: "helpdesk", triggeredBy: null, inputs: input },
      deps,
    );
    expect(result).toMatchObject({ ok: true, status: "succeeded", outputs: { ran: "v1" } });
    if (!result.ok) throw new Error("unreachable");

    const row = await db.query.workflowRuns.findFirst({ where: eq(workflowRuns.id, result.runId) });
    expect(row).toMatchObject({ status: "succeeded", trigger: "helpdesk", outputs: { ran: "v1" } });
    expect(row?.finishedAt).toBeInstanceOf(Date);
    expect(directory.getUser(input.email)?.groups).toContain("design");
  });

  it("help desk is refused for a draft workflow, and nothing runs", async () => {
    const before = await runCount(draftOnlyId);
    const result = await runWorkflow(
      { orgId, workflowId: draftOnlyId, trigger: "helpdesk", triggeredBy: null, inputs: input },
      deps,
    );
    expect(result).toMatchObject({ ok: false, code: "not_published" });
    expect(await runCount(draftOnlyId)).toBe(before);
    expect(directory.getUser(input.email)?.groups).not.toContain("design");
  });

  it("help desk ignores a requested version and always runs the live one", async () => {
    const result = await runWorkflow(
      { orgId, workflowId: publishedId, trigger: "helpdesk", triggeredBy: null, inputs: input, versionId: draftV2Id },
      deps,
    );
    expect(result).toMatchObject({ ok: true, outputs: { ran: "v1" } });
  });

  it("an admin test run (manual) may run a draft version", async () => {
    const result = await runWorkflow(
      { orgId, workflowId: publishedId, trigger: "manual", triggeredBy: null, inputs: input, versionId: draftV2Id },
      deps,
    );
    expect(result).toMatchObject({ ok: true, outputs: { ran: "v2-draft" } });
  });

  it("can't reach another org's workflow", async () => {
    const result = await runWorkflow(
      {
        orgId: "00000000-0000-4000-8000-000000000000",
        workflowId: publishedId,
        trigger: "manual",
        triggeredBy: null,
        inputs: input,
      },
      deps,
    );
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("runWorkflow: inputs", () => {
  it.each([
    [{ email: "employee@acme.test" }, /group is required/],
    [{ email: "not-an-email", group: "design" }, /email must match format "email"/],
    [{ ...input, extra: 1 }, /unexpected field "extra"/],
    [{ email: 42, group: "design" }, /email must be string/],
  ])("refuses %j before running", async (bad, message) => {
    const before = await runCount(publishedId);
    const result = await runWorkflow(
      { orgId, workflowId: publishedId, trigger: "manual", triggeredBy: null, inputs: bad },
      deps,
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    expect(!result.ok && result.details?.join("\n")).toMatch(message);
    expect(await runCount(publishedId)).toBe(before);
  });
});
