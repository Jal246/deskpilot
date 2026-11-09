import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "../login/actions";
import { NavLinks, SidebarNav } from "./sidebar-nav";

// Dashboard shell. The sidebar is static, so it shows instantly; anything that reads
// the login cookie or the database streams in behind a <Suspense> boundary.
export default function AdminLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 border-b border-zinc-200 bg-zinc-50 p-4 md:w-56 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-lg font-semibold tracking-tight">Deskpilot</div>
        <Suspense fallback={<NavLinks pathname={null} />}>
          <SidebarNav />
        </Suspense>
        <div className="md:mt-auto">
          <Suspense fallback={null}>
            <UserBox />
          </Suspense>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </main>
    </div>
  );
}

async function UserBox() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="space-y-2 text-sm">
      <div>
        <div className="font-medium">{user.name}</div>
        <div className="text-xs text-zinc-500">
          {user.email} · {user.role}
        </div>
      </div>
      <form action={logout}>
        <button className="text-xs text-zinc-500 underline-offset-2 hover:underline">Sign out</button>
      </form>
    </div>
  );
}
