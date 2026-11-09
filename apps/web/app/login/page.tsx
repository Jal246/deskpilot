import { Suspense } from "react";
import { connection } from "next/server";
import { db, users, asc } from "@deskpilot/db";
import { Card, Loading } from "@/components/ui";
import { LoginForm, QuickLogin } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Deskpilot</h1>
        <p className="mt-1 text-sm text-zinc-500">Demo login: no password needed in Milestone 1.</p>
      </div>
      <Card className="space-y-4 p-5">
        <Suspense fallback={<Loading label="Loading demo users…" />}>
          <DemoUsers />
        </Suspense>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          or
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <LoginForm />
      </Card>
    </main>
  );
}

async function DemoUsers() {
  await connection(); // always show the current users, not a build-time snapshot
  const demo = await db.query.users.findMany({ orderBy: asc(users.role), limit: 5 });
  if (demo.length === 0) {
    return <p className="text-sm text-zinc-500">No users yet. Run <code>pnpm db:seed</code>.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Sign in as</p>
      {demo.map((u) => (
        <QuickLogin key={u.id} email={u.email} label={`${u.name} (${u.role})`} />
      ))}
    </div>
  );
}
