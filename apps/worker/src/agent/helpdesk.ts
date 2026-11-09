// The help desk agent: a small tool-use loop. Ask the model → run the tools it asks for →
// give it the results → repeat, at most MAX_TURNS times. All the safety rules live in the
// tools (tools.ts) and runWorkflow, not in the prompt.
import { db, eq, organizations, users, and } from "@deskpilot/db";
import { getLlm, helpdeskSystemPrompt, type ChatMessage } from "@deskpilot/llm";
import type { HostDeps } from "@deskpilot/sdk";
import { loadToolbox, type AgentEvent } from "./tools";

const MAX_TURNS = 4;
const MAX_TOOL_CALLS_PER_TURN = 3;
export const MAX_HISTORY = 30;
export const MAX_MESSAGE_CHARS = 4_000;

/** The chat history as the browser sends it: plain text only, no tool messages. */
export type HistoryMessage = { role: "user" | "assistant"; content: string };

export type HelpdeskReply =
  | { ok: true; reply: string; events: AgentEvent[] }
  | { ok: false; code: "not_found" | "bad_request"; message: string };

export async function helpdeskChat(
  req: { orgId: string; userId: string; messages: HistoryMessage[] },
  deps: HostDeps,
): Promise<HelpdeskReply> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, orgName: organizations.name })
    .from(users)
    .innerJoin(organizations, eq(users.orgId, organizations.id))
    .where(and(eq(users.id, req.userId), eq(users.orgId, req.orgId)));
  if (!row) return { ok: false, code: "not_found", message: "User not found" };

  const user = { id: row.id, name: row.name, email: row.email };
  const toolbox = await loadToolbox({ orgId: req.orgId, user, deps });
  const llm = getLlm();
  const system = helpdeskSystemPrompt(user, row.orgName);

  const messages: ChatMessage[] = req.messages.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
  const events: AgentEvent[] = [];
  const texts: string[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await llm.chatWithTools({ system, user, messages, tools: toolbox.defs });
    if (res.text.trim()) texts.push(res.text.trim());
    if (res.toolCalls.length === 0) return { ok: true, reply: texts.join("\n\n"), events };

    const calls = res.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN);
    messages.push({ role: "assistant", content: res.text, toolCalls: calls });
    for (const call of calls) {
      const outcome = await toolbox.execute(call);
      if (outcome.event) events.push(outcome.event);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(outcome.result) });
    }
  }
  texts.push("Sorry, I got stuck on that one. Try rephrasing, or ask me to open a ticket.");
  return { ok: true, reply: texts.join("\n\n"), events };
}

/** Checks the browser's history shape. Returns an error message, or null if fine. */
export function validateHistory(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array";
  if (messages.length > 200) return "too many messages";
  for (const m of messages) {
    if (!m || typeof m !== "object") return "each message must be an object";
    const { role, content } = m as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") return 'role must be "user" or "assistant"';
    if (typeof content !== "string" || content.length > MAX_MESSAGE_CHARS) return `content must be a string of at most ${MAX_MESSAGE_CHARS} characters`;
  }
  const last = messages[messages.length - 1] as HistoryMessage;
  if (last.role !== "user" || !last.content.trim()) return "the last message must be a non-empty user message";
  return null;
}
