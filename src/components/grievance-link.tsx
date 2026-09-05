"use client";

// Client-side only, deliberately: fetching here (rather than in the
// server-rendered (public) layout) keeps that layout's static/ISR
// rendering intact — see src/app/api/app-settings/grievance-channel and
// scripts/check-public-routes-static.mjs.

import { useEffect, useState } from "react";
import { GRIEVANCE_OFFICER_EMAIL } from "@/lib/copy";

export function GrievanceLink() {
  const [published, setPublished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app-settings/grievance-channel")
      .then((res) => res.json() as Promise<{ published?: boolean }>)
      .then((data) => {
        if (!cancelled) setPublished(Boolean(data.published));
      })
      .catch(() => {
        // Fails closed — an unpublished channel is the safe default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!published) return null;

  return (
    <a href={`mailto:${GRIEVANCE_OFFICER_EMAIL}`} className="hover:underline">
      Grievance Officer
    </a>
  );
}
