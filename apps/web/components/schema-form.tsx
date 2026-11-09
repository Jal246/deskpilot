"use client";

// A form built from a workflow's JSON Schema: one field per input. Handles the shapes
// workflows use (text, email, enum, number, boolean, list of text/numbers); anything
// else gets a small JSON box. "Edit as JSON" switches to raw JSON for full control.
// Nothing here is trusted: the worker checks the inputs against the schema again.
import { useState, type FormEvent, type ReactNode } from "react";
import { exampleInput } from "@/lib/schema-example";
import { inputClass } from "./ui";

type Prop = {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  description?: string;
  title?: string;
  items?: { type?: string };
};
type Schema = { properties?: Record<string, Prop>; required?: string[] };

type Kind = "text" | "email" | "enum" | "number" | "integer" | "boolean" | "list" | "json";
type FieldValue = string | boolean;

export type SchemaFormResult = { ok: true; inputs: Record<string, unknown> } | { ok: false; error: string };

function kindOf(p: Prop): Kind {
  const type = Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type;
  if (p.enum?.length && p.enum.every((v) => typeof v === "string")) return "enum";
  if (type === "string") return p.format === "email" ? "email" : "text";
  if (type === "number") return "number";
  if (type === "integer") return "integer";
  if (type === "boolean") return "boolean";
  if (type === "array" && (p.items?.type === "string" || p.items?.type === "number" || p.items?.type === "integer")) return "list";
  return "json";
}

/** Form fields as text (or a checkbox), from a starting input object. */
function toFields(schema: Schema, input: Record<string, unknown>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const [key, p] of Object.entries(schema.properties ?? {})) {
    const v = input[key];
    const kind = kindOf(p);
    if (kind === "boolean") out[key] = v === true;
    else if (kind === "list") out[key] = Array.isArray(v) ? v.join(", ") : "";
    else if (kind === "json") out[key] = v === undefined ? "" : JSON.stringify(v);
    else if (kind === "number" || kind === "integer") out[key] = typeof v === "number" ? String(v) : "";
    else out[key] = typeof v === "string" ? v : "";
  }
  return out;
}

/** Fields → input object. Empty fields are left out, so "required" errors name the field. */
function fromFields(schema: Schema, fields: Record<string, FieldValue>): SchemaFormResult {
  const inputs: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(schema.properties ?? {})) {
    const raw = fields[key];
    const kind = kindOf(p);
    if (kind === "boolean") {
      inputs[key] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    if (kind === "number" || kind === "integer") {
      const n = Number(text);
      if (!Number.isFinite(n)) return { ok: false, error: `${key} must be a number` };
      inputs[key] = n;
    } else if (kind === "list") {
      const parts = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      inputs[key] = p.items?.type === "string" ? parts : parts.map(Number);
    } else if (kind === "json") {
      try {
        inputs[key] = JSON.parse(text);
      } catch {
        return { ok: false, error: `${key} must be valid JSON` };
      }
    } else {
      inputs[key] = text;
    }
  }
  return { ok: true, inputs };
}

type Props = {
  /** The version's JSON Schema (an object schema). */
  schema: Record<string, unknown>;
  /** Gets the inputs (or a problem to show) when the form is submitted. */
  onSubmit: (result: SchemaFormResult) => void;
  /** The submit button and anything else under the fields. */
  children: ReactNode;
};

/** Give it `key={versionId}` so the fields reset when the schema changes. */
export function SchemaForm({ schema: rawSchema, onSubmit, children }: Props) {
  const schema = rawSchema as Schema;
  const props = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const [fields, setFields] = useState(() => toFields(schema, exampleInput(schema)));
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);

  const read = (): SchemaFormResult => {
    if (!jsonMode) return fromFields(schema, fields);
    try {
      const parsed: unknown = JSON.parse(jsonText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "Inputs must be a JSON object" };
      return { ok: true, inputs: parsed as Record<string, unknown> };
    } catch {
      return { ok: false, error: "Inputs must be valid JSON" };
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(read());
  };

  const toggle = () => {
    setSwitchError(null);
    if (!jsonMode) {
      const r = fromFields(schema, fields);
      setJsonText(JSON.stringify(r.ok ? r.inputs : {}, null, 2));
      setJsonMode(true);
      return;
    }
    try {
      const parsed = JSON.parse(jsonText || "{}");
      setFields(toFields(schema, parsed && typeof parsed === "object" ? parsed : {}));
      setJsonMode(false);
    } catch {
      setSwitchError("Fix the JSON first (it doesn't parse).");
    }
  };

  const set = (key: string, v: FieldValue) => setFields((f) => ({ ...f, [key]: v }));

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {jsonMode ? (
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-label="Inputs as JSON"
          className={`${inputClass} font-mono text-xs`}
        />
      ) : props.length === 0 ? (
        <p className="text-sm text-zinc-500">This workflow takes no inputs.</p>
      ) : (
        props.map(([key, p]) => {
          const kind = kindOf(p);
          const label = (
            <span className="text-sm font-medium">
              {p.title ?? key}
              {required.has(key) && <span className="text-red-600"> *</span>}
            </span>
          );
          const hint =
            kind === "list" ? `${p.description ? `${p.description}. ` : ""}Separate items with commas.` : p.description;
          const value = fields[key];
          return (
            <label key={key} className="block space-y-1.5">
              {kind === "boolean" ? (
                <span className="flex items-center gap-2">
                  <input type="checkbox" checked={value === true} onChange={(e) => set(key, e.target.checked)} />
                  {label}
                </span>
              ) : (
                <>
                  {label}
                  {kind === "enum" ? (
                    <select value={String(value)} onChange={(e) => set(key, e.target.value)} className={inputClass}>
                      {!required.has(key) && <option value="">—</option>}
                      {(p.enum as string[]).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : kind === "json" ? (
                    <textarea
                      value={String(value)}
                      onChange={(e) => set(key, e.target.value)}
                      rows={3}
                      spellCheck={false}
                      placeholder="JSON"
                      className={`${inputClass} font-mono text-xs`}
                    />
                  ) : (
                    <input
                      type={kind === "email" ? "email" : kind === "number" || kind === "integer" ? "number" : "text"}
                      step={kind === "integer" ? 1 : "any"}
                      value={String(value)}
                      onChange={(e) => set(key, e.target.value)}
                      className={inputClass}
                    />
                  )}
                </>
              )}
              {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
            </label>
          );
        })
      )}
      <button type="button" onClick={toggle} className="text-xs text-zinc-500 underline-offset-2 hover:underline">
        {jsonMode ? "Back to form" : "Edit as JSON"}
      </button>
      {switchError && <p className="text-xs text-red-600">{switchError}</p>}
      {children}
    </form>
  );
}
