import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// next/font/google relies on Next's own build-time SWC transform (it
// replaces the import with real font-loading code); outside Next's build
// pipeline — i.e. every vitest run — the raw package export isn't
// callable at all ("Nunito is not a function"). Every font loader
// actually imported anywhere in src (grep for `from "next/font/google"`
// before adding a new one here) gets the same mock shape real code
// destructures (className/variable/style). Vitest's mock validates named
// exports statically, so this has to list them — a Proxy that answers
// any property name doesn't satisfy that check.
vi.mock("next/font/google", () => {
  const fontLoader = () => ({
    className: "mock-font-class",
    variable: "--mock-font-variable",
    style: { fontFamily: "mock-font" },
  });
  return {
    Newsreader: fontLoader,
    Inter: fontLoader,
    IBM_Plex_Mono: fontLoader,
    Nunito: fontLoader,
  };
});

// jsdom doesn't implement the Pointer Events capture API or
// scrollIntoView — Radix's Select (and other primitives built on
// pointer-capture-based interactions) call these during open/close and
// throw "not a function" otherwise. No-op polyfills, not a real
// implementation: nothing here asserts capture actually happened, tests
// just need these calls to not crash.
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
