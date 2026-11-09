// A starting value for the test-run inputs box, built from a workflow's JSON Schema.
// (Step 6 replaces the JSON box with a real form generated from the schema.)
type Prop = { type?: string; format?: string; enum?: unknown[]; default?: unknown };

export function exampleInput(schema: unknown): Record<string, unknown> {
  const props = (schema as { properties?: Record<string, Prop> } | null)?.properties ?? {};
  return Object.fromEntries(Object.entries(props).map(([key, p]) => [key, exampleValue(key, p)]));
}

function exampleValue(key: string, p: Prop): unknown {
  if (p.default !== undefined) return p.default;
  if (p.enum?.length) return p.enum[0];
  if (p.format === "email" || key.toLowerCase().includes("email")) return "employee@acme.test";
  if (key.toLowerCase().includes("group")) return "design";
  switch (p.type) {
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "";
  }
}
