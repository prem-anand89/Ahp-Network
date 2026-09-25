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
import { Logo } from "@/components/ui/logo";
import { FOOTER_LEGAL_LINKS, INDIA_POST_DATA_ATTRIBUTION } from "@/lib/copy";
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
          <Logo variant="nunito" className="text-2xl" />
          <p className="max-w-xs text-muted-foreground">
            A verified professional referral network for physiotherapists,
            occupational therapists, and speech-language pathologists in
            India. Operated by TheraNet Technologies.
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
          {/* Interim bridge docs, distinct from the gated Privacy Policy/ToS
              above — these already exist and are real, just not
              counsel-reviewed (see their own page headers). */}
          <Link href="/legal/founding-declaration" className="text-muted-foreground hover:text-foreground hover:underline">
            Founding Member Declaration
          </Link>
          <Link href="/legal/privacy-notice" className="text-muted-foreground hover:text-foreground hover:underline">
            Interim Privacy Notice
          </Link>
          <GrievanceLink />
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-5xl text-xs text-muted-foreground">{INDIA_POST_DATA_ATTRIBUTION}</p>
    </footer>
  );
}
