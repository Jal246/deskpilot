"use client";

// The workflow page's interactive part: pick a version → read its code → test it with a
// form built from its input schema → see the result and logs → publish it.
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Badge, Button, Card, StatusBadge } from "@/components/ui";
import { RunLogs } from "@/components/run-logs";
import { SchemaForm, type SchemaFormResult } from "@/components/schema-form";
import { publishVersion, resetDirectory, testRun, unpublishWorkflow, type TestRunOutcome } from "./actions";

export type WorkbenchVersion = {
  id: string;
  versionNumber: number;
  code: string;
  inputSchema: Record<string, unknown>;
  prompt: string | null;
  createdLabel: string;
  /** Has at least one successful run (required before publishing). */
  tested: boolean;
};

type Props = {
  workflowId: string;
  isAdmin: boolean;
  /** Set only while the workflow is published. */
  liveVersionId: string | null;
  versions: WorkbenchVersion[]; // newest first
  /** Server-rendered panel showing the mock directory. */
  directoryPanel: ReactNode;
};

export function Workbench({ workflowId, isAdmin, liveVersionId, versions, directoryPanel }: Props) {
  const [selectedId, setSelectedId] = useState(versions[0]?.id);
  const [outcome, setOutcome] = useState<(TestRunOutcome & { versionNumber: number }) | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [running, startRun] = useTransition();
  const [publishing, startPublish] = useTransition();
  const [resetting, startReset] = useTransition();

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];
  const live = versions.find((v) => v.id === liveVersionId);
  if (!selected) return <p className="text-sm text-zinc-500">This workflow has no versions yet.</p>;
  const isLive = selected.id === liveVersionId;

  const run = (form: SchemaFormResult) => {
    setFormError(null);
    if (!form.ok) {
      setFormError(form.error);
      return;
    }
    startRun(async () => {
      const res = await testRun(workflowId, selected.id, form.inputs);
      setOutcome({ ...res, versionNumber: selected.versionNumber });
    });
  };

  const publish = () => {
    if (live && !window.confirm(`Replace live v${live.versionNumber} with v${selected.versionNumber}? Employees get the new one right away.`)) return;
    setPublishError(null);
    startPublish(async () => {
      const res = await publishVersion(workflowId, selected.id);
      if (!res.ok) setPublishError(res.error);
    });
  };

  const unpublish = () => {
    if (!window.confirm("Take this workflow away from the help desk? You can publish it again later.")) return;
    setPublishError(null);
    startPublish(async () => {
      const res = await unpublishWorkflow(workflowId);
      if (!res.ok) setPublishError(res.error);
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="min-w-0 space-y-4">
        {/* Version picker */}
        <div className="flex flex-wrap items-center gap-2">
          {versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedId(v.id)}
              aria-pressed={v.id === selected.id}
              className={`rounded-md border px-2.5 py-1 text-sm ${
                v.id === selected.id
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              v{v.versionNumber}
              {v.id === liveVersionId && " · live"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Code · v{selected.versionNumber}</span>
          {isLive ? <Badge tone="green">live</Badge> : <Badge tone="amber">draft</Badge>}
          {selected.tested ? <Badge tone="blue">tested</Badge> : <Badge>not tested</Badge>}
          <span className="text-xs text-zinc-500">saved {selected.createdLabel}</span>
        </div>
        {live && !isLive && (
          <p className="text-xs text-zinc-500">Employees get v{live.versionNumber} until you publish this one.</p>
        )}
        {selected.prompt && (
          <p className="text-sm text-zinc-500">
            Built from: <span className="italic">&ldquo;{selected.prompt}&rdquo;</span>
          </p>
        )}
        <Card>
          <pre className="max-h-[28rem] overflow-auto p-4 font-mono text-xs leading-relaxed">{selected.code}</pre>
        </Card>

        {outcome && <RunResult outcome={outcome} />}

        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Input schema</summary>
          <Card className="mt-2">
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
              {JSON.stringify(selected.inputSchema, null, 2)}
            </pre>
          </Card>
        </details>
      </section>

      <aside className="space-y-4">
        {isAdmin && (
          <Card className="p-4">
            <div className="mb-3 text-sm font-medium">Test v{selected.versionNumber}</div>
            <SchemaForm key={selected.id} schema={selected.inputSchema} onSubmit={run}>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <Button type="submit" disabled={running} className="w-full">
                {running ? "Running…" : "Run test"}
              </Button>
              <p className="text-xs text-zinc-500">Runs in the sandbox against the mock directory. Drafts can be tested.</p>
            </SchemaForm>
          </Card>
        )}

        <Card className="space-y-3 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">Help desk access</span>
            <StatusBadge status={liveVersionId ? "published" : "draft"} />
          </div>
          <p className="text-xs text-zinc-500">
            {live
              ? `Employees can run v${live.versionNumber} through the help desk.`
              : "Not published: the help desk can't run any version of this workflow."}
          </p>
          {isAdmin &&
            (isLive ? (
              <Button type="button" variant="secondary" onClick={unpublish} disabled={publishing} className="w-full">
                {publishing ? "Working…" : "Unpublish"}
              </Button>
            ) : (
              <>
                <Button type="button" onClick={publish} disabled={publishing || !selected.tested} className="w-full">
                  {publishing ? "Publishing…" : `Publish v${selected.versionNumber}`}
                </Button>
                {!selected.tested && (
                  <p className="text-xs text-zinc-500">Run a successful test of v{selected.versionNumber} to unlock publishing.</p>
                )}
              </>
            ))}
          {publishError && <p className="text-sm text-red-600">{publishError}</p>}
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Mock directory</span>
            {isAdmin && (
              <button
                type="button"
                disabled={resetting}
                onClick={() => startReset(async () => void (await resetDirectory(workflowId)))}
                className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:opacity-50"
              >
                {resetting ? "Resetting…" : "Reset"}
              </button>
            )}
          </div>
          {directoryPanel}
        </Card>
      </aside>
    </div>
  );
}

function RunResult({ outcome }: { outcome: TestRunOutcome & { versionNumber: number } }) {
  if (!outcome.ok) {
    return (
      <Card className="border-red-300 p-4 text-sm dark:border-red-900">
        <div className="font-medium text-red-700 dark:text-red-400">Didn&apos;t run: {outcome.error}</div>
        {outcome.details && outcome.details.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-red-600">
            {outcome.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </Card>
    );
  }
  const { run } = outcome;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 text-sm dark:border-zinc-800">
        <span className="flex items-center gap-2 font-medium">
          Test result · v{outcome.versionNumber} <StatusBadge status={run.status} />
        </span>
        <Link href={`/runs/${run.id}`} className="text-xs text-zinc-500 hover:underline">
          Open run →
        </Link>
      </div>
      {run.error ? (
        <pre className="overflow-x-auto border-b border-zinc-200 p-4 font-mono text-xs whitespace-pre-wrap text-red-600 dark:border-zinc-800">
          {run.error}
        </pre>
      ) : (
        <pre className="overflow-x-auto border-b border-zinc-200 p-4 font-mono text-xs dark:border-zinc-800">
          {JSON.stringify(run.outputs, null, 2)}
        </pre>
      )}
      <RunLogs logs={run.logs} />
    </Card>
  );
}
