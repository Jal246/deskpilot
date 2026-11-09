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

export interface LlmProvider {
  readonly name: string;
  generateWorkflow(req: GenerateWorkflowRequest): Promise<GeneratedWorkflow>;
  // Step 7 adds: chatWithTools(...) for the help desk agent.
}

export class LlmError extends Error {}
