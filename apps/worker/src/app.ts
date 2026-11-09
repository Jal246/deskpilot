import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MockDirectoryStore } from "@deskpilot/sdk";
import { helpdeskChat, validateHistory } from "./agent/helpdesk";
import { checkWorkflow } from "./runner/check-workflow";
import { runWorkflow } from "./runner/run-workflow";

// The worker's HTTP API: runs workflows in the sandbox and hosts the help desk agent.
// index.ts starts the server; tests call app.request() directly.
export const app = new Hono();
const startedAt = Date.now();
const directory = new MockDirectoryStore(); // in memory: resets when the worker restarts

const secret = process.env.WORKER_SECRET;
if (!secret) throw new Error("WORKER_SECRET is not set (see .env.example)");

app.get("/health", (c) =>
  c.json({ ok: true, service: "deskpilot-worker", uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) }),
);

// Everything else: only the web app (which knows WORKER_SECRET) may call.
app.use("*", async (c, next) => {
  const given = Buffer.from(c.req.header("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return c.json({ ok: false, code: "unauthorized", message: "Missing or wrong worker secret" }, 401);
  }
  await next();
});

// No request needs more than this (chat history is capped well below it).
export const MAX_BODY_BYTES = 1024 * 1024;
app.use(
  "*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ ok: false, code: "too_large", message: "Request body is too large" }, 413),
  }),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admin test run. Always trigger=manual: the help desk path never comes in over HTTP. */
app.post("/workflows/:id/test-run", async (c) => {
  const workflowId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as {
    orgId?: unknown;
    userId?: unknown;
    versionId?: unknown;
    inputs?: unknown;
  } | null;
  if (!body || typeof body.orgId !== "string" || !UUID.test(body.orgId) || !UUID.test(workflowId)) {
    return c.json({ ok: false, code: "bad_request", message: "orgId and a valid workflow id are required" }, 400);
  }
  if (body.versionId !== undefined && (typeof body.versionId !== "string" || !UUID.test(body.versionId))) {
    return c.json({ ok: false, code: "bad_request", message: "versionId must be a uuid" }, 400);
  }

  const result = await runWorkflow(
    {
      orgId: body.orgId,
      workflowId,
      trigger: "manual",
      triggeredBy: typeof body.userId === "string" && UUID.test(body.userId) ? body.userId : null,
      versionId: body.versionId as string | undefined,
      inputs: body.inputs,
    },
    { directory },
  );
  if (!result.ok) return c.json(result, result.code === "not_found" ? 404 : 422);
  return c.json(result);
});

/** Help desk chat. The web app passes who is asking; the agent may only run published workflows. */
app.post("/chat", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { orgId?: unknown; userId?: unknown; messages?: unknown } | null;
  if (!body || typeof body.orgId !== "string" || !UUID.test(body.orgId) || typeof body.userId !== "string" || !UUID.test(body.userId)) {
    return c.json({ ok: false, code: "bad_request", message: "orgId and userId are required" }, 400);
  }
  const problem = validateHistory(body.messages);
  if (problem) return c.json({ ok: false, code: "bad_request", message: problem }, 400);

  const result = await helpdeskChat(
    { orgId: body.orgId, userId: body.userId, messages: body.messages as Parameters<typeof helpdeskChat>[0]["messages"] },
    { directory },
  );
  if (!result.ok) return c.json(result, result.code === "not_found" ? 404 : 400);
  return c.json(result);
});

/** Builder: check a draft (code compiles under sandbox rules, schema is valid) before saving. */
app.post("/workflows/check", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { code?: unknown; inputSchema?: unknown } | null;
  if (!body) return c.json({ ok: false, code: "bad_request", message: "JSON body required" }, 400);
  return c.json(checkWorkflow(body.code, body.inputSchema));
});

/** See the fake directory (to check what a workflow changed). */
app.get("/directory", (c) => c.json({ users: directory.listUsers(), groups: directory.listGroups() }));
app.post("/directory/reset", (c) => {
  directory.reset();
  return c.json({ ok: true });
});
