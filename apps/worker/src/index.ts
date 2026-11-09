import { timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MockDirectoryStore } from "@deskpilot/sdk";
import { checkWorkflow } from "./runner/check-workflow";
import { runWorkflow } from "./runner/run-workflow";

// The worker: runs workflows in the sandbox and (step 7) hosts the help desk agent.
const app = new Hono();
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

const port = Number(process.env.WORKER_PORT ?? 4000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`[worker] listening on http://localhost:${port}`);
});
