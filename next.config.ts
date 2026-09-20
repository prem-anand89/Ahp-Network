import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    // users.photoUrl (Phase 2) resolves to R2's public subdomain — see
    // r2.ts's publicPhotoUrl comment. If NEXT_PUBLIC_PHOTOS_BASE_URL ever
    // points at a real custom domain instead of the free r2.dev one, add
    // that hostname here too.
    remotePatterns: [{ protocol: "https", hostname: "*.r2.dev" }],
  },
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
