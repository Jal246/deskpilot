// The one entry point for running a workflow. It decides WHICH code runs:
//   - helpdesk trigger: only a published workflow, and only its current_version_id.
//     Whatever the caller (or the LLM) asks for, a draft never runs here.
//   - manual trigger (admin test run): any version of the workflow, drafts included.
// Then: validate inputs → insert run (running) → sandbox → update the run row.
import type { ErrorObject, ValidateFunction } from "ajv";
import { and, db, desc, eq, workflowRuns, workflows, workflowVersions, type RunLog } from "@deskpilot/db";
import { callHost, type HostDeps } from "@deskpilot/sdk";
import { ajv } from "./ajv";
import { compileWorkflow, CompileError } from "./compile";
import { runInSandbox, type SandboxOptions } from "./sandbox";

export type RunRequest = {
  orgId: string;
  workflowId: string;
  trigger: "manual" | "helpdesk";
  triggeredBy: string | null;
  inputs: unknown;
  /** Manual runs only: which version to test. Ignored for helpdesk runs. */
  versionId?: string;
};

export type RunRefusal = {
  ok: false;
  code: "not_found" | "not_published" | "invalid_input";
  message: string;
  details?: string[];
};
export type RunResult = {
  ok: true;
  runId: string;
  status: "succeeded" | "failed" | "timed_out";
  outputs: unknown;
  error: string | null;
};

const MAX_LOG_LINES = 500;
const MAX_LOG_CHARS = 2_000;

const validators = new Map<string, ValidateFunction>();

export async function runWorkflow(
  req: RunRequest,
  deps: HostDeps,
  limits: Pick<SandboxOptions, "timeoutMs" | "memoryMb"> = {},
): Promise<RunResult | RunRefusal> {
  // 1. Which version? (the safety boundary)
  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.id, req.workflowId), eq(workflows.orgId, req.orgId)),
  });
  if (!workflow) return refuse("not_found", "Workflow not found");

  let versionId: string | null | undefined;
  if (req.trigger === "helpdesk") {
    if (workflow.status !== "published" || !workflow.currentVersionId) {
      return refuse("not_published", `"${workflow.name}" is not published, so the help desk can't run it`);
    }
    versionId = workflow.currentVersionId; // never the caller's choice
  } else {
    versionId = req.versionId ?? workflow.currentVersionId;
  }

  const version = versionId
    ? await db.query.workflowVersions.findFirst({
        where: and(eq(workflowVersions.id, versionId), eq(workflowVersions.workflowId, workflow.id)),
      })
    : await db.query.workflowVersions.findFirst({
        where: eq(workflowVersions.workflowId, workflow.id),
        orderBy: desc(workflowVersions.versionNumber),
      });
  if (!version) return refuse("not_found", "Workflow version not found");

  // 2. Inputs must match the version's JSON Schema, before anything runs.
  let validate = validators.get(version.id);
  if (!validate) {
    try {
      validate = ajv.compile(version.inputSchema);
    } catch (err) {
      return refuse("invalid_input", `The workflow's input schema is invalid: ${(err as Error).message}`);
    }
    validators.set(version.id, validate);
  }
  const inputs = req.inputs ?? {};
  if (!validate(inputs)) {
    return refuse("invalid_input", "Inputs don't match the workflow's input schema", formatAjvErrors(validate.errors));
  }

  // 3. Record the run, then execute.
  const logs: RunLog[] = [];
  const log = (level: RunLog["level"], message: string) => {
    if (logs.length >= MAX_LOG_LINES) return;
    logs.push({ at: new Date().toISOString(), level, message: message.slice(0, MAX_LOG_CHARS) });
    if (logs.length === MAX_LOG_LINES) logs.push({ at: new Date().toISOString(), level: "warn", message: "Log limit reached; further lines dropped" });
  };

  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowVersionId: version.id,
      triggeredBy: req.triggeredBy,
      trigger: req.trigger,
      inputs: inputs as Record<string, unknown>,
      status: "running",
    })
    .returning({ id: workflowRuns.id });

  let status: RunResult["status"];
  let outputs: unknown = null;
  let error: string | null = null;

  try {
    const js = compileWorkflow(version.code);
    const result = await runInSandbox({
      js,
      input: inputs,
      onLog: log,
      callHost: async (method, argsJson) => {
        try {
          return await callHost(deps, method, argsJson);
        } catch (err) {
          log("error", `sdk.${method} failed: ${(err as Error).message}`);
          throw err;
        }
      },
      ...limits,
    });
    status = result.status;
    if (result.status === "succeeded") outputs = result.output;
    else error = result.error;
  } catch (err) {
    status = "failed";
    error = err instanceof CompileError ? `Code didn't compile:\n${err.message}` : String(err);
  }

  await db
    .update(workflowRuns)
    .set({ status, outputs, error, logs, finishedAt: new Date() })
    .where(eq(workflowRuns.id, run.id));

  return { ok: true, runId: run.id, status, outputs, error };
}

function refuse(code: RunRefusal["code"], message: string, details?: string[]): RunRefusal {
  return { ok: false, code, message, details };
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => {
    const field = e.instancePath ? e.instancePath.slice(1).replaceAll("/", ".") : "input";
    if (e.keyword === "required") return `${String(e.params.missingProperty)} is required`;
    if (e.keyword === "additionalProperties") return `unexpected field "${String(e.params.additionalProperty)}"`;
    return `${field} ${e.message ?? "is invalid"}`;
  });
}
