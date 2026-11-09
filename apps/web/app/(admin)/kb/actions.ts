"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, db, eq, kbArticles } from "@deskpilot/db";
import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/data";

export type KbFormState = { error?: string };

/** Throw away cached copies of the KB pages (server and browser), then go back to the list.
 *  Without this the browser shows its old cached /kb list and the change looks lost. */
function done(id?: string): never {
  revalidatePath("/kb");
  if (id) revalidatePath(`/kb/${id}`);
  redirect("/kb");
}

function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title) return { error: "Title is required." } as const;
  if (title.length > 200) return { error: "Title must be 200 characters or fewer." } as const;
  if (!body) return { error: "Body is required." } as const;
  if (body.length > 20_000) return { error: "Body must be 20,000 characters or fewer." } as const;
  return { title, body } as const;
}

// Server actions can be called with a direct POST, so each one checks the user itself.
export async function createArticle(_prev: KbFormState, formData: FormData): Promise<KbFormState> {
  const user = await requireAdmin();
  const input = readForm(formData);
  if ("error" in input) return { error: input.error };

  await db.insert(kbArticles).values({ orgId: user.orgId, ...input });
  done();
}

export async function updateArticle(id: string, _prev: KbFormState, formData: FormData): Promise<KbFormState> {
  const user = await requireAdmin();
  if (!isUuid(id)) return { error: "Article not found." };
  const input = readForm(formData);
  if ("error" in input) return { error: input.error };

  const updated = await db
    .update(kbArticles)
    .set(input)
    .where(and(eq(kbArticles.id, id), eq(kbArticles.orgId, user.orgId)))
    .returning({ id: kbArticles.id });
  if (updated.length === 0) return { error: "Article not found." };
  done(id);
}

export async function deleteArticle(id: string) {
  const user = await requireAdmin();
  if (!isUuid(id)) return;
  await db.delete(kbArticles).where(and(eq(kbArticles.id, id), eq(kbArticles.orgId, user.orgId)));
  done(id);
}
