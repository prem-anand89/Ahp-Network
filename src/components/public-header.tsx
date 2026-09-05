// Static public-site header — no cookies()/headers()/getDb(), so this stays
// inside the (public) route group's static/ISR subtree.

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function PublicHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          AHP Network
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </header>
  );
}
