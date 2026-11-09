// Scores a piece of text against the templates' keywords. Used by the mock builder
// (prompt → template) and the mock help desk (user message → matching workflow).
import { TEMPLATES, type Template } from "./templates";

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
