import { Suspense } from "react";
import Link from "next/link";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { logout } from "../login/actions";
import { Chat } from "./chat";

// Employee help desk chat. Admins can use it too, to try the agent.
export default function ChatPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-10">
      <Suspense fallback={<Loading />}>
        <ChatShell />
      </Suspense>
    </main>
  );
}

async function ChatShell() {
  const user = await requireUser();
  const isStaff = user.role !== "employee";
  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">IT Help Desk</h1>
          <p className="text-sm text-zinc-500">
            Signed in as {user.name} ({user.email})
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-500">
          {isStaff && (
            <Link href="/workflows" className="hover:underline">
              Dashboard
            </Link>
          )}
          <form action={logout}>
            <button className="hover:underline">Sign out</button>
          </form>
        </div>
      </header>
      <Chat firstName={user.name.split(" ")[0] || user.name} isStaff={isStaff} />
    </>
  );
}
