// §1B footer legal links — CLAUDE.md's non-negotiable: reserve the space,
// never populate an href before the real page exists. All three links
// stay unstyled-as-links (no href, not clickable) until copy.ts's
// FOOTER_LEGAL_LINKS gets a real href from counsel (§15A).

import { FOOTER_LEGAL_LINKS } from "@/lib/copy";
import Link from "next/link";
import { GrievanceLink } from "./grievance-link";

export function Footer() {
  const links = Object.values(FOOTER_LEGAL_LINKS);

  return (
    <footer className="mt-auto border-t px-6 py-6 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
        {links.map((link) =>
          link.href ? (
            <a key={link.label} href={link.href} className="hover:underline">
              {link.label}
            </a>
          ) : (
            <span key={link.label} className="cursor-not-allowed opacity-50" title="Coming soon">
              {link.label}
            </span>
          ),
        )}
        <GrievanceLink />
        <Link href="/login" className="hover:underline">
          Sign in
        </Link>
      </div>
    </footer>
  );
}
