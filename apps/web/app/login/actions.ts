"use server";

import { redirect } from "next/navigation";
import { db, users, eq } from "@deskpilot/db";
import { endSession, startSession } from "@/lib/auth";
import { homeFor } from "@/lib/session-token";

export type LoginState = { error?: string };

// Mock login: no password in Milestone 1. Pick a seeded user or type their email.
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter an email." };

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) return { error: `No user with email ${email}. Try admin@acme.test.` };

  await startSession(user);
  redirect(homeFor(user.role));
}

export async function logout() {
  await endSession();
  redirect("/login");
}
