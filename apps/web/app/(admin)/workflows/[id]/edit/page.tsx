import { notFound } from "next/navigation";
import { SDK_DTS } from "@deskpilot/sdk";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getWorkflow, isUuid } from "@/lib/data";
import { Builder } from "../../builder";

// Edit = start from the newest version and save a new one. Old versions are never changed.
export default async function EditWorkflowPage({ params }: PageProps<"/workflows/[id]/edit">) {
  const user = await requireAdmin();
  const { id } = await params;
  const workflow = isUuid(id) ? await getWorkflow(user.orgId, id) : undefined;
  if (!workflow) notFound();

  const latest = workflow.versions[0]; // versions are newest first
  return (
    <>
      <PageHeader
        title={`Edit: ${workflow.name}`}
        description="Saving creates a new draft version. Employees keep getting the live version until you publish."
        actions={
          <LinkButton href={`/workflows/${workflow.id}`} variant="secondary">
            Cancel
          </LinkButton>
        }
      />
      <Builder
        workflowId={workflow.id}
        basedOn={latest ? `v${latest.versionNumber}` : undefined}
        sdkDts={SDK_DTS}
        initial={{
          name: workflow.name,
          description: workflow.description,
          code: latest?.code ?? "",
          inputSchema: JSON.stringify(latest?.inputSchema ?? { type: "object", properties: {} }, null, 2),
          prompt: latest?.prompt ?? "",
        }}
      />
    </>
  );
}
