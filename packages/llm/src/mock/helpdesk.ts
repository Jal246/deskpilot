// The free mock help desk agent. It reads the conversation like a real model would and
// answers with text or tool calls, using simple rules:
//   - a request that matches a published workflow → describe it, ask "Shall I go ahead?",
//     and call the workflow tool after "yes"
//   - a question → search_kb, answer from the best article (or open a ticket if none)
//   - anything else → create_ticket
// It's stateless: everything it needs is in the messages, so it behaves like a real model.
import type { ChatMessage, ChatRequest, ChatTurn, ToolCall, ToolDef } from "../types";
import { pickTemplate } from "./match";

export const CONFIRM = "Shall I go ahead?";
export const OFFER_TICKET = "Want me to open a ticket for IT?";
const BUILTIN = new Set(["search_kb", "create_ticket"]);

type Plan =
  | { kind: "workflow"; tool: ToolDef; input: Record<string, unknown> }
  | { kind: "ask"; text: string }
  | { kind: "question" }
  | { kind: "ticket" };

export function mockHelpdeskTurn(req: ChatRequest): ChatTurn {
  const { messages } = req;
  const last = messages.at(-1);
  if (!last) return say("Hi! What can I help you with?");
  if (last.role === "tool") return afterTools(req);
  if (last.role !== "user") return say("What else can I help you with?");

  const text = last.content.trim();
  const prev = previousAssistant(messages);

  // Answers to our own questions.
  if (prev?.content.endsWith(CONFIRM)) {
    if (isYes(text)) {
      const plan = planFor(userMessageBefore(messages, prev), req);
      if (plan.kind === "workflow") return call(messages, plan.tool.name, plan.input);
    } else if (isNo(text)) {
      return say("No problem, I won't change anything. Anything else I can help with?");
    }
  }
  if (prev?.content.endsWith(OFFER_TICKET)) {
    if (isYes(text)) return ticketCall(messages, userMessageBefore(messages, prev));
    if (isNo(text)) return say("Okay. Let me know if there's anything else.");
  }

  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b[\s!.]*$/i.test(text)) {
    return say(`Hi ${firstName(req.user.name)}! What can I help you with today?`);
  }
  if (/^(thanks|thank you|thx|cheers)\b/i.test(text)) return say("You're welcome! Anything else?");
  if (/\b(open|create|file|raise)\b.*\bticket\b|\bdidn'?t (help|work)\b|\bstill (broken|not working)\b/i.test(text)) {
    const earlier = userMessageBefore(messages, prev);
    return ticketCall(messages, earlier && earlier !== text ? `${earlier}\n\n${text}` : text);
  }

  const plan = planFor(text, req);
  switch (plan.kind) {
    case "workflow":
      return say(`I can do that for you with the **${toolTitle(plan.tool)}** workflow (${describeInput(plan.input)}). ${CONFIRM}`);
    case "ask":
      return say(plan.text);
    case "question":
      return call(messages, "search_kb", { query: text.slice(0, 200) });
    case "ticket":
      return ticketCall(messages, text);
  }
}

/** What to do about one user message, given the tools on offer. */
function planFor(text: string, req: ChatRequest): Plan {
  const intent = pickTemplate(text);
  const tool = intent
    ? req.tools.find((t) => !BUILTIN.has(t.name) && pickTemplate(`${t.name.replace(/[_-]/g, " ")} ${t.description}`)?.id === intent.id)
    : undefined;

  if (tool) {
    const props = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string }>;
    const required = (tool.inputSchema.required ?? []) as string[];
    const input: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const key of Object.keys(props)) {
      if (/email/i.test(key)) input[key] = req.user.email;
      else if (key === "group") {
        const group = extractGroup(text);
        if (group) input[key] = group;
      }
      if (required.includes(key) && input[key] === undefined) missing.push(key);
    }
    if (missing.length === 0) return { kind: "workflow", tool, input };
    if (missing.length === 1 && missing[0] === "group") {
      return { kind: "ask", text: 'Which group? Say it like "add me to the design group".' };
    }
    // A workflow exists but needs details the mock can't fill in: let a person handle it.
  }
  return isQuestion(text) ? { kind: "question" } : { kind: "ticket" };
}

/** Turn tool results into an answer (or one more tool call). */
function afterTools(req: ChatRequest): ChatTurn {
  const { messages } = req;
  const results: Array<{ name: string; data: Record<string, unknown> }> = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "tool") break;
    results.unshift({ name: m.name, data: parse(m.content) });
  }
  const { name, data } = results[results.length - 1];
  const question = userMessageBefore(messages, undefined);

  if (name === "search_kb") {
    const hits = Array.isArray(data.results) ? (data.results as Array<{ title: string; body: string }>) : [];
    if (hits.length === 0) return ticketCall(messages, question);
    const [top] = hits;
    return say(
      `Here's what our help articles say:\n\n**${top.title}**\n${top.body}\n\nIf that doesn't solve it, say "open a ticket" and I'll pass it to IT.`,
    );
  }
  if (name === "create_ticket") {
    if (data.ok !== true) return say(`Sorry, I couldn't open a ticket: ${String(data.error ?? "unknown error")}.`);
    return say(`I've opened a ticket for IT: "${String(data.title)}". They'll follow up with you soon.`);
  }

  // A workflow tool.
  if (data.ok !== true) return say(`Sorry, I couldn't run that: ${String(data.error ?? "unknown error")}. ${OFFER_TICKET}`);
  if (data.status !== "succeeded") {
    return say(`Sorry, that didn't work (${String(data.error ?? data.status)}). ${OFFER_TICKET}`);
  }
  return say(`Done! ${describeOutput(data.output)}`);
}

// ---------- helpers ----------
const say = (text: string): ChatTurn => ({ text, toolCalls: [] });

function call(messages: ChatMessage[], name: string, input: Record<string, unknown>): ChatTurn {
  const toolCall: ToolCall = { id: `call_${messages.length}`, name, input };
  return { text: "", toolCalls: [toolCall] };
}

function ticketCall(messages: ChatMessage[], about: string): ChatTurn {
  const text = about.trim() || "Help desk request";
  const title = text.split("\n")[0].replace(/\s+/g, " ").slice(0, 80);
  return call(messages, "create_ticket", { title, description: text.slice(0, 2000) });
}

function previousAssistant(messages: ChatMessage[]) {
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.content) return m;
    if (m.role === "user") return undefined; // two user messages in a row: nothing to answer
  }
  return undefined;
}

/** The last user message before `before` (or before the end when `before` is undefined). */
function userMessageBefore(messages: ChatMessage[], before: ChatMessage | undefined): string {
  const end = before ? messages.lastIndexOf(before) : messages.length;
  for (let i = end - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && !isYes(m.content) && !isNo(m.content)) return m.content;
  }
  return "";
}

// Whole-message answers only: "please reset my password" is a request, not a "yes".
const isYes = (t: string) =>
  /^(y|yes|yeah|yep|yup|sure|ok|okay|please|please do|go ahead|do it)([\s,]+(please|thanks|thank you|go ahead))?[\s!.]*$/i.test(t.trim());
const isNo = (t: string) => /^(n|no|nope|nah|don'?t|cancel|stop|never ?mind)([\s,]+thanks)?[\s!.]*$/i.test(t.trim());
const isQuestion = (t: string) =>
  /\?\s*$/.test(t) || /^(how|what|where|why|when|which|who|can|could|is|are|do|does|should)\b/i.test(t.trim());

function extractGroup(text: string): string | undefined {
  const t = text.toLowerCase();
  const m =
    /\b(?:to|into|join|from|of|leave)\s+(?:the\s+)?([a-z0-9][a-z0-9-]*)\s+group\b/.exec(t) ??
    /\bgroup\s+(?:called\s+|named\s+)?["']?([a-z0-9][a-z0-9-]*)/.exec(t);
  const group = m?.[1];
  return group && !NOT_A_GROUP.has(group) ? group : undefined;
}
const NOT_A_GROUP = new Set(["a", "an", "my", "our", "this", "that", "some", "any", "another", "new", "right", "correct"]);

const firstName = (name: string) => name.split(" ")[0] || name;
const toolTitle = (t: ToolDef) => t.description.split(":")[0].trim() || t.name;
const describeInput = (input: Record<string, unknown>) =>
  Object.entries(input)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(", ") || "no inputs";

function describeOutput(output: unknown): string {
  if (!output || typeof output !== "object") return output === undefined || output === null ? "" : String(output);
  const o = output as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.message === "string") parts.push(o.message);
  for (const [k, v] of Object.entries(o)) {
    if (k === "ok" || k === "message") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") parts.push(`${k}: ${String(v)}`);
  }
  return parts.join("\n");
}

function parse(json: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
