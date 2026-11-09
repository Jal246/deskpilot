// Picks the AI provider from LLM_PROVIDER. Default and only option for now: "mock" (free).
// Real providers are added later, one file each, and only with explicit approval.
import { MockProvider } from "./mock/provider";
import { LlmError, type LlmProvider } from "./types";

export * from "./types";
export { BUILDER_SYSTEM_PROMPT } from "./prompts/builder";
export { helpdeskSystemPrompt } from "./prompts/helpdesk";
export { MockProvider, pickTemplate } from "./mock/provider";
export { TEMPLATES } from "./mock/templates";

let cached: LlmProvider | undefined;

export function getLlm(): LlmProvider {
  if (cached) return cached;
  const name = (process.env.LLM_PROVIDER ?? "mock").trim().toLowerCase() || "mock";
  switch (name) {
    case "mock":
      cached = new MockProvider();
      return cached;
    default:
      throw new LlmError(
        `LLM_PROVIDER="${name}" is not available. Only "mock" is set up; real providers need approval first.`,
      );
  }
}
