import Link from "next/link";
import { EmptyRow, formatDate, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { DeleteArticleButton } from "./delete-button";
import { listKbArticles } from "@/lib/data";

export default async function KbPage() {
  const user = await requireStaff();
  const articles = await listKbArticles(user.orgId);
  const canEdit = user.role === "admin";

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Articles the help desk agent searches before opening a ticket."
        actions={canEdit && <LinkButton href="/kb/new">New article</LinkButton>}
      />
      <Table head={canEdit ? ["Title", "Preview", "Updated", ""] : ["Title", "Preview", "Updated"]}>
        {articles.length === 0 && <EmptyRow cols={canEdit ? 4 : 3}>No articles yet.</EmptyRow>}
        {articles.map((a) => (
          <tr key={a.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <Td className="font-medium">
              {canEdit ? (
                <Link href={`/kb/${a.id}`} className="hover:underline">
                  {a.title}
                </Link>
              ) : (
                a.title
              )}
            </Td>
            <Td className="max-w-md text-zinc-500">
              <span className="line-clamp-2">{a.body}</span>
            </Td>
            <Td className="whitespace-nowrap text-zinc-500">{formatDate(a.updatedAt)}</Td>
            {canEdit && (
              <Td className="whitespace-nowrap text-right">
                <LinkButton href={`/kb/${a.id}`} variant="secondary">
                  Edit
                </LinkButton>{" "}
                <DeleteArticleButton id={a.id} title={a.title} />
              </Td>
            )}
          </tr>
        ))}
      </Table>
    </>
  );
}
