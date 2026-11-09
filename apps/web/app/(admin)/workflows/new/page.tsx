import { SDK_DTS } from "@deskpilot/sdk";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { Builder } from "../builder";

export default async function NewWorkflowPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="New workflow"
        description="Describe an automation, review the code the builder writes, then save it as a draft."
      />
      <Builder sdkDts={SDK_DTS} />
    </>
  );
}
