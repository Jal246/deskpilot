"use server";

// Workflow page actions: test-run a version, publish / unpublish, reset the mock directory.
import { revalidatePath } from "next/cache";
import { and, db, eq, workflowRuns, workflows, workflowVersions } from "@deskpilot/db";
import { requireAdmin } from "@/lib/auth";
import { getRun, isUuid } from "@/lib/data";
import { callWorker, WorkerUnavailableError, type TestRunResponse } from "@/lib/worker-client";

export type TestRunOutcome =
  | {
      ok: true;
      run: {
        id: string;
        status: string;
        outputs: unknown;
        error: string | null;
        logs: Array<{ at: string; level: "info" | "warn" | "error"; message: string }>;
      };
    }
  | { ok: false; error: string; details?: string[] };

export async function testRun(workflowId: string, versionId: string, inputs: unknown): Promise<TestRunOutcome> {
  const user = await requireAdmin();
  if (!isUuid(workflowId) || !isUuid(versionId)) return { ok: false, error: "Workflow not found." };
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return { ok: false, error: "Inputs must be an object." };

  let res;
  try {
    res = await callWorker<TestRunResponse>(`/workflows/${workflowId}/test-run`, {
      method: "POST",
      body: { orgId: user.orgId, userId: user.id, versionId, inputs },
    });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) return { ok: false, error: err.message };
    throw err;
  }
  if (!res.data.ok) return { ok: false, error: res.data.message, details: res.data.details };

  // The worker has finished by now (runs are capped at 10 s), so the row has the logs.
  const run = await getRun(user.orgId, res.data.runId);
  if (!run) return { ok: false, error: "The run finished but couldn't be loaded." };

  revalidatePath(`/workflows/${workflowId}`); // refreshes the mock directory panel + "tested" marks
  revalidatePath("/runs");
  return { ok: true, run: { id: run.id, status: run.status, outputs: run.outputs, error: run.error, logs: run.logs } };
}

export type PublishOutcome = { ok: true } | { ok: false; error: string };

/**
 * Makes a version the live one: the help desk will run exactly this version.
 * Rule: the version must have at least one successful test run first.
 */
export async function publishVersion(workflowId: string, versionId: string): Promise<PublishOutcome> {
  const user = await requireAdmin();
  if (!isUuid(workflowId) || !isUuid(versionId)) return { ok: false, error: "Workflow not found." };

  const result = await db.transaction(async (tx): Promise<PublishOutcome> => {
    const [row] = await tx
      .select({ versionId: workflowVersions.id, versionNumber: workflowVersions.versionNumber })
      .from(workflowVersions)
      .innerJoin(workflows, eq(workflowVersions.workflowId, workflows.id))
      .where(and(eq(workflows.id, workflowId), eq(workflows.orgId, user.orgId), eq(workflowVersions.id, versionId)))
      .for("update", { of: workflows });
    if (!row) return { ok: false, error: "Version not found." };

    const [passed] = await tx
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.workflowVersionId, versionId), eq(workflowRuns.status, "succeeded")))
      .limit(1);
    if (!passed) return { ok: false, error: `Run a successful test of v${row.versionNumber} before publishing it.` };

    await tx.update(workflows).set({ status: "published", currentVersionId: versionId }).where(eq(workflows.id, workflowId));
    return { ok: true };
  });

  if (result.ok) {
    revalidatePath(`/workflows/${workflowId}`);
    revalidatePath("/workflows");
  }
  return result;
}

/** Takes the workflow away from the help desk. Its versions are kept; publish again any time. */
export async function unpublishWorkflow(workflowId: string): Promise<PublishOutcome> {
  const user = await requireAdmin();
  if (!isUuid(workflowId)) return { ok: false, error: "Workflow not found." };
  const updated = await db
    .update(workflows)
    .set({ status: "draft", currentVersionId: null })
    .where(and(eq(workflows.id, workflowId), eq(workflows.orgId, user.orgId)))
    .returning({ id: workflows.id });
  if (updated.length === 0) return { ok: false, error: "Workflow not found." };
  revalidatePath(`/workflows/${workflowId}`);
  revalidatePath("/workflows");
  return { ok: true };
}

/** Puts the fake directory back to its starting users and groups. */
export async function resetDirectory(workflowId: string): Promise<PublishOutcome> {
  await requireAdmin();
  try {
    await callWorker("/directory/reset", { method: "POST" });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) return { ok: false, error: err.message };
    throw err;
  }
  if (isUuid(workflowId)) revalidatePath(`/workflows/${workflowId}`);
  return { ok: true };
}
