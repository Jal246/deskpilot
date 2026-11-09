// The free default provider. No network, no API key: it reads the admin's prompt,
// scores it against the templates' keywords and returns the best match.
import type { ChatRequest, ChatTurn, GeneratedWorkflow, GenerateWorkflowRequest, LlmProvider } from "../types";
import { mockHelpdeskTurn } from "./helpdesk";
import { pickTemplate } from "./match";
import { starterTemplate } from "./templates";

export { pickTemplate, scoreTemplate } from "./match";

export class MockProvider implements LlmProvider {
  readonly name = "mock";

  async generateWorkflow({ prompt }: GenerateWorkflowRequest): Promise<GeneratedWorkflow> {
    const template = pickTemplate(prompt);
    if (template) {
      return { ...template.build(), notes: `Mock builder: matched the "${template.id}" template.` };
    }
    return {
      ...starterTemplate(prompt),
      notes: "Mock builder: no template matched, so this is a starter to edit by hand. (A real model would write it for you.)",
    };
  }

  async chatWithTools(req: ChatRequest): Promise<ChatTurn> {
    return mockHelpdeskTurn(req);
  }
}
