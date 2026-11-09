// Calls from the web app to the worker. Server-only: it carries WORKER_SECRET.
const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:4000";

export class WorkerUnavailableError extends Error {}

export async function callWorker<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}) {
  const secret = process.env.WORKER_SECRET;
  if (!secret) throw new Error("WORKER_SECRET is not set (see .env.example)");
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new WorkerUnavailableError(`Can't reach the worker at ${WORKER_URL}. Is \`pnpm dev\` running?`);
  }
  return { status: res.status, data: (await res.json()) as T };
}

export type TestRunResponse =
  | { ok: true; runId: string; status: string }
  | { ok: false; code: string; message: string; details?: string[] };

export type DirectoryResponse = {
  users: Array<{ email: string; name: string; groups: string[]; locked: boolean }>;
  groups: string[];
};

export type CheckResponse = { ok: true } | { ok: false; codeProblems: string[]; schemaProblems: string[] };
