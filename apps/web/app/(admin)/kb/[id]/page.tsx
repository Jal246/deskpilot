import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getKbArticle, isUuid } from "@/lib/data";
import { updateArticle } from "../actions";
import { DeleteArticleButton } from "../delete-button";
import { KbForm } from "../kb-form";

export default async function EditKbArticlePage({ params }: PageProps<"/kb/[id]">) {
  const user = await requireAdmin();
  const { id } = await params;
  const article = isUuid(id) ? await getKbArticle(user.orgId, id) : undefined;
  if (!article) notFound();

  return (
    <>
      <PageHeader
        title="Edit article"
        actions={<DeleteArticleButton id={article.id} title={article.title} />}
      />
      <KbForm
        action={updateArticle.bind(null, article.id)}
        initial={{ title: article.title, body: article.body }}
        submitLabel="Save changes"
      />
    </>
  );
}
