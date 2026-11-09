import Link from "next/link";
import { EmptyRow, formatDate, LinkButton, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { listWorkflows } from "@/lib/data";

export default async function WorkflowsPage() {
  const user = await requireStaff();
  const rows = await listWorkflows(user.orgId);

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Automations the help desk can run. Only published workflows are offered to employees."
        actions={user.role === "admin" && <LinkButton href="/workflows/new">New workflow</LinkButton>}
      />
      <Table head={["Name", "Status", "Live version", "Last run", "Updated"]}>
        {rows.length === 0 && <EmptyRow cols={5}>No workflows yet. Click “New workflow” to build one.</EmptyRow>}
        {rows.map((w) => (
          <tr key={w.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
            <Td>
              <Link href={`/workflows/${w.id}`} className="font-medium hover:underline">
                {w.name}
              </Link>
              <div className="text-xs text-zinc-500">{w.description}</div>
            </Td>
            <Td>
              <StatusBadge status={w.status} />
            </Td>
            <Td>{w.versionNumber ? `v${w.versionNumber}` : "—"}</Td>
            <Td>{w.lastRunAt ? formatDate(new Date(w.lastRunAt)) : "never"}</Td>
            <Td className="text-zinc-500">{formatDate(w.updatedAt)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
