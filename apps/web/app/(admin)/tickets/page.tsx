import Link from "next/link";
import { EmptyRow, formatDate, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { listTickets } from "@/lib/data";

export default async function TicketsPage() {
  const user = await requireStaff();
  const rows = await listTickets(user.orgId);

  return (
    <>
      <PageHeader
        title="Tickets"
        description="Requests the help desk couldn't solve on its own, handed to IT."
      />
      <Table head={["Title", "Status", "Requester", "Assignee", "Source", "Opened"]}>
        {rows.length === 0 && <EmptyRow cols={6}>No tickets. Nice.</EmptyRow>}
        {rows.map((t) => (
          <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <Td>
              <Link href={`/tickets/${t.id}`} className="font-medium hover:underline">
                {t.title}
              </Link>
            </Td>
            <Td>
              <StatusBadge status={t.status} />
            </Td>
            <Td>{t.requester?.name ?? "—"}</Td>
            <Td className="text-zinc-500">{t.assignee?.name ?? "unassigned"}</Td>
            <Td>{t.source}</Td>
            <Td className="text-zinc-500">{formatDate(t.createdAt)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
