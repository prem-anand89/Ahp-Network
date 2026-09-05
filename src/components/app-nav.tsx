"use client";

// The /app/* persistent nav — a real gap until now: every therapist-facing
// page existed as an island reachable only by typing its URL, with no way
// back to any other screen and no sign-out anywhere in the app. §8G5's
// "/app/* vs /admin/*, never mixed in one navigation" is why this is its
// own component rather than reusing anything from the admin side.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/app/actions";

const NAV_LINKS = [
  { href: "/app/dashboard", label: "Home" },
  { href: "/app/referrals", label: "Referrals" },
  { href: "/app/community", label: "Community" },
  { href: "/app/verification", label: "Verification" },
  { href: "/app/feedback", label: "Feedback" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b bg-background">
      <nav className="mx-auto flex max-w-3xl items-center justify-between gap-4 overflow-x-auto px-4 py-3">
        <Link href="/app/dashboard" className="shrink-0 font-semibold tracking-tight">
          AHP Network
        </Link>
        <ul className="flex items-center gap-1 sm:gap-2">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={
                    "rounded-md px-2 py-1.5 text-sm whitespace-nowrap " +
                    (isActive ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent")
                  }
                  aria-current={isActive ? "page" : undefined}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <form action={signOutAction} className="shrink-0">
          <button type="submit" className="text-sm text-muted-foreground hover:underline">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
