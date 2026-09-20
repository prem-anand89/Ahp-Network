// The design-system kitchen sink — internal review tooling only, gated by
// (dev)/layout.tsx on NEXT_PUBLIC_DESIGN_ROUTE. Every component below is
// imported from its real @/components/* module — never a hand-written
// approximation. If this page ever contains one, it's a lie and worse
// than not having the page. Fixtures only, never getDb(): zero PII, zero
// DB load, no dynamic-rendering leak into a route group that would
// otherwise need to stay static.
//
// This is the acceptance surface for Phase 1: every component here should
// render correctly at 360px and at 1280px+. Add to this page as each new
// primitive/bespoke component lands — it's a living document, not a
// one-time snapshot.

"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  CredentialsVerifiedBadge,
  QualificationConfirmedBadge,
  OwnershipVerifiedBadge,
} from "@/components/badges/verification-badge";
import { ProfileCard } from "@/components/cards/profile-card";
import { AhpMark } from "@/components/brand/ahp-mark";
import { Eyebrow } from "@/components/ui-ahp/eyebrow";
import { RegNumber } from "@/components/ui-ahp/reg-number";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { TagPill } from "@/components/ui-ahp/tag-pill";
import { AvatarInitials } from "@/components/ui-ahp/avatar-initials";
import { ReferralCard } from "@/components/cards/referral-card";

// ---- WCAG contrast ratio, computed live so this page stays true if a
// hex value in globals.css changes rather than drifting from a hardcoded
// comment. ----
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const r = parseInt(n.substring(0, 2), 16);
  const g = parseInt(n.substring(2, 4), 16);
  const b = parseInt(n.substring(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

interface Swatch {
  name: string;
  hex: string;
  cssVar: string;
  utilityClass?: string;
  note?: string;
}

const PAPER = "#F8F9FA";
const WHITE = "#FFFFFF";

const SWATCHES: Swatch[] = [
  { name: "Ink", hex: "#16211D", cssVar: "--ahp-ink", utilityClass: "text-foreground" },
  { name: "Primary", hex: "#00508C", cssVar: "--ahp-primary", utilityClass: "bg-primary" },
  { name: "Verified (fills/icons)", hex: "#2F9E6E", cssVar: "--verified", utilityClass: "bg-verified", note: "fills, dots, icons, ≥18px text only" },
  { name: "Verified Text (AA-safe)", hex: "#1F7A54", cssVar: "--verified-text", utilityClass: "text-verified-text", note: "small text — the source proposal's single jade fails AA here" },
  { name: "Seal Brick", hex: "#B5462F", cssVar: "--ahp-brick / --destructive", utilityClass: "bg-destructive" },
  { name: "Paper (page bg)", hex: PAPER, cssVar: "--ahp-paper", utilityClass: "bg-background" },
  { name: "Paper Dim (dividers)", hex: "#ECEEE6", cssVar: "--ahp-paper-dim", utilityClass: "bg-muted" },
  { name: "Muted (secondary text)", hex: "#5B655E", cssVar: "--ahp-muted", utilityClass: "text-muted-foreground" },
  { name: "Tag Plum", hex: "#6B3F66", cssVar: "--ahp-tag-plum-text", note: "on #E9DCE8 bg — specialty tags" },
  { name: "Tag Clay", hex: "#7A4B28", cssVar: "--ahp-tag-clay-text", note: "on #F0DACB bg — visit-type tags; darkened from the source proposal's #8A5A34 for AA" },
];

function SwatchCard({ s }: { s: Swatch }) {
  const onPaper = contrastRatio(s.hex, PAPER);
  const onWhite = contrastRatio(s.hex, WHITE);
  const pass = (r: number) => (r >= 4.5 ? "text-verified-text" : r >= 3 ? "text-confirmed" : "text-destructive");
  return (
    <div className="overflow-hidden rounded-card border bg-card">
      <div className="h-16" style={{ background: s.hex }} />
      <div className="p-3">
        <div className="text-xs font-semibold">{s.name}</div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.hex}</div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.cssVar}</div>
        {s.utilityClass && (
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.utilityClass}</div>
        )}
        <div className="mt-1.5 flex gap-2 text-[10px]">
          <span className={pass(onPaper)}>{onPaper.toFixed(1)}:1 on paper</span>
          <span className={pass(onWhite)}>{onWhite.toFixed(1)}:1 on white</span>
        </div>
        {s.note && <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{s.note}</div>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-14 px-6 py-10">
      <header className="flex flex-col gap-1 border-b pb-6">
        <h1 className="font-display text-3xl font-medium tracking-tight">AHP Network — design system</h1>
        <p className="text-sm text-muted-foreground">
          Internal review only. Every component below is the real one — nothing here is a hand-drawn approximation.
        </p>
      </header>

      <Section title="Colour — with computed contrast, not eyeballed">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {SWATCHES.map((s) => (
            <SwatchCard key={s.name} s={s} />
          ))}
        </div>
      </Section>

      <Section title="Type — mobile (390px) vs. desktop (1024px+)">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border bg-card p-6">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-destructive">Mobile default</div>
            <div className="font-display text-[32px] font-medium leading-[1.14] tracking-tight">
              A referral network built on who&apos;s checked.
            </div>
            <p className="mt-2.5 text-[15px] leading-[1.6] text-muted-foreground">
              Body copy at 15px/1.6 — Inter, the interface face for ~90% of all text.
            </p>
            <div className="mt-3 flex items-baseline gap-2 border-t pt-3 text-xs">
              <span className="text-muted-foreground">State council reg.</span>
              <span className="font-mono font-semibold">TGPMB-04471</span>
            </div>
          </div>
          <div className="rounded-card border bg-card p-6">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Desktop, 1024px+</div>
            <div className="font-display text-[45px] font-medium leading-[1.12] tracking-tight">
              A referral network built on who&apos;s checked.
            </div>
            <p className="mt-2.5 text-[16.5px] leading-[1.65] text-muted-foreground">
              Newsreader for headlines and names, Inter for interface, IBM Plex Mono for record data only.
            </p>
          </div>
        </div>
      </Section>

      <Section title="The three verification badges — locked module, never re-implemented per surface">
        <div className="flex flex-wrap items-center gap-4 rounded-card border bg-card p-6">
          <CredentialsVerifiedBadge dateLabel="Mar 2026" />
          <QualificationConfirmedBadge dateLabel="Mar 2026" />
          <OwnershipVerifiedBadge dateLabel="Mar 2026" />
        </div>
        <p className="text-xs text-muted-foreground">
          Tap each badge — the tooltip is tap-triggered (Radix Popover), never hover-only.
        </p>
      </Section>

      <Section title="Buttons — variant × size × state, all pills now">
        <div className="flex flex-col gap-3 rounded-card border bg-card p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small · 40px</Button>
            <Button size="default">Default · 44px</Button>
            <Button size="lg">Large · 48px</Button>
            <Button size="icon" aria-label="Icon button">→</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
          </div>
        </div>
      </Section>

      <Section title="Form fields">
        <div className="flex flex-col gap-4 rounded-card border bg-card p-6 sm:max-w-md">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="design-input">Locality</Label>
            <Input id="design-input" placeholder="e.g. Kondapur" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="design-select">Role needed</Label>
            <Select>
              <SelectTrigger id="design-select">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="physiotherapist">Physiotherapist</SelectItem>
                <SelectItem value="occupational_therapist">Occupational Therapist</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="design-textarea">Patient summary</Label>
            <Textarea id="design-textarea" rows={3} placeholder="Never include name, phone, or address." />
          </div>
        </div>
      </Section>

      <Section title="Card primitive (ui/card.tsx) — stock shadcn, not yet swept into use">
        <Card className="sm:max-w-sm">
          <CardHeader>
            <CardTitle>Example card</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The generic shadcn Card primitive, shown here so its look is reviewable — it is imported by zero
            `/app/*` or `/admin/*` pages today; the sweep to replace hand-written `rounded-2xl border bg-card p-5
            shadow-sm` divs with this is a later Phase 1 step.
          </CardContent>
        </Card>
      </Section>

      <Section title="New bespoke primitives (Phase 1 step 7)">
        <div className="flex flex-col gap-6 rounded-card border bg-card p-6">
          <div>
            <Eyebrow className="mb-2">Logo mark</Eyebrow>
            <div className="flex items-center gap-6 rounded-input border border-graphite bg-nav-tint px-4 py-3">
              <AhpMark />
              <AhpMark glyphOnly />
            </div>
          </div>

          <div>
            <Eyebrow className="mb-2">Registration number — the one place mono appears</Eyebrow>
            <p className="text-sm">
              State council reg. <RegNumber>TGPMB-04471</RegNumber>
            </p>
          </div>

          <div>
            <Eyebrow className="mb-2">Tag pills — coloured by category, not DOM position</Eyebrow>
            <div className="flex flex-wrap gap-2">
              <TagPill category="specialty">Neuro Rehab</TagPill>
              <TagPill category="specialty">Musculoskeletal</TagPill>
              <TagPill category="visitType">Home Visits</TagPill>
              <TagPill category="ageGroup">Adult</TagPill>
              <TagPill category="language">Telugu</TagPill>
            </div>
          </div>

          <div>
            <Eyebrow className="mb-2">Deterministic-hue avatar initials (communities, institutions)</Eyebrow>
            <div className="flex items-center gap-3">
              <AvatarInitials name="Manipal College of Allied Health" />
              <AvatarInitials name="Founding Cohort" />
              <AvatarInitials name="TGPMB Registrants" size="lg" />
            </div>
          </div>

          <div>
            <Eyebrow className="mb-2">Empty state — replaces every bare muted sentence</Eyebrow>
            <EmptyState
              title="Nothing posted yet"
              body="Referrals you post will appear here."
              action={<Button size="sm">Post a referral</Button>}
            />
          </div>
        </div>
      </Section>

      <Section title="ProfileCard — full / minimal / no-photo">
        <div className="grid gap-4 sm:grid-cols-3">
          <ProfileCard
            slug="raghav-sharma"
            displayName="Raghav Sharma"
            photoUrl={null}
            role="physiotherapist"
            specializations={["musculoskeletal_orthopaedic", "neuro_rehab"]}
            verificationStage="credentials_verified"
            verifiedSinceLabel="Mar 2026"
            localityLabel="Kondapur"
            availableForNewPatients={true}
          />
          <ProfileCard
            slug="anita-kumar"
            displayName="Anita Kumar"
            photoUrl={null}
            role="physiotherapist"
            specializations={["neuro_rehab"]}
            verificationStage="qualification_confirmed"
            verifiedSinceLabel="Feb 2026"
            localityLabel="Madhapur"
            availableForNewPatients={false}
          />
          <ProfileCard
            slug={null}
            displayName={null}
            photoUrl={null}
            role={null}
            specializations={[]}
            verificationStage="unverified"
            localityLabel={undefined}
            availableForNewPatients={false}
          />
        </div>
      </Section>

      <Section title="ReferralCard — urgent vs. routine, matched vs. non-matching">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReferralCard
            specialtyLabel="Neuro Rehab"
            urgency="urgent"
            localityLabel="Gachibowli"
            visitType="home"
            postedLabel="2 hrs ago"
            stateLabel="4 interested"
            stateDetail="Tap to choose"
            onExpressInterest={() => {}}
          />
          <ReferralCard
            specialtyLabel="Musculoskeletal / Ortho"
            urgency="routine"
            localityLabel="Kondapur"
            visitType="clinic"
            postedLabel="Yesterday"
            nonMatchLabel="Not in your area/specialty"
          />
        </div>
      </Section>

      <Section title="Newly added primitives (Phase 1 step 6)">
        <div className="flex flex-col gap-6 rounded-card border bg-card p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Urgent</Badge>
          </div>

          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback className="font-display text-[15px] text-primary">RS</AvatarFallback>
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback className="font-display text-primary">AK</AvatarFallback>
            </Avatar>
          </div>

          <Tabs defaultValue="matched" className="w-full max-w-sm">
            <TabsList>
              <TabsTrigger value="matched">Matched to you</TabsTrigger>
              <TabsTrigger value="posted">Posted by you</TabsTrigger>
            </TabsList>
            <TabsContent value="matched" className="text-sm text-muted-foreground">
              2 open referrals match your specialty and locality.
            </TabsContent>
            <TabsContent value="posted" className="text-sm text-muted-foreground">
              Nothing posted yet.
            </TabsContent>
          </Tabs>

          <div className="flex flex-col gap-2 sm:max-w-sm">
            <Skeleton className="h-24 rounded-card" />
            <Skeleton className="h-4 w-2/3 rounded-input" />
            <Skeleton className="h-4 w-1/2 rounded-input" />
          </div>

          <div className="flex flex-col gap-3 sm:max-w-sm">
            <Alert>
              <AlertTitle>Under review</AlertTitle>
              <AlertDescription>1 document awaiting review. Expect a decision within roughly 2 hours.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>Never include a name, phone number, or address.</AlertTitle>
            </Alert>
          </div>

          <Accordion type="single" collapsible className="sm:max-w-sm">
            <AccordionItem value="more-filters">
              <AccordionTrigger>More filters</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                Language, institution, certification, gender, age groups, experience, tele-rehab.
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex items-center gap-2">
            <Checkbox id="design-consent" />
            <Label htmlFor="design-consent" className="font-normal text-sm">
              I confirm the patient has consented to this referral.
            </Label>
          </div>

          <RadioGroup defaultValue="home" className="flex gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="home" id="design-visit-home" />
              <Label htmlFor="design-visit-home" className="font-normal text-sm">Home visit</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="clinic" id="design-visit-clinic" />
              <Label htmlFor="design-visit-clinic" className="font-normal text-sm">Clinic visit</Label>
            </div>
          </RadioGroup>

          <div className="flex flex-wrap items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open filter sheet</Button>
              </SheetTrigger>
              <SheetContent side="bottom">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                </SheetHeader>
              </SheetContent>
            </Sheet>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Account menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Section>

      <Section title="Radii">
        <div className="flex flex-wrap gap-4 rounded-card border bg-card p-6">
          <div className="flex flex-col items-center gap-1.5">
            <div className="h-10 w-16 rounded-pill bg-muted" />
            <span className="text-[10px] text-muted-foreground">pill · 999px</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <div className="h-10 w-16 rounded-card bg-muted" />
            <span className="text-[10px] text-muted-foreground">card · 18px</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <div className="h-10 w-16 rounded-card-lg bg-muted" />
            <span className="text-[10px] text-muted-foreground">card-lg · 22px</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <div className="h-10 w-16 rounded-input bg-muted" />
            <span className="text-[10px] text-muted-foreground">input · 12px</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <div className="h-10 w-16 rounded-seal bg-destructive/10" />
            <span className="text-[10px] text-muted-foreground">seal · 8px (Ownership badge only)</span>
          </div>
        </div>
      </Section>
    </main>
  );
}
