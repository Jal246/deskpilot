"use server";

// The builder: prompt → generated draft (generateDraft), then edited draft → saved version (saveDraft).
// Saving never publishes: a new version is a draft until step 6's Publish button.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, db, eq, like, max, workflows, workflowVersions } from "@deskpilot/db";
import { getLlm, LlmError, type GeneratedWorkflow } from "@deskpilot/llm";
import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/data";
import { callWorker, WorkerUnavailableError, type CheckResponse } from "@/lib/worker-client";

const MAX_PROMPT = 2_000;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

export type GenerateResult = { ok: true; draft: GeneratedWorkflow } | { ok: false; error: string };

export async function generateDraft(prompt: string): Promise<GenerateResult> {
  await requireAdmin();
  const text = String(prompt ?? "").trim();
  if (!text) return { ok: false, error: "Describe what the workflow should do." };
  if (text.length > MAX_PROMPT) return { ok: false, error: `Keep the description under ${MAX_PROMPT} characters.` };
  try {
    return { ok: true, draft: await getLlm().generateWorkflow({ prompt: text }) };
  } catch (err) {
    if (err instanceof LlmError) return { ok: false, error: err.message };
    throw err;
  }
}

export type SaveInput = {
  /** Missing = create a new workflow. */
  workflowId?: string;
  name: string;
  description: string;
  code: string;
  /** The schema as the admin typed it (JSON text). */
  inputSchema: string;
  prompt?: string;
};

export type SaveResult = { error: string; codeProblems?: string[]; schemaProblems?: string[] };

export async function saveDraft(input: SaveInput): Promise<SaveResult> {
  const user = await requireAdmin();

  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  const code = String(input.code ?? "");
  const prompt = String(input.prompt ?? "").trim().slice(0, MAX_PROMPT) || null;
  if (!name) return { error: "Give the workflow a name." };
  if (name.length > MAX_NAME) return { error: `Name must be at most ${MAX_NAME} characters.` };
  if (description.length > MAX_DESCRIPTION) return { error: `Description must be at most ${MAX_DESCRIPTION} characters.` };
  if (input.workflowId !== undefined && !isUuid(input.workflowId)) return { error: "Workflow not found." };

  let inputSchema: unknown;
  try {
    inputSchema = JSON.parse(String(input.inputSchema ?? ""));
  } catch (err) {
    return { error: "Fix the input schema first.", schemaProblems: [`Not valid JSON: ${(err as Error).message}`] };
  }

  // The worker owns the sandbox rules, so it checks the code (and the schema) before we store anything.
  let check: CheckResponse;
  try {
    check = (await callWorker<CheckResponse>("/workflows/check", { method: "POST", body: { code, inputSchema } })).data;
  } catch (err) {
    if (err instanceof WorkerUnavailableError) return { error: err.message };
    throw err;
  }
  if (!check.ok) {
    return { error: "Fix these problems before saving.", codeProblems: check.codeProblems, schemaProblems: check.schemaProblems };
  }
  const schema = inputSchema as Record<string, unknown>;

  let workflowId = input.workflowId;
  if (!workflowId) {
    workflowId = await db.transaction(async (tx) => {
      const slug = await uniqueSlug(tx, user.orgId, name);
      const [wf] = await tx
        .insert(workflows)
        .values({ orgId: user.orgId, name, slug, description, status: "draft" })
        .returning({ id: workflows.id });
      await tx.insert(workflowVersions).values({
        workflowId: wf.id,
        versionNumber: 1,
        code,
        inputSchema: schema,
        prompt,
        createdBy: user.id,
      });
      return wf.id;
    });
  } else {
    const id = workflowId;
    const saved = await db.transaction(async (tx) => {
      // Lock the workflow row so two saves at once can't pick the same version number.
      const [wf] = await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.id, id), eq(workflows.orgId, user.orgId)))
        .for("update");
      if (!wf) return false;
      const [{ latest }] = await tx
        .select({ latest: max(workflowVersions.versionNumber) })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, id));
      await tx.insert(workflowVersions).values({
        workflowId: id,
        versionNumber: (latest ?? 0) + 1,
        code,
        inputSchema: schema,
        prompt,
        createdBy: user.id,
      });
      // Name/description are shown to everyone right away; the live code does NOT change
      // (current_version_id stays put until Publish).
      await tx.update(workflows).set({ name, description }).where(eq(workflows.id, id));
      return true;
    });
    if (!saved) return { error: "Workflow not found." };
  }

  revalidatePath("/workflows");
  redirect(`/workflows/${workflowId}`);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function uniqueSlug(tx: Tx, orgId: string, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "workflow";
  const taken = new Set(
    (
      await tx
        .select({ slug: workflows.slug })
        .from(workflows)
        .where(and(eq(workflows.orgId, orgId), like(workflows.slug, `${base}%`)))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
