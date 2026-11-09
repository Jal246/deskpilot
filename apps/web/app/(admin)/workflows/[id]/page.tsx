import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Badge, formatDate, LinkButton, Loading, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getWorkflow, isUuid, testedVersionIds } from "@/lib/data";
import { callWorker, type DirectoryResponse } from "@/lib/worker-client";
import { Workbench } from "./workbench";

// Workflow page: versions, code, test runs with a form built from the input schema, publish.
// Edit opens the builder, which saves a new draft version.
export default async function WorkflowPage({ params }: PageProps<"/workflows/[id]">) {
  const user = await requireStaff();
  const { id } = await params;
  const workflow = isUuid(id) ? await getWorkflow(user.orgId, id) : undefined;
  if (!workflow) notFound();
  const tested = new Set(await testedVersionIds(workflow.id));

  // The help desk only runs a published workflow's current version, so "live" needs both.
  const liveVersionId = workflow.status === "published" ? workflow.currentVersionId : null;

  return (
    <>
      <PageHeader
        title={workflow.name}
        description={workflow.description}
        actions={
          <>
            <LinkButton href={`/runs?workflow=${workflow.id}`} variant="secondary">
              View runs
            </LinkButton>
            {user.role === "admin" && <LinkButton href={`/workflows/${workflow.id}/edit`}>Edit</LinkButton>}
          </>
        }
      />
      <Workbench
        workflowId={workflow.id}
        isAdmin={user.role === "admin"}
        liveVersionId={liveVersionId}
        versions={workflow.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          code: v.code,
          inputSchema: v.inputSchema,
          prompt: v.prompt,
          createdLabel: formatDate(v.createdAt),
          tested: tested.has(v.id),
        }))}
        directoryPanel={
          <Suspense fallback={<Loading />}>
            <DirectoryPanel />
          </Suspense>
        }
      />
    </>
  );
}

/** The fake directory inside the worker, so you can see what a test run changed. */
async function DirectoryPanel() {
  const data = await callWorker<DirectoryResponse>("/directory").then(
    (res) => res.data,
    () => null,
  );
  if (!data) return <p className="text-xs text-red-600">Can&apos;t reach the worker. Is `pnpm dev` running?</p>;
  return (
    <ul className="space-y-2 text-xs">
      {data.users.map((u) => (
        <li key={u.email}>
          <div className="font-medium">
            {u.email} {u.locked && <Badge tone="red">locked</Badge>}
          </div>
          <div className="text-zinc-500">{u.groups.join(", ") || "no groups"}</div>
        </li>
      ))}
    </ul>
  );
}
