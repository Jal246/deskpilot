"use client";

import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-3">
      <Field label="Work email">
        <input name="email" type="email" required placeholder="you@acme.test" className={inputClass} />
      </Field>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

/** One-click sign in as a seeded demo user. */
export function QuickLogin({ email, label }: { email: string; label: string }) {
  const [, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full justify-between!">
        <span>{label}</span>
        <span className="text-xs text-zinc-500">{email}</span>
      </Button>
    </form>
  );
}
