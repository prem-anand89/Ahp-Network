"use client";

// The /app/* bottom tab bar — primary nav under md, replacing AppNav's
// overflow-x-auto row of 6 links + wordmark + sign-out, which was
// unusable at 360px. Home / Referrals / Directory / Circles / More, per
// the mobile-first spec — Communities lives in the More sheet alongside
// the founding-cohort community, profile, verification, feedback, and
// sign out, since five primary tabs is already the ceiling for 44px
// touch targets on a 360px screen.
//
// iOS safe area: the container's padding-bottom stacks
// env(safe-area-inset-bottom) with its own base padding, and
// layout.tsx sets viewport-fit=cover so env() resolves to a real value
// instead of 0 — without both, the home-indicator swipe area overlaps
// this bar and the bottom row of targets stops registering taps.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ArrowLeftRight, Search, BookUser, Menu } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { signOutAction } from "@/app/app/actions";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const TAB_LINKS = [
  { href: "/app/dashboard", label: "Home", icon: Home },
  { href: "/app/referrals", label: "Referrals", icon: ArrowLeftRight },
  { href: "/app/directory", label: "Directory", icon: Search },
  { href: "/app/circles", label: "Circles", icon: BookUser },
] as const;

const MORE_LINKS = [
  { href: "/app/communities", label: "Communities" },
  { href: "/app/community", label: "Founding cohort community" },
  { href: "/app/profile", label: "Profile" },
  { href: "/app/verification", label: "Verification" },
  { href: "/app/practices", label: "Practices" },
  { href: "/app/feedback", label: "Feedback" },
  { href: "/app/settings/notifications", label: "Notifications" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-nav-border bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-1">
        {TAB_LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              prefetch={link.href.startsWith("/app") ? false : undefined}
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-5" aria-hidden />
              {link.label}
            </Link>
          );
        })}

        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[11px] font-medium",
                MORE_LINKS.some((l) => isActive(pathname, l.href)) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Menu className="size-5" aria-hidden />
              More
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-[calc(env(safe-area-inset-bottom)+2rem)]">
            <SheetTitle className="px-1 pb-2">
              <Logo variant="nunito" className="text-xl" />
            </SheetTitle>
            <div className="flex flex-col gap-1 px-1">
              {MORE_LINKS.map((link) => (
                <SheetClose key={link.href} asChild>
                  <Link
                    href={link.href}
                    prefetch={false}
                    className="flex h-12 items-center rounded-input px-3 text-base font-medium text-foreground hover:bg-accent"
                  >
                    {link.label}
                  </Link>
                </SheetClose>
              ))}
              <SheetClose asChild>
                <button
                  type="button"
                  onClick={() => void signOutAction()}
                  className="flex h-12 items-center rounded-input px-3 text-left text-base font-medium text-destructive hover:bg-accent"
                >
                  Sign out
                </button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
