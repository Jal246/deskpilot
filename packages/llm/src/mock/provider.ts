// The free default provider. No network, no API key: it reads the admin's prompt,
// scores it against the templates' keywords and returns the best match.
import type { GeneratedWorkflow, GenerateWorkflowRequest, LlmProvider } from "../types";
import { starterTemplate, TEMPLATES, type Template } from "./templates";

const MIN_SCORE = 3;

export function scoreTemplate(prompt: string, template: Template): number {
  const text = prompt.toLowerCase().replace(/[’']/g, "'");
  let score = 0;
  for (const [phrase, weight] of template.keywords) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    // "remove" also matches "removes", "removed", "removing".
    if (new RegExp(`\\b${escaped}(s|es|d|ed|ing)?\\b`).test(text)) score += weight;
  }
  return score;
}

export function pickTemplate(prompt: string): Template | null {
  let best: Template | null = null;
  let bestScore = 0;
  for (const t of TEMPLATES) {
    const s = scoreTemplate(prompt, t);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}

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
}
