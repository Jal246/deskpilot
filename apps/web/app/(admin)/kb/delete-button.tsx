"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui";
import { deleteArticle } from "./actions";

export function DeleteArticleButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
        startTransition(() => deleteArticle(id));
      }}
    >
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
