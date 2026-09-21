// WCAG AA contrast-ratio guardrail for the three verification badges.
//
// Found in review, 2026-09-21: globals.css already documents that jade
// (#2F9E6E) fails AA for small text, which is exactly why --verified-text
// (a darker jade) exists as a separate token for the filled
// CredentialsVerifiedBadge. That reasoning was never turned into a test —
// nothing stops a future token edit from silently dropping any of the
// three badges below 4.5:1. OwnershipVerifiedBadge in particular (brick
// text on brick-bg) passes today by a margin of only ~0.14, the thinnest
// of the three.
//
// Reads the actual hex values out of globals.css rather than hardcoding
// them a second time here — hardcoded values would make this a snapshot
// of today's palette, not a guardrail against tomorrow's edit.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GLOBALS_CSS_PATH = join(process.cwd(), "src/app/globals.css");

function readToken(name: string): string {
  const css = readFileSync(GLOBALS_CSS_PATH, "utf-8");
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Token --${name} not found in globals.css`);
  return match[1];
}

// Standard WCAG relative-luminance / contrast-ratio formulas.
function relativeLuminance(hex: string): number {
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_SMALL_TEXT_MINIMUM = 4.5;

describe("verification badge foreground/background contrast (WCAG AA, 4.5:1)", () => {
  it("CredentialsVerifiedBadge — white text on the filled jade pill", () => {
    const fill = readToken("ahp-verified-text");
    expect(contrastRatio("#ffffff", fill)).toBeGreaterThanOrEqual(AA_SMALL_TEXT_MINIMUM);
  });

  it("QualificationConfirmedBadge — ink text on the white outline pill", () => {
    const ink = readToken("ahp-ink");
    expect(contrastRatio(ink, "#ffffff")).toBeGreaterThanOrEqual(AA_SMALL_TEXT_MINIMUM);
  });

  it("OwnershipVerifiedBadge — brick text on the brick-tint rect (thinnest margin of the three)", () => {
    const brick = readToken("ahp-brick");
    const brickBg = readToken("ahp-brick-bg");
    expect(contrastRatio(brick, brickBg)).toBeGreaterThanOrEqual(AA_SMALL_TEXT_MINIMUM);
  });
});
