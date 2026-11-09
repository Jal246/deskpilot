import Link from "next/link";
import { EmptyRow, formatDate, formatDuration, inputClass, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { isUuid, listRuns, listWorkflows, RUN_STATUSES } from "@/lib/data";

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  const user = await requireStaff();
  const sp = await searchParams;
  const workflowId = typeof sp.workflow === "string" && isUuid(sp.workflow) ? sp.workflow : undefined;
  const status = typeof sp.status === "string" ? sp.status : undefined;

  const [runs, workflows] = await Promise.all([
    listRuns(user.orgId, { workflowId, status }),
    listWorkflows(user.orgId),
  ]);

  return (
    <>
      <PageHeader title="Runs" description="Every time a workflow ran: who triggered it, how, and what happened." />

      {/* Plain GET form: filters live in the URL, so they work without JavaScript. */}
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <select name="workflow" defaultValue={workflowId ?? ""} className={`${inputClass} w-auto`}>
          <option value="">All workflows</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ""} className={`${inputClass} w-auto`}>
          <option value="">Any status</option>
          {RUN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">Filter</button>
        {(workflowId || status) && (
          <Link href="/runs" className="px-2 py-2 text-sm text-zinc-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <Table head={["Workflow", "Status", "Trigger", "By", "Started", "Duration"]}>
        {runs.length === 0 && (
          <EmptyRow cols={6}>No runs yet. Test runs arrive in step 4, help desk runs in step 7.</EmptyRow>
        )}
        {runs.map((r) => (
          <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <Td>
              <Link href={`/runs/${r.id}`} className="font-medium hover:underline">
                {r.workflowName}
              </Link>{" "}
              <span className="text-xs text-zinc-500">v{r.versionNumber}</span>
            </Td>
            <Td>
              <StatusBadge status={r.status} />
            </Td>
            <Td>{r.trigger}</Td>
            <Td className="text-zinc-500">{r.triggeredBy ?? "—"}</Td>
            <Td>{formatDate(r.startedAt)}</Td>
            <Td>{formatDuration(r.startedAt, r.finishedAt)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
