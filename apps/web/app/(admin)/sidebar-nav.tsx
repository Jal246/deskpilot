"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/workflows", label: "Workflows" },
  { href: "/runs", label: "Runs" },
  { href: "/tickets", label: "Tickets" },
  { href: "/kb", label: "Knowledge base" },
  { href: "/chat", label: "Help desk chat ↗" },
] as const;

/** Highlights the current section. Reads the URL, so render it inside <Suspense>. */
export function SidebarNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** Same links with nothing highlighted: the instant fallback while the URL streams in. */
export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex flex-wrap gap-1 md:flex-col">
      {LINKS.map(({ href, label }) => {
        const active = pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active
                ? "bg-zinc-200 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
