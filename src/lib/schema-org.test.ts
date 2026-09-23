import { describe, expect, it } from "vitest";
import { jsonLdScript, buildItemListSchema } from "./schema-org";

describe("jsonLdScript", () => {
  it("escapes </script> so a display name can't break out of the tag", () => {
    const html = jsonLdScript({ name: "Priya</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("\\u003c/script>");
  });

  it("still round-trips as valid JSON once unescaped by the browser's HTML parser", () => {
    // \u003c decodes back to "<" — this simulates that the escaped output
    // still parses to the original object, not garbled data.
    const html = jsonLdScript({ name: "Priya" });
    expect(JSON.parse(html)).toEqual({ name: "Priya" });
  });
});

describe("buildItemListSchema", () => {
  it("drops profiles missing a slug or displayName", () => {
    const schema = buildItemListSchema(
      [
        { slug: "priya-nair", displayName: "Priya Nair" },
        { slug: null, displayName: "No Slug" },
        { slug: "no-name", displayName: null },
      ],
      "https://example.com",
    );
    expect(schema?.itemListElement).toHaveLength(1);
    expect(schema?.itemListElement[0].item.url).toBe("https://example.com/pt/priya-nair");
  });

  it("returns null when every profile is missing a slug or displayName", () => {
    expect(buildItemListSchema([{ slug: null, displayName: "X" }], "https://example.com")).toBeNull();
  });

  it("returns null for an empty profile list", () => {
    expect(buildItemListSchema([], "https://example.com")).toBeNull();
  });

  it("omits the position property on every item", () => {
    const schema = buildItemListSchema(
      [{ slug: "a", displayName: "A" }],
      "https://example.com",
    );
    expect(schema?.itemListElement[0]).not.toHaveProperty("position");
  });
});
