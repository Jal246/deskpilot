import { Suspense } from "react";
import { Card, Loading } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { logout } from "../login/actions";

// Employee help desk. The real chat arrives in step 7.
export default function ChatPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <Suspense fallback={<Loading />}>
        <ChatPlaceholder />
      </Suspense>
    </main>
  );
}

async function ChatPlaceholder() {
  const user = await requireUser();
  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">IT Help Desk</h1>
          <p className="text-sm text-zinc-500">Hi {user.name.split(" ")[0]}, what can we help with?</p>
        </div>
        <form action={logout}>
          <button className="text-sm text-zinc-500 hover:underline">Sign out</button>
        </form>
      </header>
      <Card className="p-6 text-sm text-zinc-500">
        The help desk chat arrives in step 7. You&apos;ll be able to say things like &quot;I&apos;m locked out&quot; or
        &quot;add me to the design group&quot;, and Deskpilot will run a published workflow or open a ticket.
      </Card>
    </>
  );
}
