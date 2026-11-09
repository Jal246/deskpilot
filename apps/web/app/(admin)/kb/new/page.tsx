import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createArticle } from "../actions";
import { KbForm } from "../kb-form";

export default async function NewKbArticlePage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="New article" />
      <KbForm action={createArticle} submitLabel="Create article" />
    </>
  );
}
