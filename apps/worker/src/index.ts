// Starts the worker's HTTP server. The routes live in app.ts.
import { serve } from "@hono/node-server";
import { app } from "./app";

const port = Number(process.env.WORKER_PORT ?? 4000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`[worker] listening on http://localhost:${port}`);
});
