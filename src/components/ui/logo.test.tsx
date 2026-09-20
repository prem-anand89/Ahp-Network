import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Logo } from "./logo";

afterEach(cleanup);

describe("Logo (adopted 2026-09-20, supersedes AhpMark)", () => {
  it("renders the wordmark text", () => {
    render(<Logo />);
    expect(screen.getByText("ahp")).toBeInTheDocument();
    expect(screen.getByText("network")).toBeInTheDocument();
  });

  it("switches tracking (and, in real builds, the font) with the variant prop", () => {
    // next/font/google is mocked in vitest.setup.ts (it needs Next's own
    // build-time transform to work at all), so both variants resolve to
    // the same mocked font class here — this asserts the other thing
    // that actually changes per variant (letter-spacing), which is
    // enough to prove the prop is wired through, not hardcoded.
    const { container } = render(<Logo />);
    const nunitoClasses = container.firstElementChild?.className.split(" ") ?? [];
    expect(nunitoClasses).toContain("tracking-tighter");
    expect(nunitoClasses).not.toContain("tracking-tight");

    const { container: newsreaderContainer } = render(<Logo variant="newsreader" />);
    const newsreaderClasses = newsreaderContainer.firstElementChild?.className.split(" ") ?? [];
    expect(newsreaderClasses).toContain("tracking-tight");
    expect(newsreaderClasses).not.toContain("tracking-tighter");
  });

  it("forwards a className for sizing (e.g. text-2xl)", () => {
    const { container } = render(<Logo className="text-2xl" />);
    expect(container.firstElementChild?.className).toContain("text-2xl");
  });
});
