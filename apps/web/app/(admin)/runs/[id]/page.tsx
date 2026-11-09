import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, formatDate, formatDuration, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getRun, isUuid } from "@/lib/data";
import { RunLogs } from "@/components/run-logs";

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const user = await requireStaff();
  const { id } = await params;
  const run = isUuid(id) ? await getRun(user.orgId, id) : undefined;
  if (!run) notFound();

  return (
    <>
      <PageHeader
        title={`Run of ${run.workflowName}`}
        description={`v${run.versionNumber} · ${run.trigger} · ${run.triggeredBy ?? "unknown user"}`}
        actions={<StatusBadge status={run.status} />}
      />
      <div className="mb-6 flex flex-wrap gap-6 text-sm">
        <span>
          <span className="text-zinc-500">Started</span> {formatDate(run.startedAt)}
        </span>
        <span>
          <span className="text-zinc-500">Duration</span> {formatDuration(run.startedAt, run.finishedAt)}
        </span>
        <Link href={`/workflows/${run.workflowId}`} className="hover:underline">
          Open workflow →
        </Link>
      </div>

      {run.error && (
        <Card className="mb-6 border-red-300 p-4 dark:border-red-900">
          <div className="mb-1 text-sm font-medium text-red-700 dark:text-red-400">Error</div>
          <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">{run.error}</pre>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <JsonBlock title="Inputs" value={run.inputs} />
        <JsonBlock title="Outputs" value={run.outputs} />
      </div>

      <h2 className="mt-6 mb-2 text-sm font-medium">Logs</h2>
      <Card>
        <RunLogs logs={run.logs} />
      </Card>
    </>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <Card>
        <pre className="overflow-x-auto p-4 font-mono text-xs">
          {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
        </pre>
      </Card>
    </section>
  );
}
