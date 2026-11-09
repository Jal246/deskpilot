// "Is this draft safe to save?" Used by the builder before a new version is stored:
// the code must compile under the sandbox rules and the input schema must be a valid
// JSON Schema for an object. Nothing runs here.
import { ajv } from "./ajv";
import { compileWorkflow, CompileError } from "./compile";

const MAX_SCHEMA_CHARS = 20_000;

export type CheckResult = { ok: true } | { ok: false; codeProblems: string[]; schemaProblems: string[] };

export function checkWorkflow(code: unknown, inputSchema: unknown): CheckResult {
  const codeProblems: string[] = [];
  const schemaProblems: string[] = [];

  if (typeof code !== "string" || !code.trim()) {
    codeProblems.push("Code is empty");
  } else {
    try {
      compileWorkflow(code);
    } catch (err) {
      if (err instanceof CompileError) codeProblems.push(...err.problems);
      else codeProblems.push(String(err));
    }
  }

  schemaProblems.push(...checkSchema(inputSchema));

  return codeProblems.length || schemaProblems.length ? { ok: false, codeProblems, schemaProblems } : { ok: true };
}

function checkSchema(schema: unknown): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return ["Input schema must be a JSON object"];
  if (JSON.stringify(schema).length > MAX_SCHEMA_CHARS) return [`Input schema is longer than ${MAX_SCHEMA_CHARS} characters`];

  const s = schema as Record<string, unknown>;
  const problems: string[] = [];
  if (s.type !== "object") problems.push('Input schema must have "type": "object"');
  if (s.properties !== undefined && (typeof s.properties !== "object" || s.properties === null || Array.isArray(s.properties))) {
    problems.push('"properties" must be an object');
  }
  // Checks against the JSON Schema meta-schema without compiling (so nothing is cached).
  if (!ajv.validateSchema(schema)) {
    for (const e of ajv.errors ?? []) problems.push(`schema${e.instancePath.replaceAll("/", ".")} ${e.message ?? "is invalid"}`);
  }
  return problems;
}
