// The public, SEO-facing directory home. Nothing in this route group's
// subtree may call cookies()/headers() — see (public)/layout.tsx — so this
// page stays statically prerenderable.

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SITE_METADATA } from "@/lib/site-metadata";

export const metadata: Metadata = {
  title: SITE_METADATA.title,
  description: SITE_METADATA.description,
};

export default function Home() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">AHP Network</h1>
      <p className="max-w-md text-muted-foreground">
        The Verified Professional Network for Allied Health Professionals.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/directory">Find a verified therapist</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
