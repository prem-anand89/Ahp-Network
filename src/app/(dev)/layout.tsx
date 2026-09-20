// The (dev) route group — internal design-review tooling, never shipped
// to real users. Gated below on NEXT_PUBLIC_DESIGN_ROUTE rather than
// NODE_ENV: staging *is* NODE_ENV=production, and the whole point of this
// route is that the founder can open it on their phone from the staging
// URL. Set NEXT_PUBLIC_DESIGN_ROUTE=1 in .dev.vars locally and on the
// staging Worker's environment only — never on the production Worker.
//
// Deliberately outside (public): scripts/check-public-routes-static.mjs
// polices that group's static/ISR output, and PublicHeader/Footer would
// wrap content that isn't a real product page.

import { notFound } from "next/navigation";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_DESIGN_ROUTE !== "1") {
    notFound();
  }
  return <div className="min-h-screen bg-background">{children}</div>;
}
