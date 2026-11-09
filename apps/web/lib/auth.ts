// Data Access Layer for "who is logged in". Every page and server action calls
// one of these. Proxy redirects are only a fast first check; this is the real one.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, users, eq } from "@deskpilot/db";
import { decodeSession, encodeSession, homeFor, SESSION_COOKIE } from "./session-token";

export type CurrentUser = {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: "admin" | "agent" | "employee";
};

/** The logged-in user, or null. Always re-reads the user from the database. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, token.userId) });
  if (!user) return null;
  return { id: user.id, orgId: user.orgId, name: user.name, email: user.email, role: user.role };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Dashboard pages: admins and agents only. Employees are sent to the chat. */
export async function requireStaff(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role === "employee") redirect(homeFor(user.role));
  return user;
}

/** Changing settings (KB, workflows): admins only. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect(homeFor(user.role));
  return user;
}

export async function startSession(user: { id: string; role: CurrentUser["role"] }) {
  (await cookies()).set(SESSION_COOKIE, encodeSession({ userId: user.id, role: user.role }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
