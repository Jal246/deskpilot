// Mock login (Milestone 1, dev only): the cookie holds "userId.role.signature".
// The HMAC signature stops anyone from editing the cookie to become someone else.
// Pure Node crypto, so both proxy.ts and server code can use it.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dp_session";
export type Role = "admin" | "agent" | "employee";
export type SessionToken = { userId: string; role: Role };

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set (see .env.example)");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession({ userId, role }: SessionToken): string {
  const payload = `${userId}.${role}`;
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined): SessionToken | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, role, sig] = parts;
  const expected = Buffer.from(sign(`${userId}.${role}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (role !== "admin" && role !== "agent" && role !== "employee") return null;
  return { userId, role };
}

/** Admins and agents use the dashboard; employees use the chat. */
export function homeFor(role: Role): string {
  return role === "employee" ? "/chat" : "/workflows";
}
