// The public, SEO-facing homepage. Nothing in this route group's subtree
// may call cookies()/headers() — see (public)/layout.tsx — so this page
// stays statically prerenderable. Six sections per Phase 1 step 11: hero
// (shows the real ProfileCard, doesn't describe it), trust strip, how
// verification works, what you won't find here, directory teaser, and the
// founding-cohort CTA. All copy lives in copy.ts, including the reworded
// no-comparative-language lines — see the note above HERO_COPY there for why.

import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileCard } from "@/components/cards/profile-card";
import { RegNumber } from "@/components/ui-ahp/reg-number";
import { Eyebrow } from "@/components/ui-ahp/eyebrow";
import { SITE_METADATA } from "@/lib/site-metadata";
import {
  HERO_COPY,
  TRUST_STRIP_COPY,
  HOW_VERIFICATION_WORKS_STEPS,
  WHAT_YOU_WONT_FIND_HERE,
  DIRECTORY_TEASER_COPY,
  FOUNDING_COHORT_CTA_COPY,
} from "@/lib/copy";

export const metadata: Metadata = {
  title: SITE_METADATA.title,
  description: SITE_METADATA.description,
  openGraph: {
    title: SITE_METADATA.title,
    description: SITE_METADATA.description,
    url: SITE_METADATA.url,
    siteName: SITE_METADATA.name,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_METADATA.title,
    description: SITE_METADATA.description,
  },
};

export default function Home() {
  return (
    <main id="main" className="flex flex-1 flex-col">
      {/* (a) Hero */}
      <section className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-8">
        <div className="flex flex-col gap-5">
          <Eyebrow>{HERO_COPY.eyebrow}</Eyebrow>
          <h1 className="font-display text-[32px] font-medium leading-[1.14] tracking-tight sm:text-[45px]">
            {HERO_COPY.headline}
          </h1>
          <p className="max-w-lg text-[15px] leading-[1.65] text-muted-foreground sm:text-base">
            {HERO_COPY.lede}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button asChild size="lg">
              <Link href="/directory">{HERO_COPY.primaryCta}</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="#founding-cohort">{HERO_COPY.secondaryCta}</Link>
            </Button>
          </div>
        </div>

        <div className="relative">
          {/* One continuous card: ProfileCard above, the verification
              record panel as its footer section (a divider, not a second
              stacked box) — a fixture preview of the real Public
              Verification Record (Phase 3), not a link to a page that
              doesn't exist yet. */}
          <div className="overflow-hidden rounded-card-lg border border-graphite bg-card shadow-sm">
            <ProfileCard
              slug="raghav-sharma"
              displayName="Raghav Sharma"
              photoUrl={null}
              role="physiotherapist"
              specializations={["musculoskeletal_orthopaedic", "neuro_rehab"]}
              verificationStage="credentials_verified"
              verifiedSinceLabel="12 Mar 2026"
              localityLabel="Kondapur"
              availableForNewPatients={true}
              availabilityUpdatedAt={new Date()}
              viewProfileHref="/directory"
              className="rounded-none border-none shadow-none"
            />
            <div className="border-t border-graphite px-5 pb-4 pt-3.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-verified-text">
                <ShieldCheck className="size-3.5" aria-hidden />
                Credentials Verified — 12 Mar 2026
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Reviewed by an AHP Network admin · Council registration · TGPMB
              </p>
              <p className="mt-1 text-xs">
                Reg. no. <RegNumber>APPT/2019/04412</RegNumber>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* (b) Trust strip */}
      <section className="border-y border-nav-border bg-nav-tint">
        <div className="mx-auto grid max-w-5xl gap-4 px-6 py-6 sm:grid-cols-3">
          {TRUST_STRIP_COPY.map((line) => (
            <p key={line} className="text-sm font-medium text-foreground">
              {line}
            </p>
          ))}
        </div>
      </section>

      {/* (c) How verification works */}
      <section id="how-verification-works" className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
        <h2 className="font-display text-2xl font-medium sm:text-[27px]">How verification works</h2>
        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {HOW_VERIFICATION_WORKS_STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-col gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-nav-tint text-sm font-semibold text-primary">
                {i + 1}
              </span>
              <p className="text-sm font-semibold">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* (d) What you won't find here */}
      <section className="bg-paper-dim">
        <div className="mx-auto max-w-5xl px-6 py-14 sm:py-20">
          <h2 className="font-display text-2xl font-medium sm:text-[27px]">What you won&apos;t find here</h2>
          <ul className="mt-6 flex flex-col gap-3">
            {WHAT_YOU_WONT_FIND_HERE.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-foreground">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brick" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* (e) Directory teaser */}
      <section className="mx-auto w-full max-w-5xl px-6 py-14 text-center sm:py-20">
        <Eyebrow>{DIRECTORY_TEASER_COPY.eyebrow}</Eyebrow>
        <h2 className="mt-2 font-display text-2xl font-medium sm:text-[27px]">
          {DIRECTORY_TEASER_COPY.headline}
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
          {DIRECTORY_TEASER_COPY.body}
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link href="/directory">{DIRECTORY_TEASER_COPY.cta}</Link>
        </Button>
      </section>

      {/* (f) Founding-cohort CTA */}
      <section id="founding-cohort" className="border-t bg-primary">
        <div className="mx-auto max-w-5xl px-6 py-14 text-center text-primary-foreground sm:py-20">
          <h2 className="font-display text-2xl font-medium sm:text-[27px]">
            {FOUNDING_COHORT_CTA_COPY.headline}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-primary-foreground/85">
            {FOUNDING_COHORT_CTA_COPY.body}
          </p>
          <Button asChild size="lg" variant="secondary" className="mt-6">
            <Link href="/login">{FOUNDING_COHORT_CTA_COPY.cta}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
