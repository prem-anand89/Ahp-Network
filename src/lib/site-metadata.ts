import type { Metadata } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ahp-network.theranetconnect.workers.dev";

export const SITE_METADATA = {
  name: "AHP Network",
  title: "AHP Network",
  description:
    "The verified professional network for physiotherapists, occupational therapists, and speech-language pathologists in India.",
  url: siteUrl,
} satisfies Pick<Metadata, "title" | "description"> & { name: string; url: string };

export const ROOT_METADATA: Metadata = {
  title: {
    default: SITE_METADATA.title,
    template: `%s | ${SITE_METADATA.name}`,
  },
  description: SITE_METADATA.description,
  metadataBase: new URL(SITE_METADATA.url),
};
