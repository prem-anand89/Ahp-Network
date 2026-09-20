// §1B footer legal links — CLAUDE.md's non-negotiable: reserve the space,
// never populate an href before the real page exists. All three links
// stay unstyled-as-links (no href, not clickable) until copy.ts's
// FOOTER_LEGAL_LINKS gets a real href from counsel (§15A). This rendering
// rule — href present -> <a>, href null -> non-interactive <span> with
// opacity-50 and a "Coming soon" title — is unchanged from the previous
// single-row footer; only the surrounding layout changed, so
// copy.footer-legal.test.ts (which asserts against copy.ts, not this
// component's markup) stays green untouched.

import Link from "next/link";
import { AhpMark } from "@/components/brand/ahp-mark";
import { FOOTER_LEGAL_LINKS } from "@/lib/copy";
import { GrievanceLink } from "./grievance-link";

const NETWORK_LINKS = [
  { href: "/directory", label: "Directory" },
  { href: "/#how-verification-works", label: "How verification works" },
  { href: "/#founding-cohort", label: "For therapists" },
  { href: "/login", label: "Sign in" },
] as const;

export function Footer() {
  const legalLinks = Object.values(FOOTER_LEGAL_LINKS);

  return (
    <footer className="mt-auto border-t px-6 py-10 text-sm">
      <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <AhpMark />
          <p className="max-w-xs text-muted-foreground">
            A verified professional referral network for physiotherapists,
            occupational therapists, and speech-language pathologists in
            Hyderabad. Operated by TheraNet Technologies.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Network
          </p>
          {NETWORK_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground hover:underline">
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Legal
          </p>
          {legalLinks.map((link) =>
            link.href ? (
              <a key={link.label} href={link.href} className="text-muted-foreground hover:text-foreground hover:underline">
                {link.label}
              </a>
            ) : (
              <span
                key={link.label}
                className="cursor-not-allowed text-muted-foreground opacity-50"
                title="Coming soon"
              >
                {link.label}
              </span>
            ),
          )}
          <GrievanceLink />
        </div>
      </div>
    </footer>
  );
}
