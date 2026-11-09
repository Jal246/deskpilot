"use client";

import { useActionState } from "react";
import { Button, Field, inputClass, LinkButton } from "@/components/ui";
import type { KbFormState } from "./actions";

type Props = {
  action: (prev: KbFormState, formData: FormData) => Promise<KbFormState>;
  initial?: { title: string; body: string };
  submitLabel: string;
};

export function KbForm({ action, initial, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <Field label="Title">
        <input name="title" required maxLength={200} defaultValue={initial?.title} className={inputClass} />
      </Field>
      <Field label="Body" hint="Plain text. The help desk agent quotes this when answering questions.">
        <textarea name="body" required rows={12} defaultValue={initial?.body} className={`${inputClass} font-mono`} />
      </Field>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <LinkButton href="/kb" variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
