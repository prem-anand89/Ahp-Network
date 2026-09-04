// The public, SEO-facing directory home. Nothing in this route group's
// subtree may call cookies()/headers() — see (public)/layout.tsx — so this
// page stays statically prerenderable.

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">AHP Network</h1>
      <p className="max-w-md text-muted-foreground">
        The Verified Professional Network for Allied Health Professionals.
      </p>
      <Button asChild>
        <Link href="/directory">Find a verified therapist</Link>
      </Button>
    </main>
  );
}
