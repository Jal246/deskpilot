import { notFound } from "next/navigation";
import { Badge, Card, formatDate, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getTicket, isUuid } from "@/lib/data";

export default async function TicketPage({ params }: PageProps<"/tickets/[id]">) {
  const user = await requireStaff();
  const { id } = await params;
  const ticket = isUuid(id) ? await getTicket(user.orgId, id) : undefined;
  if (!ticket) notFound();

  return (
    <>
      <PageHeader
        title={ticket.title}
        description={`Opened ${formatDate(ticket.createdAt)} via ${ticket.source}`}
        actions={
          <LinkButton href="/tickets" variant="secondary">
            ← All tickets
          </LinkButton>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <section className="space-y-3">
          {ticket.messages.length === 0 && <p className="text-sm text-zinc-500">No messages.</p>}
          {ticket.messages.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className="font-medium">{m.author?.name ?? "Deskpilot"}</span>
                {m.authorKind === "agent" && <Badge tone="blue">AI agent</Badge>}
                <span className="ml-auto text-xs text-zinc-500">{formatDate(m.createdAt)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{m.body}</p>
            </Card>
          ))}
        </section>
        <aside>
          <Card className="space-y-2 p-4 text-sm">
            <Row label="Status">
              <StatusBadge status={ticket.status} />
            </Row>
            <Row label="Requester">{ticket.requester?.name ?? "—"}</Row>
            <Row label="Assignee">{ticket.assignee?.name ?? "unassigned"}</Row>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span>{children}</span>
    </div>
  );
}
