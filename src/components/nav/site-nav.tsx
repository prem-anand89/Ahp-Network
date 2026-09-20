// Public-site nav — floating tinted island, replacing the old flush
// `PublicHeader`. Client component (needs usePathname for the active-link
// state and Sheet for the mobile menu), but calls no dynamic *server* API,
// so the (public) route group's layout stays static/ISR — see the header
// comment on src/app/(public)/layout.tsx.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { AhpMark } from "@/components/brand/ahp-mark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/directory", label: "Directory" },
  { href: "/#how-verification-works", label: "How verification works" },
  { href: "/#founding-cohort", label: "For therapists" },
] as const;

function isActive(pathname: string, href: string) {
  if (href.startsWith("/#")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-4 z-40 mx-auto w-[calc(100%-2rem)] max-w-5xl rounded-[20px] border border-nav-border bg-nav-tint px-4 py-2.5 shadow-sm sm:w-auto">
      <div className="flex items-center justify-between gap-6">
        <Link href="/" className="shrink-0">
          <AhpMark />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex h-11 items-center rounded-pill px-4 text-sm font-medium transition-colors",
                isActive(pathname, link.href)
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:block">
          <Button asChild size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="flex size-11 items-center justify-center rounded-pill text-foreground md:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-8">
            <SheetTitle className="px-1 pb-2">
              <AhpMark />
            </SheetTitle>
            <nav className="flex flex-col gap-1 px-1">
              {NAV_LINKS.map((link) => (
                <SheetClose key={link.href} asChild>
                  <Link
                    href={link.href}
                    className="flex h-12 items-center rounded-input px-3 text-base font-medium text-foreground hover:bg-accent"
                  >
                    {link.label}
                  </Link>
                </SheetClose>
              ))}
              <SheetClose asChild>
                <Button asChild size="lg" className="mt-3">
                  <Link href="/login">Sign in</Link>
                </Button>
              </SheetClose>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
