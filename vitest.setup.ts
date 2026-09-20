import "@testing-library/jest-dom/vitest";

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
