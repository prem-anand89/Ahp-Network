#!/usr/bin/env node
/**
 * Configure Supabase Auth redirect URLs for the staging Worker origin.
 * Requires SUPABASE_ACCESS_TOKEN. Merges into existing uri_allow_list.
 */
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.STAGING_SUPABASE_PROJECT_REF ?? "gkgijnzqphppudpxcifg";
const siteUrl =
  process.env.STAGING_SITE_URL ?? "https://ahp-network-staging.theranetconnect.workers.dev";

if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN");
  process.exit(1);
}

const apiUrl = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const requiredRedirects = [
  `${siteUrl}`,
  `${siteUrl}/**`,
  `${siteUrl}/auth/callback`,
  "http://localhost:3000/**",
  "http://localhost:3000/auth/callback",
];

const getRes = await fetch(apiUrl, { headers });
if (!getRes.ok) {
  console.error("Failed to read auth config:", await getRes.text());
  process.exit(1);
}
const current = await getRes.json();
const existing = (current.uri_allow_list ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const merged = [...new Set([...existing, ...requiredRedirects])];

const patchRes = await fetch(apiUrl, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    site_url: siteUrl,
    uri_allow_list: merged.join(","),
  }),
});
if (!patchRes.ok) {
  console.error("Failed to update auth config:", await patchRes.text());
  process.exit(1);
}
const updated = await patchRes.json();
console.log("site_url:", updated.site_url);
console.log("uri_allow_list:", updated.uri_allow_list);
