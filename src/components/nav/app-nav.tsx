"use client";

// The /app/* persistent nav — desktop floating island (rewrite of the old
// flush src/components/app-nav.tsx). §8G5's "/app/* vs /admin/*, never
// mixed in one navigation" is why this stays its own component rather
// than reusing anything from the admin side.
//
// Communities and Practices are the primary links; Circles moved into the
// account menu (Step 7A) once it had its own dedicated management screen
// (/app/circles) reachable from there — a circle is something you manage
// occasionally, not a daily destination the way the other four are. Under
// md, AppTabBar takes over as the primary nav (this component hides
// itself there — see the md:flex below).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ArrowLeftRight, Search, Users2, Building2, UserCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { signOutAction } from "@/app/app/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PRIMARY_LINKS = [
  { href: "/app/dashboard", label: "Home", icon: Home },
  { href: "/app/referrals", label: "Referrals", icon: ArrowLeftRight },
  { href: "/app/directory", label: "Directory", icon: Search },
  { href: "/app/communities", label: "Communities", icon: Users2 },
  { href: "/app/practices", label: "Practices", icon: Building2 },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-4 z-40 mx-auto hidden w-[calc(100%-2rem)] max-w-4xl items-center justify-between gap-4 rounded-[20px] border border-nav-border bg-nav-tint px-4 py-2.5 shadow-sm md:flex">
      <Link href="/app/dashboard" prefetch={false} className="shrink-0">
        <Logo variant="nunito" className="text-xl" />
      </Link>

      <nav className="flex items-center gap-1">
        {PRIMARY_LINKS.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              // See the historical note this replaced: prefetch off for
              // every /app/* destination, since each triggers its own
              // Hyperdrive query that a hovered-not-clicked link never
              // needed. Directory moved from the public, cacheable
              // /directory to /app/directory (2026-09-21, see that
              // route's own comment) specifically so it's no longer the
              // exception here.
              prefetch={link.href.startsWith("/app") ? false : undefined}
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-pill px-3.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="size-4" aria-hidden />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex size-10 items-center justify-center rounded-full text-foreground hover:bg-white"
          >
            <UserCircle className="size-6" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href="/app/profile" prefetch={false}>Profile</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/verification" prefetch={false}>Verification</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/circles" prefetch={false}>Circles</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/community" prefetch={false}>Founding cohort community</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/feedback" prefetch={false}>Feedback</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/settings/notifications" prefetch={false}>Notifications</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* onSelect, not a nested <form>: Radix's DropdownMenuItem
              already renders as a single interactive element and closes
              the menu on select, which races a real submit-button click
              inside it. signOutAction has no arguments and only redirects,
              so calling it directly is equivalent to the native-form
              pattern used elsewhere without that structural conflict. */}
          <DropdownMenuItem onSelect={() => void signOutAction()}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
