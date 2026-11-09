// The one small interface every AI provider implements. Swapping the model means
// writing one new provider file; nothing else in the app changes.

/** JSON Schema for a workflow's inputs (always an object schema). */
export type InputSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
};

/** What the builder agent hands back: a complete, runnable draft. */
export type GeneratedWorkflow = {
  name: string;
  description: string;
  /** TypeScript: `export default async function run(input, sdk) { ... }`, no imports. */
  code: string;
  inputSchema: InputSchema;
  /** Short note for the admin, e.g. which template the mock picked. */
  notes?: string;
};

export type GenerateWorkflowRequest = {
  /** What the admin typed, e.g. "reset a user's password". */
  prompt: string;
  /** Present when editing: the code we start from. */
  currentCode?: string;
};

// ---------- help desk agent: chat with tools ----------

/** A tool the agent may call. `inputSchema` is JSON Schema (type "object"). */
export type ToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  /** The result of one tool call, as JSON text. */
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ChatRequest = {
  system: string;
  /** Who is asking. Real providers get this through `system`; the mock reads it here. */
  user: { name: string; email: string };
  messages: ChatMessage[];
  tools: ToolDef[];
};

/** Either a final answer (no tool calls) or tool calls to run before asking again. */
export type ChatTurn = { text: string; toolCalls: ToolCall[] };

export interface LlmProvider {
  readonly name: string;
  generateWorkflow(req: GenerateWorkflowRequest): Promise<GeneratedWorkflow>;
  chatWithTools(req: ChatRequest): Promise<ChatTurn>;
}

export class LlmError extends Error {}
