// Shared helpers for the schema.org JSON-LD blocks embedded via
// `<script type="application/ld+json" dangerouslySetInnerHTML>` across
// the public pages (pt/[slug], clinic/[slug], the locality pages).
//
// jsonLdScript() exists because `JSON.stringify` does NOT escape
// `</script>`, and several of these objects embed free text a user
// controls (displayName, bio, practice name/description) with no
// character sanitization applied anywhere upstream. Without this, a
// display name containing the literal substring `</script><script>...`
// closes the JSON-LD tag early and injects an attacker-controlled
// `<script>` for every visitor and crawler. `<` is valid inside a
// JSON string and inert inside HTML, so this is a pure serialization
// fix — it doesn't touch what's stored or displayed anywhere else.
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

interface ItemListProfile {
  slug: string | null;
  displayName: string | null;
}

// Shared by the two locality pages (plain and role-scoped) — both list
// searchDirectory() results, and `users.slug`/`users.display_name` are
// nullable columns with no downstream guarantee they're set (the same
// reason ProfileCard defends against both). A profile missing either is
// silently dropped from the ItemList rather than emitting an invalid
// `/pt/null` URL or a `Person` with `name: null`.
export function buildItemListSchema(profiles: ItemListProfile[], siteUrl: string) {
  const items = profiles.filter(
    (p): p is { slug: string; displayName: string } => Boolean(p.slug) && Boolean(p.displayName),
  );
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((profile) => ({
      "@type": "ListItem",
      item: {
        "@type": "Person",
        name: profile.displayName,
        url: `${siteUrl}/pt/${profile.slug}`,
      },
    })),
  };
}
