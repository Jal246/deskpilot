"use server";

import { requireUser } from "@/lib/auth";
import { callWorker, WorkerUnavailableError, type ChatEvent, type ChatResponse } from "@/lib/worker-client";

export type ChatTurnInput = { role: "user" | "assistant"; content: string };
export type SendResult = { ok: true; reply: string; events: ChatEvent[] } | { ok: false; error: string };

const MAX_HISTORY = 30;

/** One chat turn. Who is asking comes from the session, never from the browser. */
export async function sendChat(history: ChatTurnInput[]): Promise<SendResult> {
  const user = await requireUser();
  if (!Array.isArray(history)) return { ok: false, error: "Bad request." };
  const messages = history
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "").slice(0, 4_000) }));

  try {
    const res = await callWorker<ChatResponse>("/chat", {
      method: "POST",
      body: { orgId: user.orgId, userId: user.id, messages },
    });
    if (!res.data.ok) return { ok: false, error: res.data.message };
    return { ok: true, reply: res.data.reply, events: res.data.events };
  } catch (err) {
    if (err instanceof WorkerUnavailableError) return { ok: false, error: "The help desk is offline right now. Try again in a minute." };
    throw err;
  }
}
