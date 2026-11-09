// Fast, optimistic redirects before a page renders. Pages still check the
// session against the database themselves (lib/auth.ts).
import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, homeFor, SESSION_COOKIE } from "./lib/session-token";

export function proxy(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;

  // Never redirect away from /login: after `pnpm db:seed` an old cookie can point
  // at a user that no longer exists, and that would loop /login <-> /workflows.
  if (pathname === "/login") return NextResponse.next();

  if (pathname === "/") {
    return NextResponse.redirect(new URL(session ? homeFor(session.role) : "/login", request.url));
  }

  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, API routes and files like favicon.ico.
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
