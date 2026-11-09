// The worker's HTTP boundary: only the web app (with WORKER_SECRET) gets in.
import { describe, expect, it } from "vitest";
import { app, MAX_BODY_BYTES } from "./app";

const secret = process.env.WORKER_SECRET!;
const auth = { authorization: `Bearer ${secret}`, "content-type": "application/json" };

describe("worker HTTP", () => {
  it("serves /health without a secret", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("refuses everything else without the right secret", async () => {
    const attempts: Array<Record<string, string>> = [{}, { authorization: "Bearer wrong" }, { authorization: secret }];
    for (const headers of attempts) {
      const res = await app.request("/directory", { headers });
      expect(res.status).toBe(401);
    }
    const chat = await app.request("/chat", { method: "POST", body: "{}" });
    expect(chat.status).toBe(401);
  });

  it("lets the web app in", async () => {
    const res = await app.request("/directory", { headers: auth });
    expect(res.status).toBe(200);
  });

  it("refuses oversized request bodies", async () => {
    const body = JSON.stringify({ code: "x".repeat(MAX_BODY_BYTES + 1), inputSchema: {} });
    const res = await app.request("/workflows/check", { method: "POST", headers: auth, body });
    expect(res.status).toBe(413);
  });

  it("validates chat requests before doing anything", async () => {
    const bad = [
      {},
      { orgId: "nope", userId: "nope", messages: [] },
      { orgId: crypto.randomUUID(), userId: crypto.randomUUID(), messages: [{ role: "tool", content: "{}" }] },
    ];
    for (const b of bad) {
      const res = await app.request("/chat", { method: "POST", headers: auth, body: JSON.stringify(b) });
      expect(res.status).toBe(400);
    }
    const unknownUser = await app.request("/chat", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ orgId: crypto.randomUUID(), userId: crypto.randomUUID(), messages: [{ role: "user", content: "hi" }] }),
    });
    expect(unknownUser.status).toBe(404);
  });

  it("test-run needs valid ids", async () => {
    const res = await app.request("/workflows/not-a-uuid/test-run", { method: "POST", headers: auth, body: "{}" });
    expect(res.status).toBe(400);
  });
});
