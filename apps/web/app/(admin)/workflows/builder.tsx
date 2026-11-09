"use client";

// The builder screen: describe → generate → review/edit in Monaco → save as a new version.
// Used for new workflows (/workflows/new) and new versions (/workflows/[id]/edit).
import { useState, useTransition } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { CodeEditor } from "@/components/code-editor";
import { generateDraft, saveDraft, type SaveResult } from "./builder-actions";

export type BuilderInitial = {
  name: string;
  description: string;
  code: string;
  inputSchema: string;
  prompt: string;
};

type Props = {
  workflowId?: string;
  initial?: BuilderInitial;
  /** Version the edit starts from, e.g. "v2", shown as a hint. */
  basedOn?: string;
  sdkDts: string;
};

const EXAMPLES = [
  "Reset a user's password",
  "Add a user to a group",
  "Remove a user from a group",
  "Onboard a new hire into their team's groups",
  "Look up a user's details",
];

export function Builder({ workflowId, initial, basedOn, sdkDts }: Props) {
  const editing = Boolean(workflowId);
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [draft, setDraft] = useState<BuilderInitial | null>(initial ?? null);
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [generating, startGenerate] = useTransition();
  const [saving, startSave] = useTransition();

  const update = (patch: Partial<BuilderInitial>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const generate = () => {
    if (draft && dirty && !window.confirm("Replace your edits with newly generated code?")) return;
    setGenError(null);
    startGenerate(async () => {
      const res = await generateDraft(prompt);
      if (!res.ok) {
        setGenError(res.error);
        return;
      }
      const g = res.draft;
      setDraft((d) => ({
        // When editing, keep the workflow's name/description; the code and schema are what change.
        name: editing && d ? d.name : g.name,
        description: editing && d ? d.description : g.description,
        code: g.code,
        inputSchema: JSON.stringify(g.inputSchema, null, 2),
        prompt,
      }));
      setNotes(g.notes ?? null);
      setDirty(false);
      setSaveResult(null);
    });
  };

  const save = () => {
    if (!draft) return;
    setSaveResult(null);
    startSave(async () => {
      // On success the action redirects to the workflow page, so a result means something went wrong.
      const res = await saveDraft({ workflowId, ...draft, prompt: draft.prompt || prompt });
      if (res) setSaveResult(res);
    });
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-3 p-4">
        <Field
          label={editing ? "Regenerate from a description (optional)" : "What should this workflow do?"}
          hint={
            editing
              ? "Replaces the code and input schema below. Nothing is saved until you click Save."
              : "Describe it in plain words. The builder writes the code; you review it before saving."
          }
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
            }}
            rows={3}
            maxLength={2000}
            placeholder="e.g. Reset a user's password and unlock their account"
            className={inputClass}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={generate} disabled={generating || !prompt.trim()}>
            {generating ? "Generating…" : draft ? "Regenerate" : "Generate"}
          </Button>
          {!draft &&
            EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                {ex}
              </button>
            ))}
        </div>
        {genError && <p className="text-sm text-red-600">{genError}</p>}
        {notes && <p className="text-xs text-zinc-500">{notes}</p>}
      </Card>

      {draft && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input value={draft.name} onChange={(e) => update({ name: e.target.value })} maxLength={80} className={inputClass} />
            </Field>
            <Field label="Description" hint="The help desk reads this to decide when to offer the workflow.">
              <input
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
                maxLength={500}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Code</span>
              <span className="text-xs text-zinc-500">
                {basedOn ? `Starting from ${basedOn}. ` : ""}No imports; everything goes through <code>sdk</code>. Hover it for docs.
              </span>
            </div>
            <CodeEditor
              language="typescript"
              path="workflow.ts"
              height={380}
              value={draft.code}
              onChange={(code) => update({ code })}
              extraLib={sdkDts}
            />
            <Problems items={saveResult?.codeProblems} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Input schema</span>
              <span className="text-xs text-zinc-500">JSON Schema for <code>input</code>. Step 6 builds the test form from it.</span>
            </div>
            <CodeEditor
              language="json"
              path="input-schema.json"
              height={200}
              value={draft.inputSchema}
              onChange={(inputSchema) => update({ inputSchema })}
            />
            <Problems items={saveResult?.schemaProblems} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Checking & saving…" : editing ? "Save as new version" : "Save draft"}
            </Button>
            <span className="text-xs text-zinc-500">
              {editing
                ? "Saves a new draft version. The live version keeps running until you publish."
                : "Saved as a draft. The help desk can't use it until it's published."}
            </span>
          </div>
          {saveResult?.error && <p className="text-sm text-red-600">{saveResult.error}</p>}
        </>
      )}
    </div>
  );
}

function Problems({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-600">
      {items.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}
